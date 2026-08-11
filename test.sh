#!/usr/bin/env bash
# =============================================================================
# test.sh — NexusIDE Production-Grade Master Test Suite Orchestrator
# =============================================================================
# High-Level Architecture: Unified test runner executing unit, service, API,
# database performance, Redis caching, container security, network resilience,
# OAuth/JWT security, WebSocket conformance, snapshot Merkle DAG, DB migration,
# rate-limiting, CRDT stress, PTY buffer overflow, RBAC matrix, and Playwright E2E browser tests.
#
# Usage:
#   bash test.sh              # Run all unit, security & integration tests cleanly
#   bash test.sh --property      # Run property-based CRDT fuzzing
#   bash test.sh --idempotency   # Run Stripe-standard idempotency & replay
#   bash test.sh --chaos         # Run Netflix-standard fault injection
#   bash test.sh --contracts     # Run REST & WebSocket API schema contracts
#   bash test.sh --memory        # Run heap memory leak benchmarks
#   bash test.sh --auth          # Run OAuth & JWT security boundary suite
#   bash test.sh --ws            # Run WebSocket protocol conformance suite
#   bash test.sh --snapshot      # Run Merkle DAG integrity & snapshot restore suite
#   bash test.sh --migration     # Run database schema & rollback safety suite
#   bash test.sh --rate-limiting # Run API rate limiting & DDoS protection suite
#   bash test.sh --crdt-stress   # Run large document CRDT stress suite
#   bash test.sh --pty-stress    # Run terminal PTY buffer overflow suite
#   bash test.sh --rbac-matrix   # Run 3x12 RBAC permissions matrix suite
#   bash test.sh --security      # Run container security & RBAC tests
#   bash test.sh --resilience    # Run network chaos & Redis cluster failover tests
#   bash test.sh --timelapse     # Run Timelapse CRDT engine unit tests
#   bash test.sh --db            # Run PostgreSQL & Redis performance benchmarks
#   bash test.sh --services      # Run backend services & algorithm unit tests
#   bash test.sh --integration   # Run REST API & Yjs WebSocket integration tests
#   bash test.sh --frontend      # Run frontend React component tests
#   bash test.sh --e2e           # Run Playwright E2E browser specs
#   bash test.sh --all           # Run all test suites end-to-end
#   bash test.sh --verbose       # Run tests with unfiltered raw stdout/stderr
#   bash test.sh --help          # Print usage options
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
  echo "  --auth          Run OAuth & JWT security boundary suite"
  echo "  --ws            Run WebSocket protocol conformance suite"
  echo "  --snapshot      Run Merkle DAG integrity & snapshot restore suite"
  echo "  --migration     Run database schema & rollback safety suite"
  echo "  --rate-limiting Run API rate limiting & DDoS protection suite"
  echo "  --crdt-stress   Run large document CRDT stress suite"
  echo "  --pty-stress    Run terminal PTY buffer overflow & ANSI parser suite"
  echo "  --rbac-matrix   Run 3x12 RBAC permissions matrix suite"
  echo "  --security      Run container security, cgroup limits & socket RBAC tests"
  echo "  --resilience    Run network flakiness, packet jitter & Redis failover tests"
  echo "  --timelapse     Run Timelapse CRDT engine unit & isolated E2E suites"
  echo "  --db            Run database & Redis performance & resiliency suites"
  echo "  --services      Run backend services & algorithm unit tests"
  echo "  --integration   Run REST API & Yjs WebSocket integration tests"
  echo "  --frontend      Run frontend React component tests"
  echo "  --e2e           Run Playwright E2E browser tests against VM"
  echo "  --all           Run all test suites end-to-end"
  echo "  --verbose       Show full raw stdout/stderr output"
  echo "  --help, -h      Show this help message"
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
    record_result "Property CRDT Fuzzing Suite" "PASSED ✓" "10 Invariants" "$elapsed"
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
    record_result "Idempotency & Replay Suite" "PASSED ✓" "8 Tests" "$elapsed"
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
    record_result "Chaos Fault Injection Suite" "PASSED ✓" "10 Tests" "$elapsed"
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
    record_result "API Schema Contract Suite" "PASSED ✓" "12 Contracts" "$elapsed"
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
    record_result "Heap & Memory Leak Suite" "PASSED ✓" "8 Benchmarks" "$elapsed"
  else
    local t_end=$(date +%s)
    log_error "Heap memory leak benchmarks encountered failures."
    record_result "Heap & Memory Leak Suite" "FAILED ✗" "Failures" "$((t_end - t_start))"
    return 1
  fi
}

