#!/bin/bash
set -e

echo "=== NUCLEAR REDEPLOY - Complete Fresh Deployment ==="
echo ""
echo "⚠️  WARNING: This will DELETE all frontend files on the server"
echo "⚠️  Database will NOT be touched"
echo ""
read -p "Continue? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
    echo "Aborted."
    exit 1
fi

SSH_KEY="/Users/amankashyap/Downloads/ssh-key-2022-12-01.key"
SERVER="ubuntu@129.154.39.198"

echo ""
echo "[1/10] Stopping frontend on server..."
ssh -i $SSH_KEY $SERVER 'pm2 stop frontend'

echo "[2/10] Deleting ALL frontend files on server..."
ssh -i $SSH_KEY $SERVER 'rm -rf /home/ubuntu/sandbox-ide/frontend/*'

echo "[3/10] Verifying frontend directory is empty..."
ssh -i $SSH_KEY $SERVER 'ls -la /home/ubuntu/sandbox-ide/frontend/' || echo "Directory empty ✓"

echo "[4/10] Clearing PM2 logs..."
ssh -i $SSH_KEY $SERVER 'pm2 flush'

echo "[5/10] Cleaning local build..."
cd /Users/amankashyap/Documents/sandbox/frontend
rm -rf dist node_modules/.vite .vite

echo "[6/10] Building fresh frontend..."
npm run build

echo "[7/10] Verifying build output..."
ls -lh dist/index.html
ls -lh dist/assets/index-*.js | head -1

echo "[8/10] Uploading fresh files to server..."
scp -i $SSH_KEY -r dist/* $SERVER:/home/ubuntu/sandbox-ide/frontend/

echo "[9/10] Verifying uploaded files..."
ssh -i $SSH_KEY $SERVER 'ls -lh /home/ubuntu/sandbox-ide/frontend/index.html'
ssh -i $SSH_KEY $SERVER 'ls -lh /home/ubuntu/sandbox-ide/frontend/assets/index-*.js | head -1'

echo "[10/10] Starting frontend..."
ssh -i $SSH_KEY $SERVER 'pm2 start frontend'

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "✓ All old files deleted"
echo "✓ Fresh build deployed"
echo "✓ Frontend restarted"
echo ""
echo "NOW DO THIS:"
echo "1. Open Chrome DevTools (F12)"
echo "2. Go to Application tab"
echo "3. Click 'Clear site data' button"
echo "4. Close DevTools"
echo "5. Open NEW INCOGNITO WINDOW (Cmd+Shift+N)"
echo "6. Go to http://129.154.39.198"
echo "7. Login, open file, click Blame button"
echo "8. The purple 'Hide Blame' button should appear in top-left header"
echo ""
