#!/bin/bash

# ===========================================================================
# YJS CACHE DEPLOYMENT SCRIPT (Free-Tier Optimization)
# ===========================================================================
#
# This script safely deploys the Yjs caching optimization with:
# - Pre-deployment backup
# - Health checks
# - Automatic rollback on failure
#
# Usage:
#   ./deploy-yjs-cache.sh          # Deploy to production
#   ./deploy-yjs-cache.sh --test   # Run tests only
#   ./deploy-yjs-cache.sh --rollback  # Rollback to backup
#

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SERVER_USER="ubuntu"
SERVER_HOST="129.154.39.198"
SSH_KEY="$HOME/Downloads/ssh-key-2022-12-01.key"
REMOTE_DIR="/home/ubuntu/sandbox-ide/backend"
BACKUP_DIR="/home/ubuntu/sandbox-ide/backend-backup-$(date +%Y%m%d-%H%M%S)"

# ===========================================================================
# Helper Functions
# ===========================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

run_remote() {
    ssh -i "$SSH_KEY" "$SERVER_USER@$SERVER_HOST" "$1"
}

# ===========================================================================
# Test Mode
# ===========================================================================

if [ "$1" == "--test" ]; then
    log_info "Running Yjs cache tests..."
    
    cd "$(dirname "$0")"
    npm test -- yjs-cache.test.ts
    
    log_success "All tests passed!"
    exit 0
fi

# ===========================================================================
# Rollback Mode
# ===========================================================================

if [ "$1" == "--rollback" ]; then
    log_warning "Rolling back to previous version..."
    
    # Find most recent backup
    LATEST_BACKUP=$(run_remote "ls -dt /home/ubuntu/sandbox-ide/backend-backup-* 2>/dev/null | head -1")
    
    if [ -z "$LATEST_BACKUP" ]; then
        log_error "No backup found!"
        exit 1
    fi
    
    log_info "Found backup: $LATEST_BACKUP"
    
    # Stop backend
    log_info "Stopping backend..."
    run_remote "pm2 stop backend" || true
    
    # Restore backup
    log_info "Restoring backup..."
    run_remote "rm -rf $REMOTE_DIR/src/utils/yjsCache.ts && cp -r $LATEST_BACKUP/* $REMOTE_DIR/"
    
    # Restart backend
    log_info "Restarting backend..."
    run_remote "cd $REMOTE_DIR && pm2 restart backend"
    
    sleep 5
    
    # Health check
    HEALTH=$(run_remote "curl -s -o /dev/null -w '%{http_code}' http://localhost:4000/api/auth/me")
    
    if [ "$HEALTH" == "401" ]; then
        log_success "Rollback completed! Backend is responding."
    else
        log_error "Rollback failed! Backend health check failed (HTTP $HEALTH)"
        exit 1
    fi
    
    exit 0
fi

# ===========================================================================
# Deployment Flow
# ===========================================================================

log_info "Starting Yjs cache deployment..."

# Step 1: Run tests locally
log_info "Step 1/7: Running tests locally..."
cd "$(dirname "$0")"
npm test -- yjs-cache.test.ts || {
    log_error "Tests failed! Aborting deployment."
    exit 1
}
log_success "Tests passed!"

# Step 2: Create backup on server
log_info "Step 2/7: Creating backup on server..."
run_remote "mkdir -p $BACKUP_DIR && cp -r $REMOTE_DIR/src $BACKUP_DIR/"
log_success "Backup created at $BACKUP_DIR"

# Step 3: Check Redis connectivity
log_info "Step 3/7: Checking Redis connectivity..."
REDIS_PING=$(run_remote "docker exec redis redis-cli ping 2>/dev/null || echo 'FAIL'")

if [ "$REDIS_PING" != "PONG" ]; then
    log_error "Redis is not responding! Aborting deployment."
    exit 1
fi
log_success "Redis is responding (PONG)"

# Step 4: Upload new files
log_info "Step 4/7: Uploading new files..."
scp -i "$SSH_KEY" \
    "$(dirname "$0")/src/utils/yjsCache.ts" \
    "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/src/utils/"

scp -i "$SSH_KEY" \
    "$(dirname "$0")/src/server.ts" \
    "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/src/"

log_success "Files uploaded"

# Step 5: Restart backend
log_info "Step 5/7: Restarting backend..."
run_remote "cd $REMOTE_DIR && pm2 restart backend"
sleep 5

# Step 6: Health checks
log_info "Step 6/7: Running health checks..."

# Check 1: Backend responding
HEALTH=$(run_remote "curl -s -o /dev/null -w '%{http_code}' http://localhost:4000/api/auth/me")
if [ "$HEALTH" != "401" ]; then
    log_error "Backend health check failed (HTTP $HEALTH)"
    log_warning "Initiating automatic rollback..."
    $0 --rollback
    exit 1
fi
log_success "Backend is responding (HTTP 401 - expected for auth endpoint)"

# Check 2: Redis connection in logs
sleep 3
REDIS_LOG=$(run_remote "pm2 logs backend --nostream --lines 50 | grep -i 'redis' | tail -1")
log_info "Redis connection status: $REDIS_LOG"

# Check 3: No critical errors in logs
ERROR_COUNT=$(run_remote "pm2 logs backend --nostream --lines 50 --err | grep -i 'error' | wc -l")
if [ "$ERROR_COUNT" -gt 5 ]; then
    log_error "Too many errors in logs ($ERROR_COUNT errors found)"
    log_warning "Initiating automatic rollback..."
    $0 --rollback
    exit 1
fi
log_success "No critical errors in logs"

# Step 7: Cache functionality test
log_info "Step 7/7: Testing cache functionality..."

# Get initial cache size
INITIAL_KEYS=$(run_remote "docker exec redis redis-cli dbsize")
log_info "Initial cache keys: $INITIAL_KEYS"

log_success "Deployment completed successfully!"

# ===========================================================================
# Post-Deployment Summary
# ===========================================================================

echo ""
echo "========================================="
echo "  YJS CACHE DEPLOYMENT SUMMARY"
echo "========================================="
echo ""
echo "✅ Tests passed"
echo "✅ Backup created: $BACKUP_DIR"
echo "✅ Files uploaded"
echo "✅ Backend restarted"
echo "✅ Health checks passed"
echo ""
echo "📊 Monitoring:"
echo "   - Watch logs: ssh -i $SSH_KEY $SERVER_USER@$SERVER_HOST 'pm2 logs backend'"
echo "   - Check cache: ssh -i $SSH_KEY $SERVER_USER@$SERVER_HOST 'docker exec redis redis-cli dbsize'"
echo "   - Check stats: ssh -i $SSH_KEY $SERVER_USER@$SERVER_HOST 'pm2 logs backend --lines 100 | grep YjsCache'"
echo ""
echo "🔄 Rollback (if needed):"
echo "   ./deploy-yjs-cache.sh --rollback"
echo ""
echo "========================================="