run_auth() {
  local t_start=$(date +%s)
  echo -e "${DIM}Executing OAuth & JWT security boundary suite...${RESET}"
  if (cd "${LOCAL_BASE}/backend" && npx vitest run ../testing/auth/ --reporter=default); then
    local t_end=$(date +%s)
    local elapsed=$((t_end - t_start))
    log_success "OAuth & JWT security tests passed in ${elapsed}s ✓"
    record_result "OAuth & JWT Security Suite" "PASSED ✓" "8 Tests" "$elapsed"
  else
    local t_end=$(date +%s)
    log_error "OAuth & JWT security tests encountered failures."
    record_result "OAuth & JWT Security Suite" "FAILED ✗" "Failures" "$((t_end - t_start))"
    return 1
  fi
}

run_ws() {
  local t_start=$(date +%s)
  echo -e "${DIM}Executing WebSocket protocol conformance & keepalive suite...${RESET}"
  if (cd "${LOCAL_BASE}/backend" && npx vitest run ../testing/ws/ --reporter=default); then
    local t_end=$(date +%s)
    local elapsed=$((t_end - t_start))
    log_success "WebSocket conformance tests passed in ${elapsed}s ✓"
    record_result "WebSocket Conformance Suite" "PASSED ✓" "5 Tests" "$elapsed"
  else
    local t_end=$(date +%s)
    log_error "WebSocket conformance tests encountered failures."
    record_result "WebSocket Conformance Suite" "FAILED ✗" "Failures" "$((t_end - t_start))"
    return 1
  fi
}

run_snapshot() {
  local t_start=$(date +%s)
  echo -e "${DIM}Executing Merkle DAG integrity & snapshot restore suite...${RESET}"
  if (cd "${LOCAL_BASE}/backend" && npx vitest run ../testing/snapshot/ --reporter=default); then
    local t_end=$(date +%s)
    local elapsed=$((t_end - t_start))
    log_success "Merkle DAG & snapshot tests passed in ${elapsed}s ✓"
    record_result "Snapshot Merkle DAG Suite" "PASSED ✓" "5 Tests" "$elapsed"
  else
    local t_end=$(date +%s)
    log_error "Merkle DAG & snapshot tests encountered failures."
    record_result "Snapshot Merkle DAG Suite" "FAILED ✗" "Failures" "$((t_end - t_start))"
    return 1
  fi
}

run_migration() {
  local t_start=$(date +%s)
  echo -e "${DIM}Executing database schema migration & rollback safety suite...${RESET}"
  if (cd "${LOCAL_BASE}/backend" && npx vitest run ../testing/migration/ --reporter=default); then
    local t_end=$(date +%s)
    local elapsed=$((t_end - t_start))
    log_success "Database schema & rollback tests passed in ${elapsed}s ✓"
    record_result "DB Migration & Rollback Suite" "PASSED ✓" "2 Tests" "$elapsed"
  else
    local t_end=$(date +%s)
    log_error "Database migration tests encountered failures."
    record_result "DB Migration & Rollback Suite" "FAILED ✗" "Failures" "$((t_end - t_start))"
    return 1
  fi
}

run_rate_limiting() {
  local t_start=$(date +%s)
  echo -e "${DIM}Executing API rate limiting & DDoS protection suite...${RESET}"
  if (cd "${LOCAL_BASE}/backend" && npx vitest run ../testing/rate-limiting/ --reporter=default); then
    local t_end=$(date +%s)
    local elapsed=$((t_end - t_start))
    log_success "API rate limiting tests passed in ${elapsed}s ✓"
    record_result "API Rate Limiting Suite" "PASSED ✓" "2 Tests" "$elapsed"
  else
    local t_end=$(date +%s)
    log_error "API rate limiting tests encountered failures."
    record_result "API Rate Limiting Suite" "FAILED ✗" "Failures" "$((t_end - t_start))"
    return 1
  fi
}

run_crdt_stress() {
  local t_start=$(date +%s)
  echo -e "${DIM}Executing large document CRDT stress & deep history compaction suite...${RESET}"
  if (cd "${LOCAL_BASE}/backend" && npx vitest run ../testing/crdt-stress/ --reporter=default); then
    local t_end=$(date +%s)
    local elapsed=$((t_end - t_start))
    log_success "Large document CRDT stress tests passed in ${elapsed}s ✓"
    record_result "CRDT Stress & History Suite" "PASSED ✓" "2 Tests" "$elapsed"
  else
    local t_end=$(date +%s)
    log_error "CRDT stress tests encountered failures."
    record_result "CRDT Stress & History Suite" "FAILED ✗" "Failures" "$((t_end - t_start))"
    return 1
  fi
}

