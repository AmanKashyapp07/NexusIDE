#!/bin/bash
# E2E test orchestration script for container-based CI engines (like MagnusCI)
set -e

echo "=== 1. Installing System Dependencies (Postgres, Netcat, Docker CLI) ==="
apt-get update && apt-get install -y postgresql postgresql-client netcat-openbsd docker.io

echo "=== 2. Starting PostgreSQL Service ==="
service postgresql start

echo "=== 3. Bootstrapping Database ==="
su - postgres -c "psql -c \"CREATE ROLE \\\"user\\\" WITH SUPERUSER LOGIN PASSWORD 'password';\""
su - postgres -c "createdb -O user sandbox"
PGPASSWORD=password psql -h localhost -U user -d sandbox -f database/schema.sql

echo "=== 4. Installing Playwright Chromium & System Dependencies ==="
npm --prefix frontend exec -- playwright install --with-deps chromium

# The backend automatically builds the sandbox-dev-env:latest terminal image dynamically on startup if it is missing.

echo "=== 6. Launching Backend & Frontend Dev Servers ==="
export DATABASE_URL="postgresql://user:password@localhost:5432/sandbox"
export JWT_SECRET="ci_jwt_secret"
export LOG_LEVEL="silent"
export GEMINI_API_KEY="placeholder"
export NVIDIA_API_KEY="placeholder"
export MISTRAL_API_KEY="placeholder"
export NODE_ENV="test"
export CI="true"

npm --prefix backend run dev > backend.log 2>&1 &
npm --prefix frontend run dev > frontend.log 2>&1 &

echo "=== 7. Waiting for Backend Server ==="
for i in {1..30}; do
  if nc -z localhost 3000; then
    echo "Backend is up!"
    break
  fi
  sleep 1
done

echo "=== 8. Waiting for Frontend Server ==="
for i in {1..30}; do
  if nc -z localhost 5173; then
    echo "Frontend is up!"
    break
  fi
  sleep 1
done

echo "=== 9. Running E2E Integration Tests ==="
npm run test:e2e
