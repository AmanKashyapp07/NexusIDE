#!/usr/bin/env bash
# =============================================================================
# test.sh — NexusIDE Production-Grade Master Test Suite Orchestrator
# =============================================================================
# High-Level Architecture: Runs multi-layered test suites including Yjs CRDT logic,
# REST API endpoints, WebSocket presence/collaboration, React frontend components,
# and Playwright E2E browser flows against deployed staging/production targets.
#
# Usage:
#   bash test.sh              # Run unit & integration tests (backend + frontend)
#   bash test.sh --all        # Run all test suites including Playwright E2E
#   bash test.sh --backend    # Run backend & Yjs unit/integration tests only
#   bash test.sh --frontend   # Run frontend component tests only
#   bash test.sh --e2e        # Run Playwright E2E browser specs
#   bash test.sh --ci         # CI execution mode (non-interactive, exit on error)
#   bash test.sh --help       # Print usage information
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_BASE="${LOCAL_BASE:-$SCRIPT_DIR}"
DEFAULT_TARGET="http://129.154.39.198/ide"
NEXUS_BASE_URL="${NEXUS_BASE_URL:-$DEFAULT_TARGET}"
export NEXUS_BASE_URL

# ─── Formatting & Colors ──────────────────────────────────────────────────────
BOLD='\033[1m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
RESET='\033[0m'

log_info()    { echo -e "${CYAN}${BOLD}[INFO]${RESET} $*"; }
log_success() { echo -e "${GREEN}${BOLD}[SUCCESS]${RESET} $*"; }
log_warn()    { echo -e "${YELLOW}${BOLD}[WARNING]${RESET} $*"; }
log_error()   { echo -e "${RED}${BOLD}[ERROR]${RESET} $*"; }
section()     { echo -e "\n${BLUE}${BOLD}══ $* ══${RESET}"; }

START_TIME=$(date +%s)
SUMMARY_SUITES=()
SUMMARY_STATUS=()
SUMMARY_TIMES=()

record_suite() {
  local name="$1"
  local status="$2"
  local duration="$3"
  SUMMARY_SUITES+=("$name")
  SUMMARY_STATUS+=("$status")
  SUMMARY_TIMES+=("${duration}s")
}

cleanup() {
  local exit_code=$?
  if [ $exit_code -ne 0 ]; then
    log_error "Test execution interrupted or failed with exit code $exit_code"
  fi
}
trap cleanup EXIT

# ─── Print Banner ────────────────────────────────────────────────────────────
show_banner() {
  echo -e "${MAGENTA}${BOLD}"
  echo "========================================================================"
  echo " █▄░█ █▀▀ ▀▄▀ █░█ █▀ █▀█ █▀█ █▀▀   ▀█▀ █▀▀ █▀ ▀█▀ █▀"
  echo " █░▀█ ██▄ █░█ █▄█ ▄█ █▄█ █▄█ ██▄    █  ██▄ ▄█  █  ▄█"
  echo "========================================================================"
  echo -e "${RESET}"
  echo -e "${CYAN}${BOLD} NexusIDE Production-Grade Test Suite Orchestrator${RESET}"
  echo -e "${CYAN} Target:         ${YELLOW}${NEXUS_BASE_URL}${RESET}"
  echo -e "${CYAN} Local Root:     ${YELLOW}${LOCAL_BASE}${RESET}"
  echo -e "${CYAN} Timestamp:      ${YELLOW}$(date +'%Y-%m-%d %H:%M:%S')${RESET}"
  echo "------------------------------------------------------------------------"
}

show_help() {
  echo "NexusIDE Master Test Suite Runner"
  echo ""
  echo "Usage: bash test.sh [OPTION]"
  echo ""
  echo "Options:"
  echo "  --all        Run unit, integration, frontend, and parallel E2E Playwright tests"
  echo "  --backend    Run backend & Yjs CRDT unit/integration tests only"
  echo "  --frontend   Run frontend React component tests only"
  echo "  --e2e        Run Playwright E2E browser tests in parallel (--workers=3) against VM"
  echo "  --ci         Run tests in CI mode (strict exit on failure)"
  echo "  --help       Show this help message"
  echo ""
}

# ─── Pre-flight Checks ───────────────────────────────────────────────────────
preflight_check() {
  log_info "Performing environment & pre-flight sanity checks..."
  for cmd in node npm npx; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      log_error "Required tool '$cmd' is not installed or not in PATH."
      exit 1
    fi
  done

  if [ ! -d "${LOCAL_BASE}/testing/node_modules" ]; then
    log_info "Installing root test suite dependencies..."
    (cd "${LOCAL_BASE}/testing" && npm install --no-audit --no-fund)
  fi
}