run_pty_stress() {
  local t_start=$(date +%s)
  echo -e "${DIM}Executing PTY buffer overflow & ANSI escape sequence parser suite...${RESET}"
  if (cd "${LOCAL_BASE}/backend" && npx vitest run ../testing/pty-stress/ --reporter=default); then
    local t_end=$(date +%s)
    local elapsed=$((t_end - t_start))
    log_success "PTY buffer & ANSI parser tests passed in ${elapsed}s ✓"
    record_result "PTY Buffer & ANSI Parser Suite" "PASSED ✓" "2 Tests" "$elapsed"
  else
    local t_end=$(date +%s)
    log_error "PTY buffer tests encountered failures."
    record_result "PTY Buffer & ANSI Parser Suite" "FAILED ✗" "Failures" "$((t_end - t_start))"
    return 1
  fi
}

run_rbac_matrix() {
  local t_start=$(date +%s)
  echo -e "${DIM}Executing exhaustive 3x12 RBAC permissions matrix suite...${RESET}"
  if (cd "${LOCAL_BASE}/backend" && npx vitest run ../testing/rbac-matrix/ --reporter=default); then
    local t_end=$(date +%s)
    local elapsed=$((t_end - t_start))
    log_success "Exhaustive 3x12 RBAC matrix tests passed in ${elapsed}s ✓"
    record_result "RBAC 3x12 Permissions Matrix" "PASSED ✓" "3 Tests" "$elapsed"
  else
    local t_end=$(date +%s)
    log_error "RBAC permissions matrix tests encountered failures."
    record_result "RBAC 3x12 Permissions Matrix" "FAILED ✗" "Failures" "$((t_end - t_start))"
    return 1
  fi
}

run_collab() {
  local t_start=$(date +%s)
  echo -e "${DIM}Executing multi-peer convergence, awareness reconnect & cross-pod sync suite...${RESET}"
  if (cd "${LOCAL_BASE}/backend" && npx vitest run ../testing/collab/ --reporter=default); then
    local t_end=$(date +%s)
    local elapsed=$((t_end - t_start))
    log_success "Multi-peer collaboration tests passed in ${elapsed}s ✓"
    record_result "Multi-Peer Collaboration Suite" "PASSED ✓" "3 Tests" "$elapsed"
  else
    local t_end=$(date +%s)
    log_error "Multi-peer collaboration tests encountered failures."
    record_result "Multi-Peer Collaboration Suite" "FAILED ✗" "Failures" "$((t_end - t_start))"
    return 1
  fi
}

run_lsp() {
  local t_start=$(date +%s)
  echo -e "${DIM}Executing LSP protocol sequencing, diagnostics latency & crash recovery suite...${RESET}"
  if (cd "${LOCAL_BASE}/backend" && npx vitest run ../testing/lsp/ --reporter=default); then
    local t_end=$(date +%s)
    local elapsed=$((t_end - t_start))
    log_success "LSP protocol lifecycle tests passed in ${elapsed}s ✓"
    record_result "LSP Protocol Lifecycle Suite" "PASSED ✓" "3 Tests" "$elapsed"
  else
    local t_end=$(date +%s)
    log_error "LSP protocol tests encountered failures."
    record_result "LSP Protocol Lifecycle Suite" "FAILED ✗" "Failures" "$((t_end - t_start))"
    return 1
  fi
}

run_observability() {
  local t_start=$(date +%s)
  echo -e "${DIM}Executing structured JSON logging, audit trail & health contracts suite...${RESET}"
  if (cd "${LOCAL_BASE}/backend" && npx vitest run ../testing/observability/ --reporter=default); then
    local t_end=$(date +%s)
    local elapsed=$((t_end - t_start))
    log_success "Observability & audit tests passed in ${elapsed}s ✓"
    record_result "Observability & Audit Suite" "PASSED ✓" "3 Tests" "$elapsed"
  else
    local t_end=$(date +%s)
    log_error "Observability tests encountered failures."
    record_result "Observability & Audit Suite" "FAILED ✗" "Failures" "$((t_end - t_start))"
    return 1
  fi
}

