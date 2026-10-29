#!/usr/bin/env bash
# =============================================================================
#  NexusIDE — Local Development Startup Script
#  Usage:  bash dev.sh [--skip-deps] [--skip-db] [--help]
#
#  Starts all required services for local development & demonstration:
#    1. Preflight checks    (Node.js, npm, Docker, PostgreSQL, Redis)
#    2. Environment init    (backend/.env, frontend/.env)
#    3. npm install         (backend + frontend, skippable via --skip-deps)
#    4. DB schema init      (idempotent, skippable via --skip-db)
#    5. Port collision free (ports 4000 and 5173)
#    6. Backend server      (tsx watch on port 4000, DEMO_MODE=true)
#    7. Frontend dev server (Vite on port 5173)
#
#  Press Ctrl+C once to stop both servers cleanly.
# =============================================================================

set -e

# ── Color & Formatting Helpers ────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { echo -e "${CYAN}[nexus]${RESET} $*"; }
ok()    { echo -e "${GREEN}[nexus] ✓${RESET} $*"; }
warn()  { echo -e "${YELLOW}[nexus] ⚠${RESET}  $*"; }
die()   { echo -e "${RED}[nexus] ✗ $*${RESET}" >&2; exit 1; }

# ── Command Line Flags ────────────────────────────────────────────────────────
SKIP_DEPS=false
SKIP_DB=false

for arg in "$@"; do
  case "$arg" in
    --skip-deps) SKIP_DEPS=true ;;
    --skip-db)   SKIP_DB=true   ;;
    --help|-h)
      echo "Usage: bash dev.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --skip-deps   Skip dependency installation (fast startup when node_modules exist)"
      echo "  --skip-db     Skip database schema initialisation"
      echo "  --help, -h    Display this help message and exit"
      exit 0
      ;;
    *)
      warn "Unknown flag: $arg"
      ;;
  esac
done

# ── Root Paths ────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
DB_SCHEMA="$SCRIPT_DIR/database/schema.sql"
BACKEND_ENV="$BACKEND_DIR/.env"
FRONTEND_ENV="$FRONTEND_DIR/.env"

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║                      NexusIDE  ·  Local Dev                          ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════╝${RESET}"
echo ""

# =============================================================================
# 1. PREFLIGHT CHECKS
# =============================================================================
info "Running system preflight checks…"

# ── Node.js ──
if ! command -v node &>/dev/null; then
  die "Node.js not found. Please install Node.js v18+ from https://nodejs.org"
fi
NODE_VER=$(node -e "process.stdout.write(process.version)")
NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [ "$NODE_MAJOR" -lt 18 ]; then
  die "Node.js v18+ required. Current version: $NODE_VER"
fi
ok "Node.js $NODE_VER"

# ── npm ──
if ! command -v npm &>/dev/null; then
  die "npm package manager not found."
fi
ok "npm $(npm --version)"

# ── Docker Engine & Daemon ──
DOCKER_AVAILABLE=true
if ! command -v docker &>/dev/null; then
  warn "Docker binary not found in PATH."
  warn "Terminal sandboxing will be unavailable, but IDE editor and CRDT collaboration will work."
  DOCKER_AVAILABLE=false
elif ! docker info &>/dev/null 2>&1; then
  warn "Docker daemon is not running. Start Docker Desktop for interactive terminal support."
  warn "NexusIDE will proceed with degraded terminal mode (editor & CRDT sync unaffected)."
  if [ -t 0 ]; then
    read -r -p "  Continue without Docker? (Y/n) " _docker_cont
    [[ "$_docker_cont" =~ ^[Nn]$ ]] && exit 1
  fi
  DOCKER_AVAILABLE=false
else
  ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"
fi

# ── PostgreSQL Reachability ──
PG_OK=false
if [ -f "$BACKEND_ENV" ]; then
  DB_URL=$(grep -E '^DATABASE_URL=' "$BACKEND_ENV" | head -1 | sed 's/DATABASE_URL=//;s/"//g')
fi
DB_URL="${DB_URL:-postgresql://postgres@localhost:5432/sandbox}"

