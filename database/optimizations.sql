-- ===========================================================================
-- FREE DATABASE OPTIMIZATIONS (No external services needed)
-- ===========================================================================
-- Run these on your production database to improve performance

-- 1. COMPOSITE INDEX: Speed up timelapse queries by 10x
-- Current: When fetching updates for timelapse, PostgreSQL scans all rows
-- After: Direct index lookup
CREATE INDEX IF NOT EXISTS idx_file_updates_file_seq ON file_updates(file_id, seq);

-- 2. PARTIAL INDEX: Speed up "active workspaces" queries
-- Only index workspaces that were recently updated
CREATE INDEX IF NOT EXISTS idx_workspaces_recent ON workspaces(updated_at DESC) 
WHERE updated_at > NOW() - INTERVAL '30 days';

-- 3. ANALYZE: Update query planner statistics
-- PostgreSQL uses statistics to choose optimal query plans
-- Run this weekly or after large data imports
ANALYZE files;
ANALYZE file_updates;
ANALYZE workspaces;

-- 4. VACUUM: Reclaim space from deleted rows
-- PostgreSQL doesn't immediately delete rows, just marks them as deleted
-- Run this monthly to reclaim disk space
VACUUM ANALYZE files;
VACUUM ANALYZE file_updates;

-- ===========================================================================
-- MONITORING QUERIES (Check these regularly)
-- ===========================================================================

-- Check table sizes (find bloat)
SELECT 
    schemaname AS schema,
    tablename AS table,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Check slow queries (find bottlenecks)
-- Enable this in postgresql.conf first: shared_preload_libraries = 'pg_stat_statements'
-- SELECT query, calls, mean_exec_time, total_exec_time 
-- FROM pg_stat_statements 
-- ORDER BY mean_exec_time DESC LIMIT 10;

-- Check unused indexes (remove to save space)
SELECT 
    schemaname || '.' || tablename AS table,
    indexname AS index,
    pg_size_pretty(pg_relation_size(indexrelid)) AS size,
    idx_scan AS scans
FROM pg_stat_user_indexes
WHERE idx_scan = 0 
AND schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC;

-- ===========================================================================
-- AUTO-CLEANUP: Archive old timelapse data (run monthly)
-- ===========================================================================

-- Problem: file_updates table grows forever (every keystroke = new row)
-- Solution: Delete updates older than 90 days (keep recent history)
-- Note: This is safe because yjs_state has the final merged state

-- DRY RUN: See how much data would be deleted
SELECT 
    COUNT(*) as rows_to_delete,
    pg_size_pretty(SUM(pg_column_size(update))) as space_to_reclaim
FROM file_updates 
WHERE created_at < NOW() - INTERVAL '90 days';

-- ACTUAL DELETE: Uncomment when ready
-- DELETE FROM file_updates WHERE created_at < NOW() - INTERVAL '90 days';
-- VACUUM ANALYZE file_updates;

-- ===========================================================================
-- CONFIGURATION TUNING (Edit postgresql.conf)
-- ===========================================================================

-- For a server with 2GB RAM, set these:
-- shared_buffers = 512MB           # 25% of RAM
-- effective_cache_size = 1536MB    # 75% of RAM
-- work_mem = 16MB                  # Per query, increase if complex queries
-- maintenance_work_mem = 256MB     # For VACUUM, CREATE INDEX
-- max_connections = 100            # Reduce if using connection pooling

-- Then restart PostgreSQL:
-- sudo systemctl restart postgresql