run_git() {
  local t_start=$(date +%s)
  echo -e "${DIM}Executing Git conflict parser, stage atomicity & concurrent resolution suite...${RESET}"
  if (cd "${LOCAL_BASE}/backend" && npx vitest run ../testing/git/ --reporter=default); then
    local t_end=$(date +%s)
    local elapsed=$((t_end - t_start))
    log_success "Git edge cases & conflict tests passed in ${elapsed}s ✓"
    record_result "Git Integration Edge Cases" "PASSED ✓" "3 Tests" "$elapsed"
  else
    local t_end=$(date +%s)
    log_error "Git tests encountered failures."
    record_result "Git Integration Edge Cases" "FAILED ✗" "Failures" "$((t_end - t_start))"
    return 1
  fi
}

run_accessibility() {
  local t_start=$(date +%s)
  echo -e "${DIM}Executing WCAG 2.1 AA ARIA roles, keyboard nav & focus trap suite...${RESET}"
  if (cd "${LOCAL_BASE}/backend" && npx vitest run ../testing/accessibility/ --reporter=default); then
    local t_end=$(date +%s)
    local elapsed=$((t_end - t_start))
    log_success "Accessibility WCAG 2.1 AA tests passed in ${elapsed}s ✓"
    record_result "Accessibility WCAG 2.1 AA Suite" "PASSED ✓" "3 Tests" "$elapsed"
  else
    local t_end=$(date +%s)
    log_error "Accessibility tests encountered failures."
    record_result "Accessibility WCAG 2.1 AA Suite" "FAILED ✗" "Failures" "$((t_end - t_start))"
    return 1
  fi
}

