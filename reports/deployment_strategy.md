# Deployment Strategy: Virtual Machine (VM) Hosting

This document details the production deployment strategy for **NexusIDE** on a cloud Virtual Machine (e.g., AWS EC2, GCP Compute Engine, DigitalOcean Droplet) running a modern Linux distribution (Ubuntu 22.04 LTS recommended).

---

## 1. High-Level Architecture

The deployment topology on a single VM leverages a reverse proxy for request routing, process managers for service persistence, and the native Docker daemon for containerized sandboxes.

```
                  ┌────────────────────────────────────────┐
                  │               Public Web               │
                  └───────────────────┬────────────────────┘
                                      │ (HTTPS: 443)
                                      ▼
                  ┌────────────────────────────────────────┐
                  │           Nginx Reverse Proxy          │
                  └───────────┬────────────────┬───────────┘
         / (Static files)     │ /api & /socket │ /yjs
                              ▼                ▼
     ┌────────────────────────┐  ┌─────────────┐  ┌────────┐
     │ Frontend Static Server │  │ Express API │  │ Yjs WS │
     │  (Nginx / SPA serving) │  │  (Port 4000)│  │ Server │
     └────────────────────────┘  └──────┬──────┘  └────────┘
                                        │ (Unix Socket)
                                        ▼
                                ┌──────────────┐
                                │ Docker Host  │
                                │  (Sandboxes) │
                                └──────────────┘
```

---

## 2. Infrastructure Setup & Requirements

### Recommended VM Sizing
* **Minimum**: 2 vCPUs, 4GB RAM (Supports ~5–10 concurrent active sandboxes).
* **Recommended**: 4 vCPUs, 8GB RAM (Enables larger warm pool sizes and better compiler performance).
* **Storage**: 20GB+ SSD (To store OS files, Node modules, PostgreSQL logs, and Docker layers).

### Security Group (Firewall) Configuration
Only expose the minimum necessary ports to the public internet:
* **Port 22 (TCP)**: SSH access (Clamped to your team's IP range if possible).
* **Port 80 (TCP)**: HTTP (Redirects instantly to HTTPS).
* **Port 443 (TCP)**: HTTPS (Public gateway).
* **Block all other ports** (e.g., PostgreSQL `5432` and Express `4000` must remain internal-only).

---

## 3. Host System Configuration

### A. Docker Daemon Security & cgroups
Since the backend interacts directly with Docker via the `/var/run/docker.sock` Unix socket:
1. Ensure the system user running the Express backend belongs to the `docker` group:
   ```bash
   sudo usermod -aG docker deploy-user
   ```
2. Validate cgroups v2 is active (needed for resource limits enforcement like memory peak telemetry):
   ```bash
   grep cgroup /proc/filesystems
   ```

### B. PostgreSQL Setup
For a single-VM architecture, running PostgreSQL locally is highly cost-effective.
* Apply PostgreSQL optimization tools (e.g., `pgtune`) to adjust `shared_buffers` and `work_mem` based on the VM RAM.
* Secure PostgreSQL authentication by ensuring `pg_hba.conf` only permits local connections (`127.0.0.1/32` or Unix socket).

---

## 4. Reverse Proxy Setup (Nginx)

Nginx is placed in front of the services to terminate SSL certificates (managed by Let's Encrypt / Certbot) and route standard traffic vs WebSocket streams.

### Configuration (`/etc/nginx/sites-available/nexuside`)
```nginx
server {
    listen 80;
    server_name ide.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ide.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/ide.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ide.yourdomain.com/privkey.pem;

    # Serve compiled static React files (Frontend)
    location / {
        root /var/www/nexuside/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # Proxy HTTP API requests to Express backend
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Proxy Socket.io presence updates (WebSockets)
    location /socket.io/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Proxy Yjs real-time document synchronization (WebSockets)
    location /yjs/ {
        proxy_pass http://127.0.0.1:4000; # Or separate port if y-websocket is isolated
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }
}
```

---

## 5. Node.js Service Management

Use **PM2** to run both the API backend and any standalone WebSocket servers. PM2 provides automatic restarts on crashes, cluster mode, and system log rotation.

### A. PM2 Configuration (`ecosystem.config.js`)
```javascript
module.exports = {
  apps: [
    {
      name: 'nexus-backend',
      script: 'dist/server.js',
      cwd: '/var/www/nexuside/backend',
      instances: 'max', // Scale across all available CPU cores
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
        DATABASE_URL: 'postgresql://db_user:db_password@127.0.0.1:5432/sandbox',
        JWT_SECRET: 'production_secret_key_change_me_immediately',
        GEMINI_API_KEY: 'your-production-gemini-key'
      }
    }
  ]
};
```

### B. Startup Command
```bash
# Compile TypeScript to JavaScript
npm run build

# Start services under PM2 control
pm2 start ecosystem.config.js

# Ensure PM2 starts automatically on system reboot
pm2 startup
pm2 save
```

---

## 6. Docker Image Setup & Pool Initialization

On VM deployment initialization, pull/build the base sandbox runner image so execution starts are fast:

1. Build/register the runner image:
   ```bash
   docker build -t sandbox-dev-env:latest ./backend/docker/runner/
   ```
2. The `WarmPoolManager` class in the backend code will automatically pre-warm and fill the pool capacity upon service launch.

---

## 7. Operational & Maintenance Tasks

* **Log Rotation**: Configure Nginx and PM2 logs (`pm2-logrotate`) to prevent disk depletion.
* **Warm Pool Monitoring**: Set up system monitoring (e.g., Prometheus node-exporter) to track host memory capacity. If active sandboxes consume too much RAM, configure Docker limits or swap space.
* **Docker Garbage Collection**: Add a daily cron job to prune dangling container assets:
  ```bash
  0 2 * * * docker system prune -af --filter "until=24h"
  ```
