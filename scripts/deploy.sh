#!/usr/bin/env bash
# =============================================================================
# NexusIDE Ultra-Fast Production Deployment Manager
# Target Server: Oracle Cloud VM (129.154.39.198)
# Stack: Node.js / Express / Socket.IO / Docker / Nginx / PM2
# =============================================================================
# Key Performance Optimizations:
#   1. SSH ControlMaster Multiplexing (0ms connection overhead for sub-commands)
#   2. Smart Change Detection (skips frontend rebuild when unchanged)
#   3. Direct rsync Delta Syncing (no tar/untar disk overhead)
#   4. Cached Dependency Verification (skips remote npm install if package.json unchanged)
#   5. Dynamic Health Polling (instant verification instead of arbitrary sleeps)
#   6. Modular Deploy Modes (--quick, --backend, --frontend, --full)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCAL_BASE="${LOCAL_BASE:-$PROJECT_ROOT}"
SSH_KEY="${SSH_KEY:-$LOCAL_BASE/ssh-key-2022-12-01.key}"
REMOTE="${REMOTE:-ubuntu@129.154.39.198}"
REMOTE_BASE="${REMOTE_BASE:-/home/ubuntu/sandbox-ide}"

DEPLOY_START=$(date +%s)
MODE="smart"

# ─── Formatting ───────────────────────────────────────────────────────────────
CYAN='\033[0;36m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${CYAN}${BOLD}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}${BOLD}[SUCCESS]${NC} $*"; }
warn()    { echo -e "${YELLOW}${BOLD}[WARN]${NC} $*"; }
error()   { echo -e "${RED}${BOLD}[ERROR]${NC} $*"; }
section() { echo -e "\n${YELLOW}${BOLD}══ $* ══${NC}"; }

CLEANUP_FIRST=false

# ─── Parse Arguments ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --clean|--cleanup|-c)
      CLEANUP_FIRST=true
      shift
      ;;
    --quick|-q)
      MODE="quick"
      shift
      ;;
    --backend|-b)
      MODE="backend"
      shift
      ;;
    --frontend|-f)
      MODE="frontend"
      shift
      ;;
    --full|--force)
      MODE="full"
      shift
      ;;
    --status)
      MODE="status"
      shift
      ;;
    --help|-h)
      echo "NexusIDE Fast Deployment Manager"
      echo ""
      echo "Usage: bash deploy.sh [OPTION]"
      echo ""
      echo "Options:"
      echo "  (no args)       Smart deploy (auto-detects changes, skips redundant work)"
      echo "  --clean, -c     Execute VM deep storage & container cleanup before deploy"
      echo "  --quick, -q     Ultra-fast deploy (syncs backend & assets, fast restart)"
      echo "  --backend, -b   Deploy backend service only"
      echo "  --frontend, -f  Build and deploy frontend bundle only"
      echo "  --full, --force Force full rebuild of frontend & sync everything"
      echo "  --status        Check remote VM service health and PM2 status"
      echo "  --help, -h      Show this help message"
      echo ""
      exit 0
      ;;
    *)
      warn "Unknown option: $1 (falling back to smart deploy)"
      shift
      ;;
  esac
done

# ─── SSH Multiplexing Setup ───────────────────────────────────────────────────
SSH_CTRL_DIR="/tmp/ssh-nexus-mux"
mkdir -p "$SSH_CTRL_DIR"

# Clean up stale/dead multiplex sockets from previous interrupted runs
for sock in "$SSH_CTRL_DIR"/mux-*; do
  if [ -e "$sock" ]; then
    if ! ssh -O check -S "$sock" "${REMOTE}" &>/dev/null; then
      rm -f "$sock"
    fi
  fi
done

SSH_CTRL_SOCKET="${SSH_CTRL_DIR}/mux-%r@%h:%p"

SSH_COMMON_OPTS=(
  -i "${SSH_KEY}"
  -o StrictHostKeyChecking=no
  -o ConnectTimeout=6
  -o ControlMaster=auto
  -o ControlPath="${SSH_CTRL_SOCKET}"
  -o ControlPersist=120s
)

cleanup_ssh() {
  # Cleanly close multiplex master if still active on script exit
  ssh -O check "${SSH_COMMON_OPTS[@]}" "${REMOTE}" &>/dev/null && \
    ssh -O exit "${SSH_COMMON_OPTS[@]}" "${REMOTE}" &>/dev/null || true
}
# Keep socket alive for subsequent fast commands during active development sessions

