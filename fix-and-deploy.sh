#!/bin/bash
set -e

KEY=~/Downloads/ssh-key-2022-12-01.key
SERVER=ubuntu@129.154.39.198

echo "=== Step 1: Uploading files ==="
scp -i $KEY \
  ~/Documents/sandbox/backend/src/utils/redisCache.ts \
  ~/Documents/sandbox/backend/src/utils/preparedQueries.ts \
  ~/Documents/sandbox/backend/src/db.ts \
  ~/Documents/sandbox/backend/src/routes/workspace.ts \
  ~/Documents/sandbox/backend/src/routes/auth.ts \
  ~/Documents/sandbox/backend/src/server.ts \
  ~/Documents/sandbox/backend/package.json \
  $SERVER:/tmp/
echo "Files uploaded"

echo ""
echo "=== Step 2: Fix everything on server ==="
ssh -i $KEY $SERVER << 'ENDSSH'

# --- Copy files ---
cd /home/ubuntu/sandbox-ide/backend
cp /tmp/redisCache.ts src/utils/
cp /tmp/preparedQueries.ts src/utils/
cp /tmp/db.ts src/
cp /tmp/workspace.ts src/routes/
cp /tmp/auth.ts src/routes/
cp /tmp/server.ts src/
cp /tmp/package.json .

# --- Install dependencies ---
npm install

# --- Start Redis if not already running ---
if ! docker ps | grep -q redis; then
  echo "Starting Redis..."
  docker run -d \
    --name redis \
    --restart unless-stopped \
    -p 6379:6379 \
    redis:alpine
  sleep 2
fi
docker exec redis redis-cli ping

# --- Add DB index ---
docker exec -i postgres-db psql "postgresql://postgres:my_secure_db_password@127.0.0.1:5432/sandbox" \
  -c "CREATE INDEX IF NOT EXISTS idx_file_updates_file_seq ON file_updates(file_id, seq); ANALYZE file_updates;"

# --- Fix PM2: delete all stale processes and restart correctly ---
pm2 delete all

# Start backend correctly
cd /home/ubuntu/sandbox-ide/backend
pm2 start "npm start" --name backend --cwd /home/ubuntu/sandbox-ide/backend

# Start frontend correctly
cd /home/ubuntu/sandbox-ide/frontend
pm2 start "npx serve dist -l 3000 -s" --name frontend --cwd /home/ubuntu/sandbox-ide/frontend

pm2 save

# Wait for startup
sleep 5

# Show status
pm2 list

echo ""
echo "=== Backend logs ==="
pm2 logs backend --nostream --lines 20

ENDSSH

echo ""
echo "=== Step 3: Verify optimizations ==="

echo ""
echo "1. Redis ping:"
ssh -i $KEY $SERVER "docker exec redis redis-cli ping"

echo ""
echo "2. Redis connected in backend logs:"
ssh -i $KEY $SERVER "pm2 logs backend --nostream --lines 30 | grep -i redis || echo 'NOT FOUND - check logs above'"

echo ""
echo "3. DB index:"
ssh -i $KEY $SERVER "docker exec -i postgres-db psql 'postgresql://postgres:my_secure_db_password@127.0.0.1:5432/sandbox' -c '\d file_updates' | grep idx_file_updates_file_seq"

echo ""
echo "4. Backend responding:"
ssh -i $KEY $SERVER "curl -s -o /dev/null -w 'HTTP %{http_code}' http://localhost:4000/api/auth/me"

echo ""
echo "=== DONE ==="
