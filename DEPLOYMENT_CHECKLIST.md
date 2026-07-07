# Yjs Cache Deployment Checklist

## Pre-Deployment (Local)

### 1. Verify Files
```bash
cd /Users/amankashyap/Documents/sandbox/backend
./verify-yjs-cache.sh
```

**Expected:** All checks PASS

- [ ] ✅ yjsCache.ts exists
- [ ] ✅ server.ts integration
- [ ] ✅ Test files exist
- [ ] ✅ Local Redis responding
- [ ] ✅ TypeScript compiles without errors

---

### 2. Run Unit Tests
```bash
npm test -- yjs-cache.test.ts
```

**Expected:** All 15 tests pass

- [ ] ✅ Cache miss returns null
- [ ] ✅ Store and retrieve Yjs state
- [ ] ✅ Handle large documents
- [ ] ✅ Multiple author entries
- [ ] ✅ Cache deletion works
- [ ] ✅ Corrupt data rejection
- [ ] ✅ Database integration
- [ ] ✅ Error handling
- [ ] ✅ Performance benchmarks

---

### 3. Run Integration Tests (Optional)
```bash
npm test -- yjs-cache-integration.test.ts
```

**Expected:** All 4 tests pass

- [ ] ✅ Cache miss → DB load → cache populate
- [ ] ✅ Cache hit on second connection
- [ ] ✅ Cache invalidation on save
- [ ] ✅ Redis failure fallback

---

## Deployment (Production)

### 4. Check Server Prerequisites

```bash
ssh -i ~/Downloads/ssh-key-2022-12-01.key ubuntu@129.154.39.198 "
  echo '=== Prerequisites Check ===' &&
  docker exec redis redis-cli ping &&
  pm2 status | grep backend &&
  psql 'postgresql://postgres:my_secure_db_password@127.0.0.1:5432/sandbox' -c 'SELECT 1;' &&
  echo 'All prerequisites OK'
"
```

**Expected output:**
```
=== Prerequisites Check ===
PONG
online
 ?column? 
----------
        1
All prerequisites OK
```

- [ ] ✅ Redis responding (PONG)
- [ ] ✅ Backend running (online)
- [ ] ✅ PostgreSQL connected

---

### 5. Deploy

```bash
cd /Users/amankashyap/Documents/sandbox/backend
chmod +x deploy-yjs-cache.sh
./deploy-yjs-cache.sh
```

**Expected output:**
```
[INFO] Starting Yjs cache deployment...
[INFO] Step 1/7: Running tests locally...
[SUCCESS] Tests passed!
[INFO] Step 2/7: Creating backup on server...
[SUCCESS] Backup created at /home/ubuntu/sandbox-ide/backend-backup-YYYYMMDD-HHMMSS
[INFO] Step 3/7: Checking Redis connectivity...
[SUCCESS] Redis is responding (PONG)
[INFO] Step 4/7: Uploading new files...
[SUCCESS] Files uploaded
[INFO] Step 5/7: Restarting backend...
[INFO] Step 6/7: Running health checks...
[SUCCESS] Backend is responding (HTTP 401 - expected for auth endpoint)
[SUCCESS] No critical errors in logs
[INFO] Step 7/7: Testing cache functionality...
[SUCCESS] Deployment completed successfully!
```

- [ ] ✅ Tests passed
- [ ] ✅ Backup created
- [ ] ✅ Redis responding
- [ ] ✅ Files uploaded
- [ ] ✅ Backend restarted
- [ ] ✅ Health checks passed

---

## Post-Deployment Verification

### 6. Check Backend Health

```bash
ssh -i ~/Downloads/ssh-key-2022-12-01.key ubuntu@129.154.39.198 "
  curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://localhost:4000/api/auth/me &&
  pm2 status &&
  pm2 logs backend --nostream --lines 20 --err
"
```

**Expected:**
- HTTP 401 (unauthenticated, but server responding)
- Backend status: online
- No critical errors in logs

- [ ] ✅ Backend responding (HTTP 401)
- [ ] ✅ Backend online in PM2
- [ ] ✅ No critical errors in logs

---

### 7. Verify Cache Functionality

#### A. Check Redis is Empty Initially
```bash
ssh -i ~/Downloads/ssh-key-2022-12-01.key ubuntu@129.154.39.198 "
  docker exec redis redis-cli dbsize
"
```

**Expected:** 0 (or low number if other users active)

- [ ] ✅ Redis responding

#### B. Open a File in the IDE
1. Open browser to your IDE
2. Login
3. Open any workspace
4. **Open a file** (any file, e.g., `README.md`, `index.js`)

#### C. Verify Cache Populated
```bash
ssh -i ~/Downloads/ssh-key-2022-12-01.key ubuntu@129.154.39.198 "
  docker exec redis redis-cli dbsize &&
  docker exec redis redis-cli keys 'yjs:*'
"
```

**Expected:**
- dbsize: 2 or more (increases by 2 per file opened)
- Keys like: `yjs:state:{fileId}`, `yjs:author:{fileId}`

- [ ] ✅ Cache keys populated (2+ keys)
- [ ] ✅ Keys match pattern `yjs:*`

#### D. Check Logs for Cache Hit
```bash
ssh -i ~/Downloads/ssh-key-2022-12-01.key ubuntu@129.154.39.198 "
  pm2 logs backend --nostream --lines 50 | grep -i cache
"
```