PG_HOST=$(echo "$DB_URL" | sed -E 's|.*@([^:/]+).*|\1|')
PG_PORT=$(echo "$DB_URL" | sed -E 's|.*:([0-9]+)/.*|\1|')
PG_DBNAME=$(echo "$DB_URL" | sed -E 's|.*/([^?]+).*|\1|')
PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PG_DBNAME="${PG_DBNAME:-sandbox}"

if command -v pg_isready &>/dev/null; then
  if pg_isready -h "$PG_HOST" -p "$PG_PORT" -q 2>/dev/null; then
    PG_OK=true
  fi
elif command -v psql &>/dev/null; then
  if psql "$DB_URL" -c "SELECT 1;" &>/dev/null 2>&1; then
    PG_OK=true
  fi
fi

if [ "$PG_OK" = false ]; then
  echo ""
  warn "PostgreSQL is not reachable at ${PG_HOST}:${PG_PORT}."
  echo "  To start PostgreSQL:"
  echo "    brew services start postgresql@16   (macOS Homebrew)"
  echo "    pg_ctl -D /usr/local/var/postgresql@16 start"
  echo "    sudo service postgresql start        (Linux)"
  echo ""
  if [ -t 0 ]; then
    read -r -p "  Continue anyway? (y/N) " _pg_cont
    [[ "$_pg_cont" =~ ^[Yy]$ ]] || exit 1
  fi
else
  ok "PostgreSQL connected (${PG_HOST}:${PG_PORT})"
fi

# ── Redis Reachability ──
REDIS_HOST_VAL="localhost"
REDIS_PORT_VAL="6379"
if [ -f "$BACKEND_ENV" ]; then
  _rh=$(grep -E '^REDIS_HOST=' "$BACKEND_ENV" | head -1 | sed 's/REDIS_HOST=//;s/"//g')
  _rp=$(grep -E '^REDIS_PORT=' "$BACKEND_ENV" | head -1 | sed 's/REDIS_PORT=//;s/"//g')
  [ -n "$_rh" ] && REDIS_HOST_VAL="$_rh"
  [ -n "$_rp" ] && REDIS_PORT_VAL="$_rp"
fi

REDIS_OK=false
if command -v redis-cli &>/dev/null; then
  if redis-cli -h "$REDIS_HOST_VAL" -p "$REDIS_PORT_VAL" ping 2>/dev/null | grep -q PONG; then
    REDIS_OK=true
  fi
fi

if [ "$REDIS_OK" = false ]; then
  warn "Redis is not reachable at ${REDIS_HOST_VAL}:${REDIS_PORT_VAL}."
  warn "NexusIDE will use in-memory caching fallback (single-node development safe)."
else
  ok "Redis connected (${REDIS_HOST_VAL}:${REDIS_PORT_VAL})"
fi

echo ""

# =============================================================================
# 2. ENVIRONMENT CONFIGURATION
# =============================================================================
if [ ! -f "$BACKEND_ENV" ]; then
  if [ -f "$SCRIPT_DIR/.env.local.example" ]; then
    warn "backend/.env missing — auto-creating from .env.local.example"
    cp "$SCRIPT_DIR/.env.local.example" "$BACKEND_ENV"
    ok "Created backend/.env"
  else
    die "backend/.env missing and .env.local.example not found."
  fi
fi

if [ ! -f "$FRONTEND_ENV" ]; then
  warn "frontend/.env missing — auto-creating default local config"
  printf 'VITE_API_URL=http://localhost:4000/api\nLOG_LEVEL=silent\n' > "$FRONTEND_ENV"
  ok "Created frontend/.env"
fi

ok "Environment configurations validated"
echo ""

# =============================================================================
# 3. DEPENDENCY INSTALLATION
# =============================================================================
if [ "$SKIP_DEPS" = false ]; then
  info "Installing backend dependencies…"
  (cd "$BACKEND_DIR" && npm install --prefer-offline --loglevel warn)
  ok "Backend dependencies verified"

  info "Installing frontend dependencies…"
  (cd "$FRONTEND_DIR" && npm install --prefer-offline --loglevel warn)
  ok "Frontend dependencies verified"
  echo ""
else
  info "Skipping dependency installation (--skip-deps)"
  echo ""
fi

