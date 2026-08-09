#!/usr/bin/env bash
# =============================================================================
# test.sh — NexusIDE Production-Grade Master Test Suite Orchestrator
# =============================================================================
# High-Level Architecture: Unified test runner executing unit, service, API,
# database performance, Redis caching, container security, network resilience,
# and Playwright E2E browser tests with clean, filtered, production-grade terminal output.
#
# Usage:
#   bash test.sh              # Run all unit, security & integration tests cleanly
#   bash test.sh --security   # Run container security, cgroups & RBAC tests
#   bash test.sh --resilience # Run network chaos & Redis cluster failover tests
#   bash test.sh --timelapse  # Run Timelapse CRDT unit & isolated E2E tests
#   bash test.sh --db         # Run PostgreSQL & Redis performance benchmarks
#   bash test.sh --services   # Run backend services & algorithm unit tests
#   bash test.sh --integration# Run REST API & Yjs WebSocket integration tests
#   bash test.sh --frontend   # Run frontend React component tests
#   bash test.sh --e2e        # Run Playwright E2E browser specs
#   bash test.sh --all        # Run all test suites end-to-end
#   bash test.sh --verbose    # Run tests with unfiltered raw stdout/stderr
#   bash test.sh --help       # Print usage options
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
DIM='\033[2m'
RESET='\033[0m'

START_TIME=$(date +%s)
SUMMARY_NAMES=()
SUMMARY_STATUS=()
SUMMARY_COUNTS=()
SUMMARY_TIMES=()
VERBOSE=false

log_info()    { echo -e "${CYAN}${BOLD}[INFO]${RESET} $*"; }
log_success() { echo -e "${GREEN}${BOLD}[PASS]${RESET} $*"; }
log_warn()    { echo -e "${YELLOW}${BOLD}[WARN]${RESET} $*"; }
log_error()   { echo -e "${RED}${BOLD}[FAIL]${RESET} $*"; }
step_header() {
  local num="$1"
  local total="$2"
  local title="$3"
  echo -e "\n${BLUE}${BOLD}── [${num}/${total}] ${title} ${RESET}"
}

record_result() {
  local name="$1"
  local status="$2"
  local counts="$3"
  local duration="$4"
  SUMMARY_NAMES+=("$name")
  SUMMARY_STATUS+=("$status")
  SUMMARY_COUNTS+=("$counts")
  SUMMARY_TIMES+=("${duration}s")
}

# ─── Noise Filter ─────────────────────────────────────────────────────────────
filter_output() {
  if [ "$VERBOSE" = true ]; then
    cat
  else
    grep -v -E "(MaxListenersExceededWarning|punycode|ExperimentalWarning|DeprecationWarning|\[PM2\]|Trace:.*MaxListeners)" || true
  fi
}

# ─── Banner & Help ────────────────────────────────────────────────────────────
show_banner() {
  echo -e "${MAGENTA}${BOLD}"
  echo "========================================================================"
  echo " █▄░█ █▀▀ ▀▄▀ █░█ █▀ █▀█ █▀█ █▀▀   ▀█▀ █▀▀ █▀ ▀█▀ █▀"
  echo " █░▀█ ██▄ █░█ █▄█ ▄█ █▄█ █▄█ ██▄    █  ██▄ ▄█  █  ▄█"
  echo "========================================================================"
  echo -e "${RESET}"
  echo -e "${CYAN}${BOLD} NexusIDE Production-Grade Master Test Suite Orchestrator${RESET}"
  echo -e "${CYAN} Target System:  ${YELLOW}${NEXUS_BASE_URL}${RESET}"
  echo -e "${CYAN} Environment:    ${YELLOW}Node $(node -v) | PostgreSQL 16 | Redis 7${RESET}"
  echo -e "${CYAN} Timestamp:      ${YELLOW}$(date +'%Y-%m-%d %H:%M:%S')${RESET}"
  echo -e "${DIM}────────────────────────────────────────────────────────────────────────${RESET}"
}

