#!/bin/bash
set -e

echo "=== Fresh Deployment Script ==="
echo ""

# 1. Delete old build
echo "[1/6] Cleaning old frontend build..."
cd /Users/amankashyap/Documents/sandbox/frontend
rm -rf dist node_modules/.vite

# 2. Build fresh
echo "[2/6] Building fresh frontend..."
npm run build

# 3. Delete old files on server
echo "[3/6] Deleting old files on server..."
ssh -i /Users/amankashyap/Downloads/ssh-key-2022-12-01.key ubuntu@129.154.39.198 'rm -rf /home/ubuntu/sandbox-ide/frontend/assets/*'

# 4. Upload new files
echo "[4/6] Uploading new files..."
scp -i /Users/amankashyap/Downloads/ssh-key-2022-12-01.key -r dist/* ubuntu@129.154.39.198:/home/ubuntu/sandbox-ide/frontend/

# 5. Restart frontend
echo "[5/6] Restarting frontend..."
ssh -i /Users/amankashyap/Downloads/ssh-key-2022-12-01.key ubuntu@129.154.39.198 'pm2 restart frontend'

# 6. Verify
echo "[6/6] Verifying deployment..."
sleep 3
ssh -i /Users/amankashyap/Downloads/ssh-key-2022-12-01.key ubuntu@129.154.39.198 'ls -lh /home/ubuntu/sandbox-ide/frontend/assets/ | grep index- | tail -1'

echo ""
echo "=== Deployment Complete ==="
echo "Open http://129.154.39.198 and do HARD REFRESH:"
echo "  • Mac: Cmd + Shift + R"
echo "  • Windows/Linux: Ctrl + Shift + R"
echo ""
echo "If still not showing, open DevTools (F12) → Application → Clear site data"
