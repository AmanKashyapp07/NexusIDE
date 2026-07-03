# Oracle Cloud Deployment Report

This report describes how to deploy the project on an Oracle Cloud VM as a single-host production setup.

## Target Architecture

- Oracle Cloud Compute Instance running Ubuntu 22.04 LTS
- Nginx as the public reverse proxy
- Node.js backend on port 4000, kept private behind Nginx
- PostgreSQL running locally on the VM
- Docker Engine on the same host for sandbox containers
- Frontend built once and served as static files through Nginx

## Why This Layout

The application depends on low-latency websocket traffic, Docker container management, and local database access. A single VM keeps the system simple and avoids distributed coordination overhead.

The browser-facing app should use the Oracle domain, not `localhost`, so the frontend must be configured with environment-based backend URLs.

## Required Oracle Cloud Rules

Only expose these ports publicly:

- `22` for SSH
- `80` for HTTP
- `443` for HTTPS

Keep these private:

- `4000` for the Express backend
- `5432` for PostgreSQL

## Backend Environment

Set the backend `.env` file on the VM with:

```env
PORT=4000
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/sandbox
JWT_SECRET=your-secret
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
FRONTEND_URL=https://ide.yourdomain.com
MISTRAL_API_KEY=...
MISTRAL_AUTOCOMPLETE_MODEL=codestral-latest
```

## Frontend Environment

Use build-time frontend env values so the browser points to the public domain:

```env
VITE_API_URL=https://ide.yourdomain.com/api
VITE_WS_URL=wss://ide.yourdomain.com
```

## Deployment Steps

1. Provision an Oracle Cloud VM with at least 2 vCPU and 4 GB RAM.
2. Install Node.js 20+, Docker, PostgreSQL, Nginx, and PM2.
3. Clone the repository onto the VM.
4. Create the database and apply `database/schema.sql`.
5. Build the frontend with `npm run build`.
6. Start the backend with PM2 so it restarts automatically.
7. Configure Nginx to:
   - serve `frontend/dist`
   - proxy `/api/` to `127.0.0.1:4000`
   - proxy `/socket.io/`, `/terminal/`, `/ws/lsp/`, and websocket paths to the backend
8. Obtain TLS certificates with Certbot and force HTTPS.

## Nginx Routing

Recommended routing:

- `/` -> React SPA static files
- `/api/` -> Express backend
- `/socket.io/` -> Socket.IO websocket transport
- `/terminal/` -> terminal websocket
- `/ws/lsp/` -> language server websocket
- `/yjs/` -> collaborative document websocket

## GitHub OAuth Callback

Update the GitHub OAuth callback URL in the GitHub App settings to:

```text
https://ide.yourdomain.com/api/auth/github/callback
```

The backend now uses `FRONTEND_URL` when redirecting users after GitHub login.

## Docker Notes

- The backend must run on a host that can access `/var/run/docker.sock`.
- The VM user running PM2 should be in the `docker` group.
- Sandbox containers are created and managed directly by the backend.

## Operational Notes

- Use PM2 to keep the backend alive across reboots.
- Use Nginx and Certbot for public HTTPS traffic.
- Keep PostgreSQL bound to localhost or a private socket.
- Run regular Docker pruning only after confirming it will not remove active sandbox layers.

## Interview Summary

The key production idea is to keep the system on one VM, front it with Nginx, and keep all critical services local to the machine. That preserves websocket reliability, Docker control, and database performance while minimizing infrastructure complexity.