show_help() {
  echo "NexusIDE Master Test Suite Runner"
  echo ""
  echo "Usage: bash test.sh [OPTION]"
  echo "  --property      Run property-based CRDT fuzzing suite (fast-check)"
  echo "  --idempotency   Run Stripe-standard idempotency & replay attack suite"
  echo "  --chaos         Run Netflix-standard chaos fault injection suite"
  echo "  --contracts     Run Stripe-standard API schema contract suite"
  echo "  --memory        Run Google/Netflix heap memory leak & GC allocation benchmarks"
  echo "  --security      Run container security, cgroup limits & socket RBAC tests"
  echo "  --resilience    Run network flakiness, packet jitter & Redis failover tests"
  echo "  --timelapse     Run Timelapse CRDT engine unit & isolated E2E suites"
  echo "  --db            Run database & Redis performance & resiliency suites"
  echo "  --services      Run backend services & algorithmic unit tests"
  echo "  --integration   Run REST API & Yjs WebSocket integration tests"
  echo "  --frontend      Run frontend React component tests"
  echo "  --e2e           Run Playwright E2E browser tests against VM"
  echo "  --all           Run all test suites end-to-end"
  echo "  --verbose       Show full raw stdout/stderr output"
  echo "  --help, -h      Show this help message"
  echo ""
  echo "Examples:"
  echo "  bash test.sh"
  echo "  bash test.sh --security"
  echo "  bash test.sh --timelapse"
  echo "  bash test.sh --all"
  echo ""
}

# ─── Test Suite Runners ───────────────────────────────────────────────────────

run_property() {
  local t_start=$(date +%s)
  echo -e "${DIM}Executing fast-check property-based CRDT fuzzing & invariant proofs...${RESET}"
  
  if (cd "${LOCAL_BASE}/backend" && npx vitest run ../testing/property/ --reporter=default); then
    local t_end=$(date +%s)
    local elapsed=$((t_end - t_start))
    log_success "Property-based CRDT fuzzing tests passed in ${elapsed}s ✓"
    record_result "Property CRDT Fuzzing Suite" "PASSED ✓" "4 Invariants" "$elapsed"
  else
    local t_end=$(date +%s)
    log_error "Property-based CRDT fuzzing tests encountered failures."
    record_result "Property CRDT Fuzzing Suite" "FAILED ✗" "Failures" "$((t_end - t_start))"
    return 1
  fi
}

run_idempotency() {
  local t_start=$(date +%s)
  echo -e "${DIM}Executing idempotency, update vector replay, and corrupt snapshot recovery...${RESET}"
  
  if (cd "${LOCAL_BASE}/backend" && npx vitest run ../testing/idempotency/ --reporter=default); then
    local t_end=$(date +%s)
    local elapsed=$((t_end - t_start))
    log_success "Idempotency & replay attack tests passed in ${elapsed}s ✓"
    record_result "Idempotency & Replay Suite" "PASSED ✓" "4 Tests" "$elapsed"
  else
    local t_end=$(date +%s)
    log_error "Idempotency & replay tests encountered failures."
    record_result "Idempotency & Replay Suite" "FAILED ✗" "Failures" "$((t_end - t_start))"
    return 1
  fi
}

run_chaos() {
  local t_start=$(date +%s)
  echo -e "${DIM}Executing Netflix-standard fault injection, Redis disconnects & PTY crash recovery...${RESET}"
  
  if (cd "${LOCAL_BASE}/backend" && npx vitest run ../testing/chaos/ --reporter=default); then
    local t_end=$(date +%s)
    local elapsed=$((t_end - t_start))
    log_success "Chaos engineering & fault injection tests passed in ${elapsed}s ✓"
    record_result "Chaos Fault Injection Suite" "PASSED ✓" "4 Tests" "$elapsed"
  else
    local t_end=$(date +%s)
    log_error "Chaos engineering tests encountered failures."
    record_result "Chaos Fault Injection Suite" "FAILED ✗" "Failures" "$((t_end - t_start))"
    return 1
  fi
}

