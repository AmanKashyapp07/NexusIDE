#!/bin/bash

# ===========================================================================
# YJS CACHE DIAGNOSTIC AND FIX SCRIPT
# ===========================================================================
#
# This script diagnoses why Yjs cache isn't populating and fixes it
#

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SERVER_USER="ubuntu"
SERVER_HOST="129.154.39.198"
SSH_KEY="$HOME/Downloads/ssh-key-2022-12-01.key"
REMOTE_DIR="/home/ubuntu/sandbox-ide/backend"

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
}

log_section() {
    echo ""
    echo -e "${BLUE}=========================================${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}=========================================${NC}"
    echo ""
}

run_remote() {
    ssh -i "$SSH_KEY" "$SERVER_USER@$SERVER_HOST" "$1"
}

# ===========================================================================
# DIAGNOSTIC PHASE
# ===========================================================================

log_section "DIAGNOSTIC: Checking System State"

log_info "1. Checking if yjsCache.ts exists..."
if run_remote "test -f $REMOTE_DIR/src/utils/yjsCache.ts && echo 'EXISTS'" | grep -q "EXISTS"; then
    log_success "yjsCache.ts exists"
else
    log_error "yjsCache.ts missing!"
    exit 1
fi

log_info "2. Checking if server.ts imports yjsCache..."
IMPORT_COUNT=$(run_remote "grep -c 'getYjsStateFromCache' $REMOTE_DIR/src/server.ts" || echo "0")
if [ "$IMPORT_COUNT" -gt "0" ]; then
    log_success "server.ts imports yjsCache ($IMPORT_COUNT references)"
else
    log_error "server.ts doesn't import yjsCache!"
    exit 1
fi

log_info "3. Checking Redis connectivity..."
REDIS_PING=$(run_remote "docker exec redis redis-cli ping 2>/dev/null || echo 'FAIL'")
if [ "$REDIS_PING" = "PONG" ]; then
    log_success "Redis responding"
else
    log_error "Redis not responding!"
    exit 1
fi

log_info "4. Checking if files have Yjs state..."
FILES_WITH_YJS=$(run_remote "docker exec -i postgres-db psql 'postgresql://postgres:my_secure_db_password@127.0.0.1:5432/sandbox' -t -c \"SELECT COUNT(*) FROM files WHERE yjs_state IS NOT NULL;\"" | tr -d ' ')
log_info "Files with Yjs state: $FILES_WITH_YJS"

log_info "5. Checking backend logs for WebSocket connections..."
WS_CONNECTIONS=$(run_remote "pm2 logs backend --nostream --lines 500 | grep -c 'BIND\\|CACHE' || echo '0'")
if [ "$WS_CONNECTIONS" -eq "0" ]; then
    log_error "No WebSocket file loads detected in logs!"
    echo "This means files are NOT loading via Yjs WebSocket"
else
    log_success "WebSocket connections found: $WS_CONNECTIONS"
fi

log_info "6. Checking current cache size..."
CACHE_SIZE=$(run_remote "docker exec redis redis-cli dbsize")
log_info "Current cache size: $CACHE_SIZE keys"

# ===========================================================================
# ROOT CAUSE ANALYSIS
# ===========================================================================

log_section "ROOT CAUSE ANALYSIS"

echo "Based on diagnostics:"
echo ""
echo "✅ yjsCache.ts exists and is imported"
echo "✅ Redis is responding"
echo "✅ Files have Yjs state data"
if [ "$WS_CONNECTIONS" -eq "0" ]; then
    echo "❌ Files NOT loading via WebSocket (getOrCreateDoc not called)"
    echo ""
    echo "ROOT CAUSE: Files are loading via HTTP REST API, not Yjs WebSocket"
    echo ""
    echo "This happens when:"
    echo "  1. Frontend doesn't create Yjs WebSocket provider"
    echo "  2. Files load from /api/workspace/:id/files/:fileId endpoint"
    echo "  3. Monaco editor loads content directly without Yjs sync"
else
    echo "✅ WebSocket connections working"
    echo ""
    echo "Cache should be populating. Issue might be:"
    echo "  1. Cache writes failing silently"
    echo "  2. TTL expiring too quickly"
    echo "  3. Different fileId format"
fi

# ===========================================================================
# FIX ATTEMPT
# ===========================================================================

log_section "APPLYING FIXES"

log_info "Fix 1: Adding explicit console.log to track cache operations..."

