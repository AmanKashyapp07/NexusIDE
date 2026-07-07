#!/bin/bash
set -e

echo "🗄️  Optimizing Database..."
echo ""

ssh -i ~/Downloads/ssh-key-2022-12-01.key ubuntu@129.154.39.198 << 'DB_OPT'
echo "Adding composite index for timelapse queries..."
docker exec -i postgres-db psql "postgresql://postgres:my_secure_db_password@127.0.0.1:5432/sandbox" << 'SQL'
CREATE INDEX IF NOT EXISTS idx_file_updates_file_seq ON file_updates(file_id, seq);
ANALYZE file_updates;
SQL

echo ""
echo "✅ Database optimized"
echo ""
echo "Checking table sizes..."
docker exec -i postgres-db psql "postgresql://postgres:my_secure_db_password@127.0.0.1:5432/sandbox" << 'SQL'
SELECT 
    tablename,
    pg_size_pretty(pg_total_relation_size('public.'||tablename)) AS size
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size('public.'||tablename) DESC
LIMIT 5;
SQL
DB_OPT

echo ""
echo "🎉 Database optimization complete!"