verify_target_health() {
  log_info "Checking accessibility of target endpoint: ${NEXUS_BASE_URL}"
  if command -v curl >/dev/null 2>&1; then
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" "${NEXUS_BASE_URL}/" || echo "000")
    if [ "$code" = "200" ] || [ "$code" = "301" ] || [ "$code" = "302" ]; then
      log_success "Target VM responded with HTTP ${code}."
    else
      log_warn "Target VM endpoint returned HTTP ${code}. E2E tests will attempt execution."
    fi
  fi
}

# ─── Test Runners ─────────────────────────────────────────────────────────────
run_backend() {
  section "Backend & Yjs CRDT Unit/Integration Tests"
  local suite_start=$(date +%s)
  if [ -d "${LOCAL_BASE}/backend/node_modules" ]; then
    (cd "${LOCAL_BASE}/backend" && npm test)
  else
    (cd "${LOCAL_BASE}/testing" && npm run test:backend)
  fi
  local suite_end=$(date +%s)
  log_success "Backend tests passed cleanly ✓"
  record_suite "Backend & Yjs Suite" "PASSED" "$((suite_end - suite_start))"
}

run_frontend() {
  section "Frontend React Component Tests"
  local suite_start=$(date +%s)
  if [ -d "${LOCAL_BASE}/frontend/node_modules" ]; then
    (cd "${LOCAL_BASE}/frontend" && npm test)
  else
    (cd "${LOCAL_BASE}/testing" && npm run test:frontend)
  fi
  local suite_end=$(date +%s)
  log_success "Frontend tests passed cleanly ✓"
  record_suite "Frontend Unit Suite" "PASSED" "$((suite_end - suite_start))"
}

run_e2e() {
  section "Playwright End-to-End Browser Specs (Maximum Parallel Execution)"
  verify_target_health
  local suite_start=$(date +%s)
  local max_workers="${PLAYWRIGHT_WORKERS:-100%}"
  log_info "Executing Playwright E2E browser categories in max parallel concurrency (--workers=${max_workers}) against: ${NEXUS_BASE_URL}"
  
  if [ -d "${LOCAL_BASE}/frontend/node_modules" ]; then
    (cd "${LOCAL_BASE}/frontend" && npx playwright test --workers="${max_workers}")
  else
    (cd "${LOCAL_BASE}/testing" && npx playwright test --workers="${max_workers}")
  fi
  local suite_end=$(date +%s)
  log_success "Playwright E2E parallel tests completed successfully ✓"
  record_suite "Playwright E2E Specs (Max Parallel)" "PASSED" "$((suite_end - suite_start))"
}

# ─── Main Dispatch ────────────────────────────────────────────────────────────
MODE="default"
if [ $# -gt 0 ]; then
  case "$1" in
    --all)       MODE="all" ;;
    --backend)   MODE="backend" ;;
    --frontend)  MODE="frontend" ;;
    --e2e)       MODE="e2e" ;;
    --ci)        MODE="all" ;;
    --help|-h)   show_help; exit 0 ;;
    *)
      log_error "Unknown argument: $1"
      show_help
      exit 1
      ;;
  esac
fi

show_banner
preflight_check

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

# ─── Summary Output ───────────────────────────────────────────────────────────
END_TIME=$(date +%s)
TOTAL_DURATION=$((END_TIME - START_TIME))

echo -e "\n${MAGENTA}${BOLD}========================================================================"
echo -e "               MASTER TEST EXECUTION SUMMARY                            "
echo -e "========================================================================${RESET}"
for i in "${!SUMMARY_SUITES[@]}"; do
  printf "${CYAN} %-35s ${GREEN}%-10s${RESET} (${YELLOW}%s${RESET})\n" "${SUMMARY_SUITES[$i]}" "${SUMMARY_STATUS[$i]}" "${SUMMARY_TIMES[$i]}"
done
echo -e "------------------------------------------------------------------------"
echo -e "${GREEN}${BOLD} All requested test suites completed successfully!${RESET}"
echo -e "${CYAN} Total Duration:  ${YELLOW}${TOTAL_DURATION}s${RESET}"
echo -e "${CYAN} Target System:   ${YELLOW}${NEXUS_BASE_URL}${RESET}"
echo -e "${MAGENTA}${BOLD}========================================================================${RESET}\n"

exit 0
