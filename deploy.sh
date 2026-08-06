#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Full fresh deployment to VM
# Usage: bash deploy.sh
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_BASE="${LOCAL_BASE:-$SCRIPT_DIR}"
SSH_KEY="${SSH_KEY:-$LOCAL_BASE/deploy.key}"
SSH_KEY="${SSH_KEY:-$LOCAL_BASE/ssh-key-2022-12-01.key}"
REMOTE="${REMOTE:-ubuntu@129.154.39.198}"
REMOTE_BASE="${REMOTE_BASE:-/home/ubuntu/sandbox-ide}"

# ─── Colours ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${GREEN}[deploy]${NC} $*"; }
warn()    { echo -e "${YELLOW}[warn]${NC}   $*"; }
section() { echo -e "\n${YELLOW}══ $* ══${NC}"; }

# ─── 1. Build frontend LOCALLY (no VITE_API_URL so runtime fallback is used) ─
section "1/4  Building frontend"
info "Overriding VITE_API_URL to empty so localhost:4000 is NOT baked into the bundle"
info "(The .env file sets it to localhost:4000 for local dev — we override it for prod)"
cd "${LOCAL_BASE}/frontend"
# Pass VITE_API_URL as empty string — Vite inline env vars beat .env files
VITE_API_URL="" npm run build
info "Build complete → dist/"

# ─── 2. Upload frontend dist to VM ───────────────────────────────────────────
section "2/4  Uploading frontend dist & vite.config.ts"
tar -czf /tmp/dist.tar.gz -C dist .
scp -i "${SSH_KEY}" /tmp/dist.tar.gz "${REMOTE}:${REMOTE_BASE}/frontend/dist.tar.gz"
scp -i "${SSH_KEY}" vite.config.ts "${REMOTE}:${REMOTE_BASE}/frontend/vite.config.ts"
ssh -i "${SSH_KEY}" "${REMOTE}" bash <<'REMOTE_FRONTEND'
  cd /home/ubuntu/sandbox-ide/frontend
  rm -rf dist
  mkdir -p dist
  tar -xzf dist.tar.gz -C dist
  rm dist.tar.gz
  sudo chmod 755 /home/ubuntu
  sudo systemctl reload nginx || true
  echo "Frontend dist extracted OK"
REMOTE_FRONTEND
rm /tmp/dist.tar.gz
info "Frontend dist deployed"

# ─── 3. Sync backend + testing source to VM ──────────────────────────────────
section "3/4  Syncing backend & testing source"
rsync -avz --progress \
  -e "ssh -i ${SSH_KEY}" \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.env' \
  --exclude 'workspace_data' \
  --exclude '*.log' \
  "${LOCAL_BASE}/backend/" \
  "${REMOTE}:${REMOTE_BASE}/backend/"
info "Backend source synced"

rsync -avz --progress \
  -e "ssh -i ${SSH_KEY}" \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude 'test-results' \
  --exclude 'playwright-report' \
  "${LOCAL_BASE}/testing/" \
  "${REMOTE}:${REMOTE_BASE}/testing/"
info "Testing directory synced"

# ─── 4. Install backend deps & restart PM2 ───────────────────────────────────
section "4/4  Rebuilding backend & restarting PM2"
ssh -i "${SSH_KEY}" "${REMOTE}" bash <<'REMOTE_BACKEND'
  set -e
  cd /home/ubuntu/sandbox-ide/backend
  echo "→ Installing backend npm deps..."
  npm install --prefer-offline 2>&1 | tail -5
  echo "→ Restarting PM2 processes..."
  pm2 restart all
  sleep 3
  echo "→ PM2 status:"
  pm2 list --no-color
REMOTE_BACKEND

info "All done! Deployment complete."
echo ""
echo -e "${GREEN}NexusIDE: ${NC} http://${REMOTE#*@}/ide/"
echo -e "${GREEN}MagnusCI: ${NC} http://${REMOTE#*@}"
echo ""
warn "Bundle built WITHOUT VITE_API_URL — runtime fallback in backendUrls.ts"
warn "now correctly resolves the API to http://<hostname>/api in the browser."
