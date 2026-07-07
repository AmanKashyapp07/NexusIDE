#!/bin/bash

# ===========================================================================
# FREE DATABASE MAINTENANCE SCRIPT
# ===========================================================================
# Run this weekly to keep your database healthy (no Redis/S3 needed)
#
# Usage:
#   chmod +x maintenance.sh
#   ./maintenance.sh
#
# Or add to crontab for automatic weekly runs:
#   0 2 * * 0 /path/to/maintenance.sh  # Every Sunday at 2 AM
# ===========================================================================

set -e

# Database connection (adjust these)
DB_HOST="127.0.0.1"
DB_PORT="5432"
DB_NAME="sandbox"
DB_USER="postgres"
DB_PASSWORD="my_secure_db_password"

# Or use Docker connection
DOCKER_CONTAINER="postgres-db"
USE_DOCKER=true

echo "==================================="
echo "Database Maintenance Script"
echo "==================================="
echo "Started: $(date)"
echo ""

# Function to run SQL
run_sql() {
    if [ "$USE_DOCKER" = true ]; then
        docker exec -i "$DOCKER_CONTAINER" psql "postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME" -c "$1"
    else
        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "$1"
    fi
}

# 1. CHECK TABLE SIZES
echo "📊 Checking table sizes..."
run_sql "
SELECT 
    tablename AS table,
    pg_size_pretty(pg_total_relation_size('public.'||tablename)) AS size
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size('public.'||tablename) DESC;
"
echo ""

# 2. UPDATE STATISTICS
echo "📈 Updating query planner statistics..."
run_sql "ANALYZE files;"
run_sql "ANALYZE file_updates;"
run_sql "ANALYZE workspaces;"
echo "✅ Statistics updated"
echo ""

# 3. VACUUM (reclaim space)
echo "🧹 Reclaiming disk space (VACUUM)..."
run_sql "VACUUM ANALYZE files;"
run_sql "VACUUM ANALYZE file_updates;"
echo "✅ Space reclaimed"
echo ""

# 4. CHECK OLD DATA
echo "⏰ Checking old timelapse data (>90 days)..."
OLD_DATA=$(run_sql "
SELECT 
    COUNT(*) as rows,
    pg_size_pretty(SUM(pg_column_size(update))) as size
FROM file_updates 
WHERE created_at < NOW() - INTERVAL '90 days';
" | grep -E '^\s*[0-9]')

echo "Found: $OLD_DATA"
echo "💡 To delete: Uncomment line 96 in optimizations.sql"
echo ""

# 5. CHECK UNUSED INDEXES
echo "🔍 Checking for unused indexes..."
run_sql "
SELECT 
    indexname AS index,
    pg_size_pretty(pg_relation_size(indexrelid)) AS size,
    idx_scan AS scans
FROM pg_stat_user_indexes
WHERE idx_scan = 0 
AND schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC
LIMIT 5;
"
echo ""

# 6. CONNECTION STATS
echo "🔌 Active connections:"
run_sql "
SELECT 
    COUNT(*) as total_connections,
    COUNT(*) FILTER (WHERE state = 'active') as active,
    COUNT(*) FILTER (WHERE state = 'idle') as idle
FROM pg_stat_activity 
WHERE datname = '$DB_NAME';
"
echo ""

echo "==================================="
echo "✅ Maintenance complete!"
echo "Finished: $(date)"
echo "==================================="