# ─── 0. Prerequisite & Connection Check ───────────────────────────────────────
section "0/4  Verifying Prerequisites & SSH Multiplexer"

if [ ! -f "$SSH_KEY" ]; then
  error "SSH key not found at $SSH_KEY"
  exit 1
fi
chmod 600 "$SSH_KEY" 2>/dev/null || true

for cmd in ssh rsync npm; do
  if ! command -v "$cmd" &>/dev/null; then
    error "Required command '$cmd' is not installed locally."
    exit 1
  fi
done

if [ "$MODE" = "status" ]; then
  info "Checking remote services on ${REMOTE}..."
  ssh "${SSH_COMMON_OPTS[@]}" "${REMOTE}" "pm2 status; echo '--- Nginx Health ---'; sudo systemctl status nginx --no-pager -n 3"
  exit 0
fi

info "Establishing persistent SSH connection to ${REMOTE}..."
if ! ssh "${SSH_COMMON_OPTS[@]}" "${REMOTE}" "echo SSH_OK" &>/dev/null; then
  error "Failed to connect to ${REMOTE}. Check SSH configuration or network state."
  exit 1
fi
success "SSH Connection Multiplexed (0ms subsequent latency)."

# ─── Optional VM Cleanup Step ─────────────────────────────────────────
if [ "$CLEANUP_FIRST" = true ] || [ "${RUN_VM_CLEANUP:-false}" = true ]; then
  section "Executing VM Deep Cleanup Routine"
  if [ -f "$SCRIPT_DIR/vm-cleanup.sh" ]; then
    bash "$SCRIPT_DIR/vm-cleanup.sh" || warn "VM Cleanup encountered warnings, continuing deployment..."
  else
    warn "vm-cleanup.sh script not found at $SCRIPT_DIR/vm-cleanup.sh, skipping cleanup."
  fi
fi

# ─── 1. Smart Frontend Build ──────────────────────────────────────────────────
SHOULD_BUILD_FRONTEND=false

if [ "$MODE" = "full" ] || [ "$MODE" = "frontend" ]; then
  SHOULD_BUILD_FRONTEND=true
elif [ "$MODE" = "smart" ]; then
  # Compute hash of frontend source files
  HASH_FILE="${LOCAL_BASE}/frontend/.last_build_hash"
  CURRENT_FRONTEND_HASH=$(find "${LOCAL_BASE}/frontend/src" "${LOCAL_BASE}/frontend/public" "${LOCAL_BASE}/frontend/package.json" "${LOCAL_BASE}/frontend/vite.config.ts" "${LOCAL_BASE}/frontend/index.html" -type f 2>/dev/null | sort | xargs md5 -q 2>/dev/null || find "${LOCAL_BASE}/frontend/src" -type f | sort | xargs md5sum 2>/dev/null | md5sum | cut -d' ' -f1)
  
  if [ ! -d "${LOCAL_BASE}/frontend/dist" ] || [ ! -f "$HASH_FILE" ] || [ "$CURRENT_FRONTEND_HASH" != "$(cat "$HASH_FILE" 2>/dev/null)" ]; then
    SHOULD_BUILD_FRONTEND=true
  else
    info "Frontend source unchanged since last build. Skipping Vite compilation ✓"
  fi
fi

if [ "$SHOULD_BUILD_FRONTEND" = true ]; then
  section "1/4  Building Production Frontend Bundle"
  info "Running Vite build with dynamic runtime API resolution..."
  cd "${LOCAL_BASE}/frontend"
  VITE_API_URL="" npm run build
  if [ -n "${CURRENT_FRONTEND_HASH:-}" ]; then
    echo "$CURRENT_FRONTEND_HASH" > "${LOCAL_BASE}/frontend/.last_build_hash"
  fi
  success "Frontend bundle compiled → dist/"
else
  section "1/4  Frontend Build: Cache Hit (Skipped)"
fi

# ─── 2. Fast Delta Synchronization ────────────────────────────────────────────
section "2/4  Fast Delta Synchronization via rsync"

RSYNC_SSH="ssh $(printf '%q ' "${SSH_COMMON_OPTS[@]}")"