run_contracts() {
  local t_start=$(date +%s)
  echo -e "${DIM}Executing Stripe-standard REST & WebSocket API schema contract verification...${RESET}"
  
  if (cd "${LOCAL_BASE}/backend" && npx vitest run ../testing/contracts/ --reporter=default); then
    local t_end=$(date +%s)
    local elapsed=$((t_end - t_start))
    log_success "API schema & backward compatibility contract tests passed in ${elapsed}s ✓"
    record_result "API Schema Contract Suite" "PASSED ✓" "4 Contracts" "$elapsed"
  else
    local t_end=$(date +%s)
    log_error "API schema contract tests encountered failures."
    record_result "API Schema Contract Suite" "FAILED ✗" "Failures" "$((t_end - t_start))"
    return 1
  fi
}

run_memory() {
  local t_start=$(date +%s)
  echo -e "${DIM}Executing Google & Netflix heap memory leak & GC allocation benchmarks...${RESET}"
  
  if (cd "${LOCAL_BASE}/backend" && npx vitest run ../testing/perf/ --reporter=default); then
    local t_end=$(date +%s)
    local elapsed=$((t_end - t_start))
    log_success "Heap memory leak & allocation benchmarks passed in ${elapsed}s ✓"
    record_result "Heap & Memory Leak Suite" "PASSED ✓" "3 Benchmarks" "$elapsed"
  else
    local t_end=$(date +%s)
    log_error "Heap memory leak benchmarks encountered failures."
    record_result "Heap & Memory Leak Suite" "FAILED ✗" "Failures" "$((t_end - t_start))"
    return 1
  fi
}

run_services() {
  local t_start=$(date +%s)
  echo -e "${DIM}Executing service layer algorithms, timelapse engine & in-memory caches...${RESET}"
  
  if (cd "${LOCAL_BASE}/backend" && npx vitest run ../testing/services/ --reporter=default); then
    local t_end=$(date +%s)
    local elapsed=$((t_end - t_start))
    log_success "Backend services & unit tests passed in ${elapsed}s ✓"
    record_result "Services & Algorithm Unit Suite" "PASSED ✓" "20 Files (137T)" "$elapsed"
  else
    local t_end=$(date +%s)
    log_error "Service unit tests encountered failures."
    record_result "Services & Algorithm Unit Suite" "FAILED ✗" "Failures" "$((t_end - t_start))"
    return 1
  fi
}

run_security() {
  local t_start=$(date +%s)
  echo -e "${DIM}Executing container security (cgroups/OOM), sandbox isolation & socket RBAC...${RESET}"
  
  if (cd "${LOCAL_BASE}/backend" && npx vitest run ../testing/services/container-security.test.ts ../testing/services/rbac-security.test.ts --reporter=default); then
    local t_end=$(date +%s)
    local elapsed=$((t_end - t_start))
    log_success "Container security & RBAC guardrail tests passed in ${elapsed}s ✓"
    record_result "Container Security & RBAC Suite" "PASSED ✓" "6 Tests" "$elapsed"
  else
    local t_end=$(date +%s)
    log_error "Security tests encountered failures."
    record_result "Container Security & RBAC Suite" "FAILED ✗" "Failures" "$((t_end - t_start))"
    return 1
  fi
}

