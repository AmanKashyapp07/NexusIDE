#!/usr/bin/env bash
# =============================================================================
# test-e2e-remote-batches.sh — NexusIDE Deployed VM Batch E2E Test Orchestrator
# Target: Deployed Oracle Cloud VM (http://129.154.39.198/ide)
# =============================================================================
# Usage:
#   bash test-e2e-remote-batches.sh --1    # Batch 1: Collab Core Engine (8 tests)
#   bash test-e2e-remote-batches.sh --2    # Batch 2: Collab Advanced Sync (8 tests)
#   bash test-e2e-remote-batches.sh --3    # Batch 3: Git Merge & Monaco Editor (10 tests)
#   bash test-e2e-remote-batches.sh --4    # Batch 4: Collab Security & RBAC Complete Suite (16 tests)
#   bash test-e2e-remote-batches.sh --5    # Batch 5: Terminal Core & Signals (8 tests)
#   bash test-e2e-remote-batches.sh --6    # Batch 6: Terminal File System & Pipes (7 tests)
#   bash test-e2e-remote-batches.sh --7    # Batch 7: Terminal History, Environment & LSP (17 tests)
#   bash test-e2e-remote-batches.sh --8    # Batch 8: Timelapse Engine Suite (9 tests)
#   bash test-e2e-remote-batches.sh --all  # Run all 8 batches sequentially with VM cleanup
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOTE_TARGET="http://129.154.39.198/ide"

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

show_banner() {
  echo -e "${CYAN}${BOLD}"
  echo "========================================================================"
  echo "       NEXUS IDE DEPLOYED VM BATCH E2E PLAYWRIGHT TESTER               "
  echo "       Target URL: ${REMOTE_TARGET}                                     "
  echo "========================================================================"
  echo -e "${NC}"
}

run_vm_cleanup() {
  info "Triggering remote VM cleanup before batch execution..."
  if [ -f "$SCRIPT_DIR/vm-cleanup.sh" ]; then
    bash "$SCRIPT_DIR/vm-cleanup.sh" || true
  fi
}

run_playwright_batch() {
  local title="$1"
  local spec_file="$2"
  local grep_pattern="${3:-}"
  
  section "$title"
  export NEXUS_BASE_URL="$REMOTE_TARGET"

  cd "$SCRIPT_DIR/testing"
  
  local max_workers="${PLAYWRIGHT_WORKERS:-1}"
  if [ -n "$grep_pattern" ]; then
    npx playwright test $spec_file -g "$grep_pattern" --workers="${max_workers}"
  else
    npx playwright test $spec_file --workers="${max_workers}"
  fi

  success "Batch completed: $title 🚀"
}

RAW_FLAG="${1:---1}"
# Normalize flag format (supports --1, -1, 1)
BATCH_FLAG="${RAW_FLAG#--}"
BATCH_FLAG="${BATCH_FLAG#-}"

show_banner

case "$BATCH_FLAG" in
  1)
    run_vm_cleanup
    run_playwright_batch "Batch 1: Collab Core Engine (8 tests)" "e2e/collaboration.spec.ts" "Collab - Core Engine"
    ;;
  2)
    run_vm_cleanup
    run_playwright_batch "Batch 2: Collab Advanced Sync (8 tests)" "e2e/collaboration.spec.ts" "Collab - Advanced Sync"
    ;;
  3)
    run_vm_cleanup
    run_playwright_batch "Batch 3: Git Merge & Monaco Editor (10 tests)" "e2e/collaboration.spec.ts" "Collab - Git Merge Resolver|Monaco Editor"
    ;;
  4)
    run_vm_cleanup
    run_playwright_batch "Batch 4: Collab Security & RBAC Complete Suite (16 tests)" "e2e/collaboration.spec.ts" "Collab - Security & RBAC"
    ;;
  5)
    run_vm_cleanup
    run_playwright_batch "Batch 5: Terminal Core & Signals (8 tests)" "e2e/terminal-lsp.spec.ts" "Terminal - Core Operations|Terminal Multi-User|Terminal Signal"
    ;;
  6)
    run_vm_cleanup
    run_playwright_batch "Batch 6: Terminal File System & Pipes (7 tests)" "e2e/terminal-lsp.spec.ts" "Terminal File System|Terminal Pipe|Terminal Working Directory|Terminal Concurrent"
    ;;
  7)
    run_vm_cleanup
    run_playwright_batch "Batch 7: Terminal History, Environment & LSP (17 tests)" "e2e/terminal-lsp.spec.ts" "Terminal Environment|Terminal History|Terminal Multi-File|Terminal Advanced|LSP - Language"
    ;;
  8)
    run_vm_cleanup
    run_playwright_batch "Batch 8: Timelapse Engine Suite (9 tests)" "e2e/timelapse.spec.ts"
    ;;
  9)
    run_vm_cleanup
    run_playwright_batch "Batch 9: Live Preview & Multi-Port Proxy Engine (5 tests)" "e2e/live-preview.spec.ts"
    ;;
  all)
    for b in 1 2 3 4 5 6 7 8 9; do
      bash "$SCRIPT_DIR/test-e2e-remote-batches.sh" "--$b"
    done
    ;;
  *)
    error "Unknown batch flag: $RAW_FLAG"
    echo "Available flags: --1, --2, --3, --4, --5, --6, --7, --8, --9, --latency-all, --all"
    exit 1
    ;;
esac
