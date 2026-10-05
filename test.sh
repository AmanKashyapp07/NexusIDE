#!/usr/bin/env bash
# =============================================================================
# Root test wrapper for NexusIDE
# Delegates to scripts/test.sh with localhost defaults
# =============================================================================
export NEXUS_BASE_URL="${NEXUS_BASE_URL:-http://localhost:5173/ide}"
export DATABASE_URL="${DATABASE_URL:-postgresql://amankashyap@localhost:5432/sandbox}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "${SCRIPT_DIR}/scripts/test.sh" "$@"