run_resilience() {
  local t_start=$(date +%s)
  echo -e "${DIM}Executing network chaos, packet jitter, and Redis Redlock cluster failover...${RESET}"
  
  if (cd "${LOCAL_BASE}/backend" && npx vitest run ../testing/services/network-resilience.test.ts ../testing/services/redis-cluster-failures.test.ts --reporter=default); then
    local t_end=$(date +%s)
    local elapsed=$((t_end - t_start))
    log_success "Network resilience & Redis failover tests passed in ${elapsed}s ✓"
    record_result "Network & Cluster Failover Suite" "PASSED ✓" "7 Tests" "$elapsed"
  else
    local t_end=$(date +%s)
    log_error "Resilience tests encountered failures."
    record_result "Network & Cluster Failover Suite" "FAILED ✗" "Failures" "$((t_end - t_start))"
    return 1
  fi
}

run_timelapse() {
  local t_start=$(date +%s)
  echo -e "${DIM}Executing Timelapse CRDT unit and isolated E2E test suites...${RESET}"
  
  if (cd "${LOCAL_BASE}/backend" && npx vitest run ../testing/services/timelapseEngine.test.ts ../testing/services/timelapse.test.ts --reporter=default); then
    local t_end=$(date +%s)
    local elapsed=$((t_end - t_start))
    log_success "Timelapse CRDT engine tests passed in ${elapsed}s ✓"
    record_result "Timelapse CRDT Engine Suite" "PASSED ✓" "16 Tests" "$elapsed"
  else
    local t_end=$(date +%s)
    log_error "Timelapse tests encountered failures."
    record_result "Timelapse CRDT Engine Suite" "FAILED ✗" "Failures" "$((t_end - t_start))"
    return 1
  fi
}

run_integration() {
  local t_start=$(date +%s)
  echo -e "${DIM}Executing REST APIs, JWT authentication, and WebSocket CRDT suites...${RESET}"
  
  if (cd "${LOCAL_BASE}/backend" && npx vitest run ../testing/integration/ --reporter=default); then
    local t_end=$(date +%s)
    local elapsed=$((t_end - t_start))
    log_success "REST & WebSocket integration tests passed in ${elapsed}s ✓"
    record_result "REST API & WebSocket Suite" "PASSED ✓" "85 Tests" "$elapsed"
  else
    local t_end=$(date +%s)
    log_error "Integration tests encountered failures."
    record_result "REST API & WebSocket Suite" "FAILED ✗" "Failures" "$((t_end - t_start))"
    return 1
  fi
}

run_db() {
  local t_start=$(date +%s)
  echo -e "${DIM}Running database covering indexes, Redis L2, Write-Behind & Presence suites...${RESET}"
  
  if [ "$MODE" != "db" ] && [ "$MODE" != "all" ]; then
    log_info "Skipping live PostgreSQL DB tests (use bash test.sh --db to run DB tests)."
    record_result "PostgreSQL & Redis DB Suite" "SKIPPED" "38 Tests" "0"
    return 0
  fi

  local output=""
  if output=$(bash "${LOCAL_BASE}/test-db.sh" 2>&1); then
    local t_end=$(date +%s)
    local elapsed=$((t_end - t_start))
    record_result "PostgreSQL & Redis DB Suite" "PASSED ✓" "38 Tests" "$elapsed"
  else
    local t_end=$(date +%s)
    record_result "PostgreSQL & Redis DB Suite" "FAILED ✗" "Failures" "$((t_end - t_start))"
    return 1
  fi
}

run_frontend() {
  local t_start=$(date +%s)
  echo -e "${DIM}Executing React component rendering & Monaco collaborative UI bindings...${RESET}"
  
  if (cd "${LOCAL_BASE}/frontend" && npx vitest run ../testing/frontend/ --reporter=default); then
    local t_end=$(date +%s)
    local elapsed=$((t_end - t_start))
    log_success "Frontend React component tests passed in ${elapsed}s ✓"
    record_result "Frontend React & Monaco Suite" "PASSED ✓" "20 Tests" "$elapsed"
  else
    local t_end=$(date +%s)
    log_error "Frontend component tests encountered failures."
    record_result "Frontend React & Monaco Suite" "FAILED ✗" "Failures" "$((t_end - t_start))"
    return 1
  fi
}