if [ "$MODE" != "backend" ] && [ -d "${LOCAL_BASE}/frontend/dist" ]; then
  info "Syncing frontend dist bundle directly..."
  rsync -avz --delete \
    -e "${RSYNC_SSH}" \
    "${LOCAL_BASE}/frontend/dist/" \
    "${REMOTE}:${REMOTE_BASE}/frontend/dist/"
  
  rsync -avz \
    -e "${RSYNC_SSH}" \
    "${LOCAL_BASE}/frontend/vite.config.ts" \
    "${REMOTE}:${REMOTE_BASE}/frontend/vite.config.ts"
fi

if [ "$MODE" != "frontend" ]; then
  info "Syncing backend codebase (excluding node_modules, cache, logs)..."
  rsync -avz --delete \
    -e "${RSYNC_SSH}" \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude '.env' \
    --exclude 'workspace_data' \
    --exclude '*.log' \
    --exclude '.git' \
    --exclude '.DS_Store' \
    "${LOCAL_BASE}/backend/" \
    "${REMOTE}:${REMOTE_BASE}/backend/"

  info "Syncing test suite..."
  rsync -avz --delete \
    -e "${RSYNC_SSH}" \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude 'test-results' \
    --exclude 'playwright-report' \
    --exclude '.DS_Store' \
    "${LOCAL_BASE}/testing/" \
    "${REMOTE}:${REMOTE_BASE}/testing/"
fi

success "Delta synchronization completed."

# ─── 3. Remote Service Reload with Dependency Cache ───────────────────────────
section "3/4  Executing Remote Reload & Dependency Check"

ssh "${SSH_COMMON_OPTS[@]}" "${REMOTE}" bash <<'REMOTE_EXEC'
  set -euo pipefail
  
  cd /home/ubuntu/sandbox-ide/backend
  
  # Check if package.json has changed before running costly npm install
  PKG_HASH=$(md5sum package.json package-lock.json 2>/dev/null || md5sum package.json 2>/dev/null || echo "nohash")
  if [ ! -f .last_pkg_hash ] || [ "$PKG_HASH" != "$(cat .last_pkg_hash 2>/dev/null)" ]; then
    echo "→ Updating backend dependencies (package.json modified)..."
    npm install --prefer-offline --no-audit --no-fund 2>&1 | tail -3
    echo "$PKG_HASH" > .last_pkg_hash
  else
    echo "→ Dependencies up to date (skipping npm install)."
  fi

  echo "→ Fast-reloading PM2 processes..."
  pm2 restart all --update-env --no-autorestart || pm2 restart all --update-env
  
  echo "→ Reloading Nginx..."
  sudo chmod 755 /home/ubuntu
  sudo nginx -t >/dev/null 2>&1 && sudo systemctl reload nginx
REMOTE_EXEC

success "Remote services reloaded."

# ─── 4. Dynamic Health Polling ────────────────────────────────────────────────
section "4/4  Verifying Deployment Health"

info "Polling backend health endpoint (dynamic response detection)..."
HEALTH_CHECK="000"
for i in {1..12}; do
  HEALTH_CHECK=$(ssh "${SSH_COMMON_OPTS[@]}" "${REMOTE}" \
    "curl -s -o /dev/null -w '%{http_code}' http://localhost:4000/api/workspace || echo 000")
  if [ "$HEALTH_CHECK" -eq 200 ] || [ "$HEALTH_CHECK" -eq 401 ]; then
    break
  fi
  sleep 0.25
done

if [ "$HEALTH_CHECK" -eq 200 ] || [ "$HEALTH_CHECK" -eq 401 ]; then
  success "Backend API is online and responding (HTTP $HEALTH_CHECK)."
else
  warn "Backend API returned HTTP $HEALTH_CHECK. Check PM2 logs using: pm2 logs backend"
fi

DEPLOY_END=$(date +%s)
TOTAL_TIME=$((DEPLOY_END - DEPLOY_START))

echo ""
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  NexusIDE Deployment Finished in ${TOTAL_TIME}s! (Mode: ${MODE})${NC}"
echo -e "${GREEN}  NexusIDE App:${NC} http://${REMOTE#*@}/ide/"
echo -e "${GREEN}  MagnusCI App:${NC} http://${REMOTE#*@}/ci/"
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════════════════════════${NC}"
echo ""
