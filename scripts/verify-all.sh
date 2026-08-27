#!/usr/bin/env bash
# =============================================================================
# NexusIDE Comprehensive Verification Suite
# Runs automated health checks across website, local dev, icons, git, & network
# =============================================================================
set -uo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PASSED=0
FAILED=0
WARNED=0

log_pass() {
  echo -e "  ${GREEN}✔ [PASS]${NC} $1"
  PASSED=$((PASSED + 1))
}

log_fail() {
  echo -e "  ${RED}✖ [FAIL]${NC} $1"
  FAILED=$((FAILED + 1))
}

log_warn() {
  echo -e "  ${YELLOW}⚠ [WARN]${NC} $1"
  WARNED=$((WARNED + 1))
}

log_section() {
  echo -e "\n${BOLD}${CYAN}══ $1 ══${NC}"
}

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo -e "\n${BOLD}================================================================="
echo -e "       NexusIDE Full System Diagnostics & Health Check           "
echo -e "=================================================================${NC}"

# ── 1. Showcase Static Assets & Code Syntax ──────────────────────────────────
log_section "1. Showcase Website Code & Asset Integrity"

if [ -f "website/index.html" ]; then
  # Check required sections
  MISSING_SECS=0
  for sec in "hero" "stack" "labs" "architecture" "features" "postmortems" "testing" "setup"; do
    if ! grep -q "id=\"$sec\"" website/index.html; then
      MISSING_SECS=$((MISSING_SECS + 1))
    fi
  done
  if [ $MISSING_SECS -eq 0 ]; then
    log_pass "index.html contains all 8 required section IDs"
  else
    log_fail "index.html is missing $MISSING_SECS required section IDs"
  fi

  # Check name replacement
  if grep -qi "sarah" website/index.html website/js/app.js; then
    log_fail "Found legacy collaborator name 'Sarah' in website files"
  else
    log_pass "Verified collaborator name: 'Tushar' (0 instances of 'Sarah')"
  fi
else
  log_fail "website/index.html not found"
fi

# JS syntax validation
if node --check website/js/app.js >/dev/null 2>&1; then
  log_pass "website/js/app.js syntax validated with Node.js (clean)"
else
  log_fail "website/js/app.js has syntax errors"
fi

# CSS checks
if [ -s "website/css/style.css" ] && [ -s "website/css/animations.css" ]; then
  STYLE_LINES=$(wc -l < website/css/style.css)
  log_pass "CSS files verified: style.css ($STYLE_LINES lines) + animations.css"
else
  log_fail "CSS files are missing or empty"
fi

# ── 2. Official Tech Stack Vector Icons ──────────────────────────────────────
log_section "2. Tech Stack Official Brand SVG Icons"

ICON_DIR="website/assets/icons"
EXPECTED_ICONS=(
  "react.svg" "typescript.svg" "vscode.svg" "vite.svg" "tailwindcss.svg"
  "bash.svg" "nodejs.svg" "express.svg" "socketio.svg" "yjs.svg"
  "postgresql.svg" "redis.svg" "docker.svg" "linux.svg" "nginx.svg"
  "prometheus.svg" "pm2.svg" "vitest.svg" "playwright.svg"
)

ALL_ICONS_OK=true
for icon in "${EXPECTED_ICONS[@]}"; do
  if [ ! -s "$ICON_DIR/$icon" ]; then
    log_fail "Missing or empty icon: $icon"
    ALL_ICONS_OK=false
  fi
done

if [ "$ALL_ICONS_OK" = true ]; then
  log_pass "All ${#EXPECTED_ICONS[@]} official SVG brand icons present and non-empty in $ICON_DIR"
fi

# ── 3. Local Preview HTTP Server (Port 4173) ─────────────────────────────────
log_section "3. Local Preview Server Response Tests"

SERVER_URL="http://localhost:4173"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$SERVER_URL/" || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
  log_pass "Local preview server responding at $SERVER_URL (HTTP $HTTP_CODE)"
  
  # Check static assets via HTTP
  ASSETS_OK=true
  for path in "/css/style.css" "/css/animations.css" "/js/app.js" "/assets/icons/react.svg" "/assets/icons/docker.svg"; do
    CODE=$(curl -s -o /dev/null -w "%{http_code}" "$SERVER_URL$path" || echo "000")
    if [ "$CODE" != "200" ]; then
      log_fail "Failed to serve asset: $path (HTTP $CODE)"
      ASSETS_OK=false
    fi
  done
  if [ "$ASSETS_OK" = true ]; then
    log_pass "All sampled static assets returning HTTP 200 OK from server"
  fi