LAST_FAILED=""
EXTRA_ARGS=()

run_e2e() {
  local t_start=$(date +%s)
  local max_workers="${PLAYWRIGHT_WORKERS:-100%}"
  local flags=()
  if [ -n "$LAST_FAILED" ]; then
    flags+=("--last-failed")
  fi
  if [ ${#EXTRA_ARGS[@]} -gt 0 ]; then
    flags+=("${EXTRA_ARGS[@]}")
  fi

  echo -e "${DIM}Executing Playwright browser journeys in maximum parallel concurrency (--workers=${max_workers}) against target ${NEXUS_BASE_URL}...${RESET}"
  
  if (cd "${LOCAL_BASE}/frontend" && npx playwright test --config playwright.config.ts --reporter=list --workers="${max_workers}" ${flags[@]+"${flags[@]}"}); then
    local t_end=$(date +%s)
    local elapsed=$((t_end - t_start))
    log_success "Playwright E2E browser tests passed in ${elapsed}s ✓"
    record_result "Playwright E2E Browser Suite" "PASSED ✓" "All Specs" "$elapsed"
  else
    local t_end=$(date +%s)
    log_error "Playwright E2E browser tests encountered failures."
    record_result "Playwright E2E Browser Suite" "FAILED ✗" "Failures" "$((t_end - t_start))"
    return 1
  fi
}

# ─── Master Summary Dashboard ─────────────────────────────────────────────────
show_summary_dashboard() {
  local total_duration=$(($(date +%s) - START_TIME))
  
  echo ""
  echo -e "${MAGENTA}${BOLD}================================================================================${RESET}"
  echo -e "${MAGENTA}${BOLD}                      MASTER TEST EXECUTION SUMMARY                             ${RESET}"
  echo -e "${MAGENTA}${BOLD}================================================================================${RESET}"
  printf "${BOLD}%-40s %-16s %-12s %-10s${RESET}\n" "Test Suite Category" "Coverage / Scope" "Duration" "Status"
  echo -e "${DIM}────────────────────────────────────────────────────────────────────────────────${RESET}"

  local all_passed=true
  for i in "${!SUMMARY_NAMES[@]}"; do
    local st="${SUMMARY_STATUS[$i]}"
    local color="$GREEN"
    if [[ "$st" == *"FAIL"* ]]; then
      color="$RED"
      all_passed=false
    fi
    printf "%-40s %-16s %-12s ${color}%-10s${RESET}\n" \
      "${SUMMARY_NAMES[$i]}" \
      "${SUMMARY_COUNTS[$i]}" \
      "${SUMMARY_TIMES[$i]}" \
      "$st"
  done

  echo -e "${DIM}────────────────────────────────────────────────────────────────────────────────${RESET}"
  if [ "$all_passed" = true ]; then
    echo -e "  ${GREEN}${BOLD}✔ ALL TEST SUITES PASSED (100% SUCCESS)${RESET}"
  else
    echo -e "  ${RED}${BOLD}✖ SOME TEST SUITES ENCOUNTERED FAILURES${RESET}"
  fi
  echo -e "  • Total Duration:  ${YELLOW}${total_duration}s${RESET}"
  echo -e "  • Target System:   ${YELLOW}${NEXUS_BASE_URL}${RESET}"
  echo -e "${MAGENTA}${BOLD}================================================================================${RESET}\n"

  if [ "$all_passed" = false ]; then
    exit 1
  fi
}

# ─── Main Dispatch ────────────────────────────────────────────────────────────
show_banner

MODE="default"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --verbose|-v)     VERBOSE=true; shift ;;
    --last-failed|--failed|-lf) LAST_FAILED="true"; MODE="e2e"; shift ;;
    --property)       MODE="property"; shift ;;
    --idempotency)    MODE="idempotency"; shift ;;
    --chaos)          MODE="chaos"; shift ;;
    --contracts)      MODE="contracts"; shift ;;
    --memory|--leak)  MODE="memory"; shift ;;
    --security)       MODE="security"; shift ;;
    --resilience)     MODE="resilience"; shift ;;
    --timelapse)      MODE="timelapse"; shift ;;
    --db)             MODE="db"; shift ;;
    --services)       MODE="services"; shift ;;
    --integration)    MODE="integration"; shift ;;
    --frontend)       MODE="frontend"; shift ;;
    --e2e)            MODE="e2e"; shift ;;
    --all)            MODE="all"; shift ;;
    -g|--grep)        EXTRA_ARGS+=("-g" "$2"); MODE="e2e"; shift 2 ;;
    --help|-h)        show_help; exit 0 ;;
    *)
      if [[ "$1" == *.spec.ts* ]]; then
        EXTRA_ARGS+=("$1")
        MODE="e2e"
      else
        log_error "Unknown argument: $1"
        show_help
        exit 1
      fi
      shift
      ;;
  esac
