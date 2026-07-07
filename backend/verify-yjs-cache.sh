#!/bin/bash

# ===========================================================================
# YJS CACHE VERIFICATION SCRIPT
# ===========================================================================
#
# Quick health check for Yjs caching implementation
#
# Usage: ./verify-yjs-cache.sh
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}  YJS CACHE VERIFICATION${NC}"
echo -e "${BLUE}=========================================${NC}"
echo ""

# Check 1: yjsCache.ts exists
echo -n "✓ Checking yjsCache.ts exists... "
if [ -f "src/utils/yjsCache.ts" ]; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC}"
    exit 1
fi

# Check 2: server.ts has cache imports
echo -n "✓ Checking server.ts integration... "
if grep -q "getYjsStateFromCache" src/server.ts; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC}"
    exit 1
fi

# Check 3: Test files exist
echo -n "✓ Checking test files exist... "
if [ -f "../testing/backend/yjs-cache.test.ts" ] && [ -f "../testing/backend/yjs-cache-integration.test.ts" ]; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC}"
    exit 1
fi

# Check 4: Redis connection (local)
echo -n "✓ Checking local Redis... "
if docker exec redis redis-cli ping &>/dev/null; then
    PING_RESULT=$(docker exec redis redis-cli ping 2>/dev/null)
    if [ "$PING_RESULT" == "PONG" ]; then
        echo -e "${GREEN}PASS (PONG)${NC}"
    else
        echo -e "${YELLOW}WARN (no PONG)${NC}"
    fi
else
    echo -e "${YELLOW}SKIP (Docker not running)${NC}"
fi

# Check 5: TypeScript compilation
echo -n "✓ Checking TypeScript compilation... "
if npx tsc --noEmit &>/dev/null; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC}"
    echo ""
    echo "TypeScript errors:"
    npx tsc --noEmit
    exit 1
fi

echo ""
echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}  All checks passed!${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""
echo "Next steps:"
echo "  1. Run tests: npm test -- yjs-cache.test.ts"
echo "  2. Deploy: ./deploy-yjs-cache.sh"
echo ""
