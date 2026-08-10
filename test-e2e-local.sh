#!/usr/bin/env bash
# =============================================================================
# test-e2e-local.sh — NexusIDE Custom Local E2E Test Orchestrator
# Executes full Playwright browser suites against local environment (localhost:5173 / localhost:4000)
# =============================================================================
# Usage:
#   bash test-e2e-local.sh            # Run all E2E specs locally with auto server boot
#   bash test-e2e-local.sh --collab    # Run only real-time collaboration specs
#   bash test-e2e-local.sh --terminal  # Run only terminal PTY & LSP specs
#   bash test-e2e-local.sh --timelapse # Run only timelapse player specs
#   bash test-e2e-local.sh --ui        # Open interactive Playwright UI runner
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_BASE="${LOCAL_BASE:-$SCRIPT_DIR}"
LOCAL_FRONTEND_URL="http://localhost:5173/ide"
LOCAL_BACKEND_URL="http://127.0.0.1:4000/api/health"

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

BACKEND_PID=""
FRONTEND_PID=""

cleanup_processes() {
  if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    info "Stopping background local backend process (PID: $BACKEND_PID)..."
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if [ -n "$FRONTEND_PID" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    info "Stopping background local frontend process (PID: $FRONTEND_PID)..."
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
}

trap cleanup_processes EXIT INT TERM

show_banner() {
  echo -e "${CYAN}${BOLD}"
  echo "========================================================================"
  echo "         NEXUS IDE LOCAL E2E PLAYWRIGHT TEST ORCHESTRATOR               "
  echo "========================================================================"
  echo -e "${NC}"
}

# ─── Step 1: Verify System Prerequisites ──────────────────────────────────────
check_prerequisites() {
  section "Step 1: Checking Local Prerequisites"

  if ! docker info >/dev/null 2>&1; then
    error "Docker Engine is not running locally. Please start Docker Desktop first!"
    exit 1
  fi
  success "Docker Engine is running locally."

  if ! command -v node >/dev/null 2>&1; then
    error "Node.js is not installed!"
    exit 1
  fi
  success "Node.js environment verified ($(node -v))."
}

# ─── Step 2: Ensure Local Services Are Active ─────────────────────────────────
ensure_services_running() {
  section "Step 2: Verifying Local Backend & Frontend Services"

  # Check backend
  if curl -s -m 2 "http://127.0.0.1:4000/metrics" >/dev/null 2>&1; then
    success "Local backend is active on port 4000."
  else
    # Check if port 4000 is occupied by a stale non-responsive process
    local stale_b_pid=$(lsof -ti:4000 2>/dev/null || true)
    if [ -n "$stale_b_pid" ]; then
      warn "Port 4000 is occupied by a non-responsive process (PID: $stale_b_pid). Clearing port..."
      kill -9 $stale_b_pid 2>/dev/null || true
      sleep 1
    fi

    info "Launching local dev backend (port 4000)..."
    (cd "$LOCAL_BASE/backend" && npm run dev) >/tmp/nexus_local_backend.log 2>&1 &
    BACKEND_PID=$!
    info "Waiting for backend server readiness..."
    local booted=false
    for i in {1..30}; do
      if curl -s -m 2 "http://127.0.0.1:4000/metrics" >/dev/null 2>&1; then
        booted=true
        success "Backend server booted successfully (PID: $BACKEND_PID)."
        break
      fi
      if [ $((i % 5)) -eq 0 ]; then
        info "Still waiting for backend server... (elapsed ${i}s)"
      fi
      sleep 1
    done

    if [ "$booted" = false ]; then
      error "Backend server failed to boot within 30 seconds! Recent logs:"
      tail -n 20 /tmp/nexus_local_backend.log 2>/dev/null || true
      exit 1
    fi
  fi

  # Check frontend
  if curl -s -m 2 "$LOCAL_FRONTEND_URL" >/dev/null 2>&1; then
    success "Local frontend is active on port 5173."
  else
    # Check if port 5173 is occupied by a stale non-responsive process
    local stale_f_pid=$(lsof -ti:5173 2>/dev/null || true)
    if [ -n "$stale_f_pid" ]; then
      warn "Port 5173 is occupied by a non-responsive process (PID: $stale_f_pid). Clearing port..."
      kill -9 $stale_f_pid 2>/dev/null || true
      sleep 1
    fi

    info "Launching local dev frontend (port 5173)..."
    (cd "$LOCAL_BASE/frontend" && npm run dev) >/tmp/nexus_local_frontend.log 2>&1 &
    FRONTEND_PID=$!
    info "Waiting for frontend dev server readiness..."
    local f_booted=false
    for i in {1..20}; do
      if curl -s -m 2 "$LOCAL_FRONTEND_URL" >/dev/null 2>&1; then
        f_booted=true
        success "Frontend dev server booted successfully (PID: $FRONTEND_PID)."
        break
      fi
      sleep 1
    done

    if [ "$f_booted" = false ]; then
      error "Frontend server failed to boot within 20 seconds! Recent logs:"
      tail -n 20 /tmp/nexus_local_frontend.log 2>/dev/null || true
      exit 1
    fi
  fi
}

# ─── Step 3: Local Storage Cleanup ───────────────────────────────────────────
run_local_storage_gc() {
  section "Step 3: Executing Pre-Test Local Storage & Database GC"
  if [ -d "$LOCAL_BASE/backend" ]; then
    (cd "$LOCAL_BASE/backend" && npx tsx src/cli/cleanup.cli.ts 2>/dev/null || true)
    success "Local database & storage GC complete."
  fi
}

# ─── Step 4: Run E2E Test Batches ─────────────────────────────────────────────
run_e2e_tests() {
  section "Step 4: Executing Local Playwright E2E Suites"

  export NEXUS_BASE_URL="$LOCAL_FRONTEND_URL"
  export PLAYWRIGHT_WORKERS="${PLAYWRIGHT_WORKERS:-2}"

  local target_file="${1:-all}"

  cd "$LOCAL_BASE/testing"

  if [[ "$target_file" == "--ui" ]]; then
    info "Launching interactive Playwright UI mode..."
    npx playwright test --ui
    return
  fi

  if [[ "$target_file" == "--collab" ]]; then
    info "Running Real-time Collaboration Suite (e2e/collaboration.spec.ts)..."
    npx playwright test e2e/collaboration.spec.ts --workers="$PLAYWRIGHT_WORKERS"
  elif [[ "$target_file" == "--terminal" ]]; then
    info "Running Terminal PTY & LSP Suite (e2e/terminal-lsp.spec.ts)..."
    npx playwright test e2e/terminal-lsp.spec.ts --workers="$PLAYWRIGHT_WORKERS"
  elif [[ "$target_file" == "--timelapse" ]]; then
    info "Running Timelapse Suite (e2e/timelapse.spec.ts)..."
    npx playwright test e2e/timelapse.spec.ts --workers="$PLAYWRIGHT_WORKERS"
  else
    info "Running all E2E test suites in modular batches..."
    
    info "Batch 1/3: Collaboration & Real-Time Sync..."
    npx playwright test e2e/collaboration.spec.ts --workers="$PLAYWRIGHT_WORKERS"

    info "Batch 2/3: Terminal PTY & Shell Execution..."
    npx playwright test e2e/terminal-lsp.spec.ts --workers="$PLAYWRIGHT_WORKERS"

    info "Batch 3/3: Timelapse Playback Engine..."
    npx playwright test e2e/timelapse.spec.ts --workers="$PLAYWRIGHT_WORKERS"
  fi

  success "All local E2E test suites executed successfully! 🚀"
}

# ─── Main Execution Pipeline ──────────────────────────────────────────────────
show_banner
check_prerequisites
ensure_services_running
run_local_storage_gc
run_e2e_tests "${1:-all}"