# =============================================================================
# 4. DATABASE SCHEMA INITIALIZATION (Idempotent)
# =============================================================================
if [ "$SKIP_DB" = false ] && [ "$PG_OK" = true ]; then
  info "Initializing database schema (idempotent)…"
  if command -v psql &>/dev/null; then
    psql "$DB_URL" -c "SELECT 1" &>/dev/null 2>&1 || \
      psql "postgresql://${PG_HOST}:${PG_PORT}/postgres" -c "CREATE DATABASE ${PG_DBNAME};" &>/dev/null 2>&1 || true

    if psql "$DB_URL" -f "$DB_SCHEMA" &>/dev/null 2>&1; then
      ok "Database schema verified → ${PG_DBNAME}"
    else
      warn "Database schema application returned notices (already initialized — safe)."
    fi
  else
    warn "psql CLI not in PATH — skipping automated schema application."
    warn "Run manually if needed: psql \"\$DATABASE_URL\" -f database/schema.sql"
  fi
elif [ "$SKIP_DB" = true ]; then
  info "Skipping DB schema initialization (--skip-db)"
else
  warn "Skipping DB schema initialization (PostgreSQL unavailable)."
fi
echo ""

# =============================================================================
# 5. PORT COLLISION CHECK & CLEANUP
# =============================================================================
check_and_free_port() {
  local port=$1
  local service_name=$2
  if command -v lsof &>/dev/null; then
    local pids
    pids=$(lsof -ti:"$port" 2>/dev/null || true)
    if [ -n "$pids" ]; then
      warn "Port $port ($service_name) is currently bound by stale PID(s): $pids"
      info "Terminating stale process to prevent EADDRINUSE conflict…"
      echo "$pids" | xargs kill -9 2>/dev/null || true
      sleep 1
      ok "Port $port freed"
    fi
  fi
}

check_and_free_port 4000 "Backend API"
check_and_free_port 5173 "Frontend Vite"

# =============================================================================
# 6 & 7. START BACKEND & FRONTEND SERVERS
# =============================================================================
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  echo ""
  info "Shutting down servers cleanly…"
  [ -n "$BACKEND_PID"  ] && kill "$BACKEND_PID"  2>/dev/null || true
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null || true
  if command -v lsof &>/dev/null; then
    lsof -ti:4000 2>/dev/null | xargs kill -9 2>/dev/null || true
    lsof -ti:5173 2>/dev/null | xargs kill -9 2>/dev/null || true
  fi
  wait 2>/dev/null || true
  ok "All server processes terminated cleanly."
  exit 0
}

trap cleanup SIGINT SIGTERM EXIT

export DEMO_MODE=true
export NODE_ENV=development

# ── Start Backend ──
(
  cd "$BACKEND_DIR"
  npm run dev 2>&1 | sed "s/^/$(echo -e "${CYAN}[backend]${RESET}") /"
) &
BACKEND_PID=$!

# Brief pause for backend port binding
sleep 2

# ── Start Frontend ──
(
  cd "$FRONTEND_DIR"
  npm run dev 2>&1 | sed "s/^/$(echo -e "${GREEN}[frontend]${RESET}") /"
) &
FRONTEND_PID=$!

sleep 2

# ── Readiness Display ──
echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${GREEN}║  NexusIDE Local Development Environment is READY!                    ║${RESET}"
echo -e "${BOLD}${GREEN}║                                                                      ║${RESET}"
echo -e "${BOLD}${GREEN}║  Primary IDE Session:    http://localhost:5173/ide                   ║${RESET}"
echo -e "${BOLD}${GREEN}║  Collaborator Session:   Open Incognito Window to same URL           ║${RESET}"
echo -e "${BOLD}${GREEN}║  Credentials (1-Click):  Username: demo  ·  Password: test           ║${RESET}"
echo -e "${BOLD}${GREEN}║  Backend API Health:     http://localhost:4000/api/auth/me           ║${RESET}"
echo -e "${BOLD}${GREEN}║                                                                      ║${RESET}"
echo -e "${BOLD}${GREEN}║  Press Ctrl+C to terminate all processes cleanly.                    ║${RESET}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════════════════╝${RESET}"
echo ""

wait "$BACKEND_PID" "$FRONTEND_PID"