**Expected on first open:**
```
📄 BIND Database loaded for doc=xxx-xxx (cache MISS)
```

**Expected on second open (within 10 min):**
```
⚡ CACHE Redis cache HIT for doc=xxx-xxx (5432 bytes)
```

- [ ] ✅ Cache MISS on first file open
- [ ] ✅ Cache HIT on second file open (reopen same file)

---

### 8. Performance Test

#### A. Measure File Open Time

1. **First open (cache miss):**
   - Open DevTools (F12) → Network tab
   - Open a file in IDE
   - Look for WebSocket connection time
   - **Expected:** 50-100ms

2. **Close and reopen same file:**
   - Close file tab
   - Reopen same file
   - Check WebSocket connection time
   - **Expected:** 5-20ms (10x faster)

- [ ] ✅ First open: 50-100ms
- [ ] ✅ Second open: 5-20ms (faster)

#### B. Check Database Load Reduction

```bash
# Get database query count before
ssh -i ~/Downloads/ssh-key-2022-12-01.key ubuntu@129.154.39.198 "
  docker exec -i postgres-db psql 'postgresql://postgres:my_secure_db_password@127.0.0.1:5432/sandbox' -c 'SELECT SUM(calls) FROM pg_stat_statements WHERE query LIKE '\''%SELECT%yjs_state%'\'';'
"

# Open 10 files in IDE (first time)
# Wait 1 minute for cache to populate

# Close all files, reopen same 10 files
# Wait 1 minute

# Get database query count after
ssh -i ~/Downloads/ssh-key-2022-12-01.key ubuntu@129.154.39.198 "
  docker exec -i postgres-db psql 'postgresql://postgres:my_secure_db_password@127.0.0.1:5432/sandbox' -c 'SELECT SUM(calls) FROM pg_stat_statements WHERE query LIKE '\''%SELECT%yjs_state%'\'';'
"
```

**Expected:** Query count should increase by ~10 (first opens) but stay same when reopening (cache hits)

- [ ] ✅ Cache reduces database queries

---

### 9. Monitor Cache Statistics

```bash
ssh -i ~/Downloads/ssh-key-2022-12-01.key ubuntu@129.154.39.198 "
  # Cache key count
  echo 'Cache keys:' && docker exec redis redis-cli dbsize &&
  
  # Memory usage
  echo '' && echo 'Memory:' && docker exec redis redis-cli info memory | grep used_memory_human &&
  
  # Check for cache stats in logs (printed every 10 min)
  echo '' && echo 'Stats:' && pm2 logs backend --nostream --lines 200 | grep 'YjsCache Stats' | tail -1
"
```

- [ ] ✅ Cache keys present
- [ ] ✅ Memory usage acceptable (<100MB)
- [ ] ✅ Stats logged periodically

---

## Rollback (If Issues Found)

### If any check fails:

```bash
cd /Users/amankashyap/Documents/sandbox/backend
./deploy-yjs-cache.sh --rollback
```

This will:
1. Stop backend
2. Restore backup files
3. Restart backend
4. Verify health

- [ ] ⚠️ Rollback executed (if needed)
- [ ] ✅ Backend restored to working state

---

## Success Criteria

### Deployment is successful if:

✅ All tests pass locally  
✅ Deployment script completes without errors  
✅ Backend responds (HTTP 401 on auth endpoint)  
✅ No critical errors in PM2 logs  
✅ Redis cache populates when files are opened  
✅ Cache keys follow pattern `yjs:state:{fileId}`, `yjs:author:{fileId}`  
✅ Logs show cache HIT messages on file reopens  
✅ File open time reduced on cache hits  

---

## Documentation References

- **Summary:** `/Users/amankashyap/Documents/sandbox/YJS_CACHE_SUMMARY.md`
- **Full Docs:** `/Users/amankashyap/Documents/sandbox/backend/YJS_CACHE_IMPLEMENTATION.md`
- **README:** `/Users/amankashyap/Documents/sandbox/README.md` (Performance Optimizations section)

---

## Monitoring Commands (For Later)

```bash
# Watch cache operations in real-time
ssh -i ~/Downloads/ssh-key-2022-12-01.key ubuntu@129.154.39.198 "pm2 logs backend | grep CACHE"

# Check cache size
ssh -i ~/Downloads/ssh-key-2022-12-01.key ubuntu@129.154.39.198 "docker exec redis redis-cli dbsize"

# View all cached files
ssh -i ~/Downloads/ssh-key-2022-12-01.key ubuntu@129.154.39.198 "docker exec redis redis-cli keys 'yjs:*'"

# Check Redis memory
ssh -i ~/Downloads/ssh-key-2022-12-01.key ubuntu@129.154.39.198 "docker exec redis redis-cli info memory | grep used_memory_human"
```

---

## Notes

- Cache has 10-minute TTL (auto-expires)
- Cache invalidates on file save
- Redis failures are non-fatal (falls back to DB)
- Deployment has automatic rollback on failure
- Backup created before every deployment

---

## Completion

**Date:** _________________  
**Deployed by:** _________________  
**Backup location:** _________________  
**Status:** ✅ Success / ⚠️ Rollback / ❌ Failed  
**Notes:** _________________
