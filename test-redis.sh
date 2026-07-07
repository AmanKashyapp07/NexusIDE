#!/bin/bash

echo "🧪 Testing Redis Setup..."
echo ""

ssh -i ~/Downloads/ssh-key-2022-12-01.key ubuntu@129.154.39.198 << 'TEST'
echo "1. Checking Redis container status..."
docker ps | grep redis

echo ""
echo "2. Testing Redis connection..."
docker exec redis redis-cli ping

echo ""
echo "3. Checking Redis memory usage..."
docker exec redis redis-cli info memory | grep used_memory_human

echo ""
echo "4. Checking cached keys..."
docker exec redis redis-cli dbsize

echo ""
echo "5. Checking backend logs for Redis connection..."
pm2 logs backend --nostream --lines 20 | grep -i redis

echo ""
echo "6. Sample cached keys..."
docker exec redis redis-cli keys '*' | head -10
TEST

echo ""
echo "✅ Test complete!"