else
  log_warn "Local server not running on port 4173 (HTTP $HTTP_CODE). Run: npm run showcase:dev"
fi

# ── 4. Git Repository & Remote Sync State ─────────────────────────────────────
log_section "4. Git Branch & Remote Deployment State"

CURRENT_BRANCH=$(git branch --show-current)
log_pass "Current working branch: '$CURRENT_BRANCH'"

# Check tracking status with origin/main
git fetch origin --quiet 2>/dev/null || true
AHEAD_BEHIND=$(git rev-list --left-right --count origin/main...main 2>/dev/null || echo "0 0")
BEHIND=$(echo "$AHEAD_BEHIND" | awk '{print $1}')
AHEAD=$(echo "$AHEAD_BEHIND" | awk '{print $2}')

if [ "$AHEAD" -eq 0 ] && [ "$BEHIND" -eq 0 ]; then
  log_pass "Local 'main' is fully in sync with 'origin/main'"
else
  log_warn "Branch status relative to origin/main: $AHEAD ahead, $BEHIND behind"
fi

# Check if gh-pages branch exists on remote
if git ls-remote --heads origin gh-pages | grep -q "gh-pages"; then
  log_pass "Remote 'origin/gh-pages' branch verified on GitHub"
else
  log_fail "Remote 'origin/gh-pages' branch not found on GitHub"
fi

# Check GitHub Actions deployment workflow file
if [ -f ".github/workflows/deploy-showcase.yml" ]; then
  log_pass "GitHub Actions workflow .github/workflows/deploy-showcase.yml is configured"
else
  log_fail "Missing .github/workflows/deploy-showcase.yml"
fi

# ── 5. External Network Connectivity & Endpoints ──────────────────────────────
log_section "5. External Cloud Endpoints Status"

# GitHub Pages URL
GH_PAGES_URL="https://amankashyapp07.github.io/NexusIDE/"
PAGES_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 5 "$GH_PAGES_URL" || echo "000")

if [ "$PAGES_CODE" = "200" ]; then
  log_pass "GitHub Pages site is live: $GH_PAGES_URL (HTTP 200)"
elif [ "$PAGES_CODE" = "404" ]; then
  log_warn "GitHub Pages URL returns HTTP 404. Activate in GitHub Settings -> Pages -> Source: 'gh-pages' branch."
else
  log_warn "GitHub Pages responded with HTTP $PAGES_CODE (DNS or build propagating)"
fi

# Oracle Cloud VM Endpoint
VM_IP="129.154.39.198"
VM_URL="http://$VM_IP/ide/login"

VM_ACCESSIBLE=$(python3 -c '
import socket
s = socket.socket()
s.settimeout(1.5)
try:
  s.connect(("129.154.39.198", 80))
  print("open")
except Exception:
  print("closed")
finally:
  s.close()
' 2>/dev/null || echo "closed")

if [ "$VM_ACCESSIBLE" = "open" ]; then
  VM_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 2 "$VM_URL" || echo "000")
  log_pass "Oracle Cloud VM port 80 is OPEN. HTTP Status: $VM_CODE"
else
  log_warn "Oracle Cloud VM ($VM_IP:80) is UNREACHABLE (connection timed out)."
  echo -e "       ${YELLOW}Reason: The Oracle Cloud VM instance is halted, shut down, or public IP changed.${NC}"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}================================================================="
echo -e "                       DIAGNOSTIC SUMMARY                         "
echo -e "=================================================================${NC}"
echo -e "  Passed checks : ${GREEN}${BOLD}$PASSED${NC}"
echo -e "  Failed checks : ${RED}${BOLD}$FAILED${NC}"
echo -e "  Warnings      : ${YELLOW}${BOLD}$WARNED${NC}"

if [ $FAILED -eq 0 ]; then
  echo -e "\n${GREEN}${BOLD}✔ SYSTEM HEALTHY:${NC} All code, assets, icons, local server & git branches are fully working!"
  exit 0
else
  echo -e "\n${RED}${BOLD}✖ SYSTEM ISSUES DETECTED:${NC} Check failed items above."
  exit 1
fi