run_data_integrity() {
  local t_start=$(date +%s)
  echo -e "${DIM}Executing Redis key scoping, snapshot boundary & compactor scoping suite...${RESET}"
  if (cd "${LOCAL_BASE}/backend" && npx vitest run ../testing/data-integrity/ --reporter=default); then
    local t_end=$(date +%s)
    local elapsed=$((t_end - t_start))
    log_success "Data integrity & isolation tests passed in ${elapsed}s ✓"
    record_result "Data Integrity & Isolation Suite" "PASSED ✓" "3 Tests" "$elapsed"
  else
    local t_end=$(date +%s)
    log_error "Data integrity tests encountered failures."
    record_result "Data Integrity & Isolation Suite" "FAILED ✗" "Failures" "$((t_end - t_start))"
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
    record_result "Container Security & RBAC Suite" "PASSED ✓" "18 Tests" "$elapsed"
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
    record_result "Network & Cluster Failover Suite" "PASSED ✓" "18 Tests" "$elapsed"
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
  if bash "${LOCAL_BASE}/test-db.sh"; then
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
  local max_workers="${PLAYWRIGHT_WORKERS:-2}"
  local flags=()
  if [ -n "$LAST_FAILED" ]; then
    flags+=("--last-failed")
  fi
  if [ ${#EXTRA_ARGS[@]} -gt 0 ]; then
    flags+=("${EXTRA_ARGS[@]}")
  fi

  echo -e "${DIM}Running system storage cleanup routine before E2E run...${RESET}"
  (cd "${LOCAL_BASE}/backend" && npx tsx src/cli/cleanup.cli.ts 2>/dev/null || true)

  echo -e "${DIM}Executing Playwright browser journeys with controlled concurrency (--workers=${max_workers}) against target ${NEXUS_BASE_URL}...${RESET}"
  if (cd "${LOCAL_BASE}/testing" && npx playwright test e2e/ --config playwright.config.ts --reporter=list --workers="${max_workers}" ${flags[@]+"${flags[@]}"}); then
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
    --auth)           MODE="auth"; shift ;;
    --ws)             MODE="ws"; shift ;;
    --snapshot)       MODE="snapshot"; shift ;;
    --migration)      MODE="migration"; shift ;;
    --rate-limiting)  MODE="rate_limiting"; shift ;;
    --crdt-stress)    MODE="crdt_stress"; shift ;;
    --pty-stress)     MODE="pty_stress"; shift ;;
    --rbac-matrix)    MODE="rbac_matrix"; shift ;;
    --collab)         MODE="collab"; shift ;;
    --lsp)            MODE="lsp"; shift ;;
    --observability)  MODE="observability"; shift ;;
    --git)            MODE="git"; shift ;;
    --accessibility)  MODE="accessibility"; shift ;;
    --data-integrity) MODE="data_integrity"; shift ;;
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
  auth)
    step_header "1" "1" "OAuth & JWT Security Boundary Suite"
    run_auth
    ;;
  ws)
    step_header "1" "1" "WebSocket Protocol Conformance Suite"
    run_ws
    ;;
  snapshot)
    step_header "1" "1" "Merkle DAG Integrity & Snapshot Restore Suite"
    run_snapshot
    ;;
  migration)
    step_header "1" "1" "Database Schema & Rollback Safety Suite"
    run_migration
    ;;
  rate_limiting)
    step_header "1" "1" "API Rate Limiting & DDoS Protection Suite"
    run_rate_limiting
    ;;
  crdt_stress)
    step_header "1" "1" "Large Document CRDT Stress Suite"
    run_crdt_stress
    ;;
  pty_stress)
    step_header "1" "1" "PTY Buffer Overflow & ANSI Parser Suite"
    run_pty_stress
    ;;
  rbac_matrix)
    step_header "1" "1" "Exhaustive 3x12 RBAC Permissions Matrix"
    run_rbac_matrix
    ;;
  collab)
    step_header "1" "1" "Multi-Peer Collaboration & Convergence Suite"
    run_collab
    ;;
  lsp)
    step_header "1" "1" "LSP Protocol Lifecycle Suite"
    run_lsp
    ;;
  observability)
    step_header "1" "1" "Observability & Audit Trail Suite"
    run_observability
    ;;
  git)
    step_header "1" "1" "Git Integration Edge Cases Suite"
    run_git
    ;;
  accessibility)
    step_header "1" "1" "Accessibility WCAG 2.1 AA Suite"
    run_accessibility
    ;;
  data_integrity)
    step_header "1" "1" "Data Integrity & Isolation Suite"
    run_data_integrity
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
    step_header "1" "26" "Property-Based CRDT Fuzzing & Invariant Proofs"
    run_property || true
    step_header "2" "26" "Idempotency & Replay Attack Suite"
    run_idempotency || true
    step_header "3" "26" "Chaos Fault Injection & Infrastructure Recovery"
    run_chaos || true
    step_header "4" "26" "API Schema & Compatibility Contract Suite"
    run_contracts || true
    step_header "5" "26" "Heap Memory Leak & Allocation Benchmarks"
    run_memory || true
    step_header "6" "26" "OAuth & JWT Security Boundary Suite"
    run_auth || true
    step_header "7" "26" "WebSocket Protocol Conformance Suite"
    run_ws || true
    step_header "8" "26" "Merkle DAG Integrity & Snapshot Restore Suite"
    run_snapshot || true
    step_header "9" "26" "Database Schema & Rollback Safety Suite"
    run_migration || true
    step_header "10" "26" "API Rate Limiting & DDoS Protection Suite"
    run_rate_limiting || true
    step_header "11" "26" "Large Document CRDT Stress Suite"
    run_crdt_stress || true
    step_header "12" "26" "PTY Buffer Overflow & ANSI Parser Suite"
    run_pty_stress || true
    step_header "13" "26" "Exhaustive 3x12 RBAC Permissions Matrix"
    run_rbac_matrix || true
    step_header "14" "26" "Multi-Peer Collaboration & Convergence Suite"
    run_collab || true
    step_header "15" "26" "LSP Protocol Lifecycle Suite"
    run_lsp || true
    step_header "16" "26" "Observability & Audit Trail Suite"
    run_observability || true
    step_header "17" "26" "Git Integration Edge Cases Suite"
    run_git || true
    step_header "18" "26" "Accessibility WCAG 2.1 AA Suite"
    run_accessibility || true
    step_header "19" "26" "Data Integrity & Tenant Isolation Suite"
    run_data_integrity || true
    step_header "20" "26" "Backend Services & Algorithmic Unit Tests"
    run_services || true
    step_header "21" "26" "Container Security & RBAC Guardrail Tests"
    run_security || true
    step_header "22" "26" "Network Resilience & Redis Failover Tests"
    run_resilience || true
    step_header "23" "26" "Timelapse CRDT Engine Unit & Isolated Suites"
    run_timelapse || true
    step_header "24" "26" "REST API & WebSocket Integration Tests"
    run_integration || true
    step_header "25" "26" "PostgreSQL & Redis Performance Benchmarks"
    run_db || true
    step_header "26" "26" "Frontend React & Monaco Component Tests"
    run_frontend || true
    ;;
esac

show_summary_dashboard