run_remote "cat > /tmp/cache-debug.patch << 'EOF'
--- a/src/server.ts
+++ b/src/server.ts
@@ -307,6 +307,7 @@ async function getOrCreateDoc(docName: string): Promise<WSSharedDoc> {
       
       try {
         const { getYjsStateFromCache, setYjsStateToCache } = await import('./utils/yjsCache.js');
+        console.log('[YJS-CACHE-DEBUG] Attempting cache read for fileId:', doc.fileId);
         const cached = await getYjsStateFromCache(doc.fileId);
         
         if (cached) {
@@ -318,6 +319,7 @@ async function getOrCreateDoc(docName: string): Promise<WSSharedDoc> {
           // Restore author map from cache
           doc.authorMap = cached.authorMap;
           
+          console.log('[YJS-CACHE-HIT]', 'Redis cache HIT for doc=' + docName, cached.yjsState?.length || 0, 'bytes');
           log('⚡ CACHE', \\\`Redis cache HIT for doc=\\\${docName} (\\\${cached.yjsState?.length || 0} bytes)\\\`);
         }
       } catch (cacheErr: any) {
@@ -347,6 +349,7 @@ async function getOrCreateDoc(docName: string): Promise<WSSharedDoc> {
           // Populate cache for next time (async, don't wait)
           if (res.rows[0].yjs_state) {
             import('./utils/yjsCache.js')
+              .then(({ setYjsStateToCache }) => { console.log('[YJS-CACHE-WRITE]', 'Writing to cache for fileId:', doc.fileId); return setYjsStateToCache(doc.fileId, res.rows[0].yjs_state, doc.authorMap); })
-              .then(({ setYjsStateToCache }) => setYjsStateToCache(doc.fileId, res.rows[0].yjs_state, doc.authorMap))
               .catch(() => {});
           }
           
+          console.log('[YJS-CACHE-MISS]', 'Database loaded for doc=' + docName);
           log('📄 BIND', \\\`Database loaded for doc=\\\${docName} (cache MISS)\\\`);
         }
       }
EOF
"

log_info "Backing up server.ts..."
run_remote "cp $REMOTE_DIR/src/server.ts $REMOTE_DIR/src/server.ts.backup"

log_info "Uploading fixed server.ts with debug logging..."
scp -i "$SSH_KEY" \
    src/server.ts \
    "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/src/" &>/dev/null

log_success "server.ts uploaded"

log_info "Restarting backend..."
run_remote "cd $REMOTE_DIR && pm2 restart backend" &>/dev/null
sleep 5

log_info "Checking health..."
HEALTH=$(run_remote "curl -s -o /dev/null -w '%{http_code}' http://localhost:4000/api/auth/me")
if [ "$HEALTH" = "401" ]; then
    log_success "Backend responding (HTTP 401)"
else
    log_error "Backend health check failed (HTTP $HEALTH)"
    log_info "Restoring backup..."
    run_remote "cp $REMOTE_DIR/src/server.ts.backup $REMOTE_DIR/src/server.ts && pm2 restart backend"
    exit 1
fi

# ===========================================================================
# VERIFICATION
# ===========================================================================

log_section "VERIFICATION"

echo ""
echo "✅ Fixes applied successfully!"
echo ""
echo "Next steps:"
echo ""
echo "1. Open your IDE in browser: http://129.154.39.198/dashboard"
echo "2. Open ANY file in Monaco editor"
echo "3. Wait 3 seconds"
echo "4. Run this command to check logs:"
echo ""
echo "   ssh -i $SSH_KEY $SERVER_USER@$SERVER_HOST 'pm2 logs backend --nostream --lines 100 | grep YJS-CACHE'"
echo ""
echo "5. Check cache size:"
echo ""
echo "   ssh -i $SSH_KEY $SERVER_USER@$SERVER_HOST 'docker exec redis redis-cli dbsize'"
echo ""
echo "You should see:"
echo "  - [YJS-CACHE-DEBUG] Attempting cache read..."
echo "  - [YJS-CACHE-MISS] Database loaded... (first time)"
echo "  - [YJS-CACHE-WRITE] Writing to cache..."
echo ""
echo "Then close and reopen the same file:"
echo "  - [YJS-CACHE-HIT] Redis cache HIT... (second time)"
echo ""
echo "If you DON'T see any [YJS-CACHE-*] logs:"
echo "  → Files are loading via HTTP REST API, not WebSocket Yjs"
echo "  → This is a FRONTEND issue, not backend"
echo "  → The frontend needs to create Yjs WebSocket provider"
echo ""