done

case "$MODE" in
  property)
    step_header "1" "1" "Property-Based CRDT Fuzzing & Invariant Proofs"
    run_property
    ;;
  idempotency)
    step_header "1" "1" "Idempotency & Replay Attack Suite"
    run_idempotency
    ;;
  chaos)
    step_header "1" "1" "Chaos Fault Injection & Infrastructure Recovery"
    run_chaos
    ;;
  contracts)
    step_header "1" "1" "API Schema & Compatibility Contract Suite"
    run_contracts
    ;;
  memory)
    step_header "1" "1" "Heap Memory Leak & Allocation Benchmarks"
    run_memory
    ;;
  services)
    step_header "1" "1" "Backend Services & Algorithmic Unit Tests"
    run_services
    ;;
  security)
    step_header "1" "1" "Container Security & RBAC Guardrail Tests"
    run_security
    ;;
  resilience)
    step_header "1" "1" "Network Resilience & Redis Cluster Failover Tests"
    run_resilience
    ;;
  timelapse)
    step_header "1" "1" "Timelapse CRDT Engine Unit & Isolated Suites"
    run_timelapse
    ;;
  integration)
    step_header "1" "1" "REST API & WebSocket Integration Tests"
    run_integration
    ;;
  db)
    step_header "1" "1" "PostgreSQL & Redis Performance Benchmarks"
    run_db
    ;;
  frontend)
    step_header "1" "1" "Frontend React & Monaco Component Tests"
    run_frontend
    ;;
  e2e)
    step_header "1" "1" "Playwright E2E Browser Specs"
    run_e2e
    ;;
  default|all)
    step_header "1" "12" "Property-Based CRDT Fuzzing & Invariant Proofs"
    run_property || true
    step_header "2" "12" "Idempotency & Replay Attack Suite"
    run_idempotency || true
    step_header "3" "12" "Chaos Fault Injection & Infrastructure Recovery"
    run_chaos || true
    step_header "4" "12" "API Schema & Compatibility Contract Suite"
    run_contracts || true
    step_header "5" "12" "Heap Memory Leak & Allocation Benchmarks"
    run_memory || true
    step_header "6" "12" "Backend Services & Algorithmic Unit Tests"
    run_services || true
    step_header "7" "12" "Container Security & RBAC Guardrail Tests"
    run_security || true
    step_header "8" "12" "Network Resilience & Redis Failover Tests"
    run_resilience || true
    step_header "9" "12" "Timelapse CRDT Engine Unit & Isolated Suites"
    run_timelapse || true
    step_header "10" "12" "REST API & WebSocket Integration Tests"
    run_integration || true
    step_header "11" "12" "PostgreSQL & Redis Performance Benchmarks"
    run_db || true
    step_header "12" "12" "Frontend React & Monaco Component Tests"
    run_frontend || true
    ;;
esac

show_summary_dashboard
