#!/usr/bin/env bash
# =============================================================================
# vm-cleanup.sh — NexusIDE Production VM & Storage Deep Cleanup Script
# Target Server: Oracle Cloud VM (129.154.39.198)
# Stack: Docker Engine / PostgreSQL 16 / Redis 7 / PM2 / Systemd
# =============================================================================
# Usage:
#   bash vm-cleanup.sh          # Cleans deployed VM over SSH
#   bash vm-cleanup.sh --local  # Cleans current local environment directly
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCAL_BASE="${LOCAL_BASE:-$PROJECT_ROOT}"
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

# ─── Mode Selection ───────────────────────────────────────────────────────────
MODE="remote"
if [[ "${1:-}" == "--local" ]]; then
  MODE="local"
fi

show_banner() {
  echo -e "${CYAN}${BOLD}"
  echo "========================================================================"
  echo "        NEXUS IDE DEPLOYED VM & STORAGE DEEP CLEANUP UTILITY            "
  echo "========================================================================"
  echo -e "${NC}"
}

# ─── Execute Remote Cleanup over SSH ──────────────────────────────────────────
run_remote_cleanup() {
  info "Connecting to Oracle Cloud VM (${REMOTE}) via SSH..."
  
  if [ ! -f "$SSH_KEY" ]; then
    error "SSH key file not found at: $SSH_KEY"
    exit 1
  fi
  chmod 600 "$SSH_KEY" 2>/dev/null || true

  # Setup SSH ControlMaster for fast sub-command multiplexing
  SSH_MUX_DIR="${TMPDIR:-/tmp}/ssh_mux_$$"
  mkdir -p "$SSH_MUX_DIR"
  SSH_MUX_SOCKET="$SSH_MUX_DIR/nexus_vm_cleanup.sock"

  trap 'ssh -S "$SSH_MUX_SOCKET" -O exit "$REMOTE" 2>/dev/null || true; rm -rf "$SSH_MUX_DIR"' EXIT

  info "Establishing SSH multiplexing master socket..."
  ssh -M -S "$SSH_MUX_SOCKET" -fnN -i "$SSH_KEY" -o StrictHostKeyChecking=no "$REMOTE"

  ssh_run() {
    ssh -S "$SSH_MUX_SOCKET" "$REMOTE" "$@"
  }

  section "Disk & RAM Utilization (Before Cleanup)"
  ssh_run "df -h / && echo '' && free -h"

  section "Step 1: Docker Container, Image & Volume Garbage Collection"
  ssh_run "
    echo '[Docker] Pruning exited containers...'
    docker container prune -f || true

    echo '[Docker] Pruning dangling and unreferenced images...'
    docker image prune -af --filter 'until=24h' || true

    echo '[Docker] Pruning unused anonymous volumes...'
    docker volume prune -f || true

    echo '[Docker] Pruning build cache...'
    docker builder prune -af --filter 'until=24h' || true
  "

  section "Step 2: NexusIDE Database & CAS Storage GC"
  ssh_run "
    if [ -d '${REMOTE_BASE}/backend' ]; then
      cd '${REMOTE_BASE}/backend'
      echo '[NexusIDE] Executing database CAS GC and soft-deleted workspace purge...'
      npx tsx src/cli/cleanup.cli.ts || true
    fi
  "

  section "Step 3: PM2 Logs & OS System Maintenance"
  ssh_run "
    echo '[PM2] Flushing server log buffers...'
    pm2 flush || true

    echo '[Systemd] Vacuuming system journal logs older than 3 days...'
    sudo journalctl --vacuum-time=3d || true

    echo '[System] Cleaning temp files and apt package cache...'
    sudo rm -rf /tmp/playwright* /tmp/workspace-* /tmp/v8-compile-cache* 2>/dev/null || true
    sudo apt-get clean || true
  "

  section "Disk & RAM Utilization (After Cleanup)"
  ssh_run "df -h / && echo '' && free -h"

  success "VM Deep Cleanup completed successfully! 🚀"
}

# ─── Execute Local Cleanup Directly ───────────────────────────────────────────
run_local_cleanup() {
  section "Disk & RAM Utilization (Before Cleanup)"
  df -h / && echo '' && free -h

  section "Step 1: Local Docker Resources Cleanup"
  echo '[Docker] Pruning exited containers...'
  docker container prune -f || true
  echo '[Docker] Pruning unused dangling images...'
  docker image prune -af --filter "until=24h" || true
  echo '[Docker] Pruning unused volumes...'
  docker volume prune -f || true

  section "Step 2: Local Database & CAS Storage GC"
  if [ -d "$LOCAL_BASE/backend" ]; then
    (cd "$LOCAL_BASE/backend" && npx tsx src/cli/cleanup.cli.ts || true)
  fi

  section "Disk & RAM Utilization (After Cleanup)"
  df -h / && echo '' && free -h

  success "Local Deep Cleanup completed successfully! 🚀"
}

# ─── Main Execution ───────────────────────────────────────────────────────────
show_banner

if [[ "$MODE" == "remote" ]]; then
  run_remote_cleanup
else
  run_local_cleanup
fi
