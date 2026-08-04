#!/usr/bin/env bash
# =============================================================================
# test.sh — Unified Production Test Runner
# Usage:
#   bash test.sh              # Run unit & integration tests (backend + frontend)
#   bash test.sh --all        # Run all test suites including Playwright E2E
#   bash test.sh --backend    # Run backend & Yjs unit/integration tests only
#   bash test.sh --frontend   # Run frontend component tests only
#   bash test.sh --e2e        # Run Playwright E2E browser tests (against deployed VM)
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_BASE="${LOCAL_BASE:-$SCRIPT_DIR}"
DEPLOYED_URL="http://129.154.39.198"

# ─── Colours ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${GREEN}[test]${NC} $*"; }
warn()    { echo -e "${YELLOW}[warn]${NC} $*"; }
err()     { echo -e "${RED}[error]${NC} $*"; }
section() { echo -e "\n${BLUE}══ $* ══${NC}"; }

# ─── Parse arguments ──────────────────────────────────────────────────────────
MODE="default"
case "$1" in
  --all)       MODE="all" ;;
  --backend)   MODE="backend" ;;
  --frontend)  MODE="frontend" ;;
  --e2e)       MODE="e2e" ;;
  "")          MODE="default" ;;
  *)
    err "Unknown argument: $1"
    echo "Usage: bash test.sh [--all | --backend | --frontend | --e2e]"
    exit 1
    ;;
esac

cd "${LOCAL_BASE}"

# Ensure testing dependencies exist
if [ ! -d "${LOCAL_BASE}/testing/node_modules" ]; then
  info "Installing test suite dependencies..."
  (cd "${LOCAL_BASE}/testing" && npm install --no-audit --no-fund)
fi

# ─── Run Backend Tests ───────────────────────────────────────────────────────
run_backend() {
  section "Backend & Yjs CRDT Unit/Integration Tests"
  if [ -d "${LOCAL_BASE}/backend/node_modules" ]; then
    (cd "${LOCAL_BASE}/backend" && npm test)
  else
    (cd "${LOCAL_BASE}/testing" && npm run test:backend)
  fi
  info "Backend tests passed cleanly ✓"
}

# ─── Run Frontend Tests ──────────────────────────────────────────────────────
run_frontend() {
  section "Frontend React Component Tests"
  if [ -d "${LOCAL_BASE}/frontend/node_modules" ]; then
    (cd "${LOCAL_BASE}/frontend" && npm test)
  else
    (cd "${LOCAL_BASE}/testing" && npm run test:frontend)
  fi
  info "Frontend tests passed cleanly ✓"
}

# ─── Run E2E Playwright Tests ────────────────────────────────────────────────
run_e2e() {
  section "Playwright End-to-End Browser Specs"
  export BASE_URL="${BASE_URL:-$DEPLOYED_URL}"
  info "Running Playwright E2E against target: ${BASE_URL}"
  
  if [ -d "${LOCAL_BASE}/frontend/node_modules" ]; then
    (cd "${LOCAL_BASE}/frontend" && npm run test:e2e)
  else
    (cd "${LOCAL_BASE}/testing" && npm run test:e2e)
  fi
  info "Playwright E2E tests complete ✓"
}

# ─── Dispatch based on MODE ─────────────────────────────────────────────────
case "$MODE" in
  backend)
    run_backend
    ;;
  frontend)
    run_frontend
    ;;
  e2e)
    run_e2e
    ;;
  default)
    run_backend
    run_frontend
    ;;
  all)
    run_backend
    run_frontend
    run_e2e
    ;;
esac

echo ""
info "All requested test suites completed successfully!"
