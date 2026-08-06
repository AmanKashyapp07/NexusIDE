#!/usr/bin/env bash
# =============================================================================
# NexusIDE Production Deployment Manager
# Target Server: Oracle Cloud VM (129.154.39.198)
# Stack: Node.js / Express / Socket.IO / Docker / Nginx / PM2
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_BASE="${LOCAL_BASE:-$SCRIPT_DIR}"
SSH_KEY="${SSH_KEY:-$LOCAL_BASE/ssh-key-2022-12-01.key}"
REMOTE="${REMOTE:-ubuntu@129.154.39.198}"
REMOTE_BASE="${REMOTE_BASE:-/home/ubuntu/sandbox-ide}"

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

# ─── 0. Prerequisite Checks ───────────────────────────────────────────────────
section "0/4  Verifying Prerequisites"

if [ ! -f "$SSH_KEY" ]; then
  error "SSH key not found at $SSH_KEY"
  exit 1
fi
chmod 600 "$SSH_KEY"

for cmd in ssh rsync tar npm; do
  if ! command -v $cmd &>/dev/null; then
    error "Required command '$cmd' is not installed locally."
    exit 1
  fi
done

info "Testing SSH connectivity to ${REMOTE}..."
if ! ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 "${REMOTE}" "echo SSH_OK" &>/dev/null; then
  error "Failed to connect to ${REMOTE}. Check SSH configuration or network state."
  exit 1
fi
success "SSH Connection Verified."

# ─── 1. Build Frontend Locally ────────────────────────────────────────────────
section "1/4  Building Production Frontend Bundle"
info "Overriding VITE_API_URL to empty string for dynamic runtime API resolution"
cd "${LOCAL_BASE}/frontend"
VITE_API_URL="" npm run build
success "Frontend built successfully → dist/"

# ─── 2. Sync Source & Bundles to VM ───────────────────────────────────────────
section "2/4  Syncing Assets to Remote Host"
tar -czf /tmp/dist.tar.gz -C dist .

info "Uploading frontend distribution package..."
scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no /tmp/dist.tar.gz "${REMOTE}:${REMOTE_BASE}/frontend/dist.tar.gz"
scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no vite.config.ts "${REMOTE}:${REMOTE_BASE}/frontend/vite.config.ts"
rm -f /tmp/dist.tar.gz

info "Syncing backend codebase..."
rsync -avz --delete \
  -e "ssh -i ${SSH_KEY} -o StrictHostKeyChecking=no" \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.env' \
  --exclude 'workspace_data' \
  --exclude '*.log' \
  "${LOCAL_BASE}/backend/" \
  "${REMOTE}:${REMOTE_BASE}/backend/"

info "Syncing frontend package metadata..."
rsync -avz \
  -e "ssh -i ${SSH_KEY} -o StrictHostKeyChecking=no" \
  --include 'package*.json' \
  --exclude '*' \
  "${LOCAL_BASE}/frontend/" \
  "${REMOTE}:${REMOTE_BASE}/frontend/"

info "Syncing testing suite..."
rsync -avz \
  -e "ssh -i ${SSH_KEY} -o StrictHostKeyChecking=no" \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude 'test-results' \
  --exclude 'playwright-report' \
  "${LOCAL_BASE}/testing/" \
  "${REMOTE}:${REMOTE_BASE}/testing/"

success "File synchronization complete."

# ─── 3. Remote Service Deployment ────────────────────────────────────────────
section "3/4  Executing Remote Deployment & Service Reload"
ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no "${REMOTE}" bash <<'REMOTE_EXEC'
  set -euo pipefail
  
  echo "→ Extracting frontend distribution bundle..."
  cd /home/ubuntu/sandbox-ide/frontend
  rm -rf dist
  mkdir -p dist
  tar -xzf dist.tar.gz -C dist
  rm -f dist.tar.gz
  
  echo "→ Updating backend dependencies..."
  cd /home/ubuntu/sandbox-ide/backend
  npm install --prefer-offline --no-audit --no-fund 2>&1 | tail -5
  
  echo "→ Restarting PM2 processes..."
  pm2 restart all --update-env
  sleep 3
  
  echo "→ Reloading Nginx..."
  sudo chmod 755 /home/ubuntu
  sudo nginx -t
  sudo systemctl reload nginx
REMOTE_EXEC
success "Remote services reloaded."

# ─── 4. Health Check & Verification ──────────────────────────────────────────
section "4/4  Verifying Deployment Health"
info "Checking backend health status on VM..."
HEALTH_CHECK=$(ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no "${REMOTE}" "curl -s -o /dev/null -w '%{http_code}' http://localhost:4000/api/workspace || true")

if [ "$HEALTH_CHECK" -eq 200 ] || [ "$HEALTH_CHECK" -eq 401 ]; then
  success "Backend API is online and responding (HTTP $HEALTH_CHECK)."
else
  warn "Backend API responded with unexpected status HTTP $HEALTH_CHECK. Check PM2 logs using: pm2 logs backend"
fi

echo ""
success "NexusIDE Deployment Completed Successfully!"
echo -e "${GREEN}NexusIDE App:${NC} http://${REMOTE#*@}/ide/"
echo -e "${GREEN}MagnusCI App:${NC} http://${REMOTE#*@}/ci/"
echo ""
