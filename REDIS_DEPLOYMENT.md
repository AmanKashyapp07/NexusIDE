# 🚀 Redis Deployment Guide (Free on Oracle VM)

**Cost: $0 — Redis runs on your existing Oracle VM**

---

## What I've Already Done ✅

1. ✅ Created `backend/src/utils/redisCache.ts` — Redis cache wrapper
2. ✅ Updated `backend/src/routes/workspace.ts` — Cache file content & Yjs states
3. ✅ Updated `backend/src/server.ts` — Invalidate cache on file saves
4. ✅ All code is ready to deploy

---

## Step 1: Install Redis on Your Server (2 minutes)

### Connect to your Oracle VM:
```bash
ssh -i ~/Downloads/ssh-key-2022-12-01.key ubuntu@129.154.39.198
```

### Install Redis via Docker:
```bash
# Pull Redis image (lightweight Alpine version)
docker pull redis:alpine

# Run Redis container
docker run -d \
  --name redis \
  --restart unless-stopped \
  -p 6379:6379 \
  redis:alpine

# Test it works
docker exec redis redis-cli ping
# Should return: PONG
```

**That's it! Redis is now running for free on your VM** ✅

---

## Step 2: Install Redis Client in Backend (1 minute)

### On your local machine:
```bash
cd ~/Documents/sandbox/backend
npm install ioredis
```

---

## Step 3: Update package.json

<function_calls>
<invoke name="read_file">
<parameter name="path">/Users/amankashyap/Documents/sandbox/backend/package.json