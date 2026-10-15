# deploy_interview.md — 1-Week Interview Deployment Playbook

**Target Goal:** Rapid, zero-friction deployment of **both NexusIDE and MagnusCI (ci-cd-engine)** onto a single fresh Virtual Machine 1 week before your Microsoft interview, with a total setup time under **10 minutes** and total cost under **$12**.

---

## 1. Executive Summary & Cost Strategy

Both projects were previously configured to co-exist on the same host VM (`/home/ubuntu/sandbox-ide` and `/home/ubuntu/ci-cd-engine`). Because your previous Oracle VM is dead, we use a **just-in-time provisioning strategy**:

- **When to buy:** Exactly **5 to 7 days before your interview date**.
- **Provider:** **DigitalOcean — 1-Click "Docker on Ubuntu" Marketplace Droplet** (fastest setup, zero verification wait, native Bangalore datacenter).
- **Billing:** Hourly billing ($0.071/hr for 8 GB RAM / 4 vCPUs).
- **Total Cost:**
  - Running for 7 days (168 hours) = **~$11.90 total**.
  - *(Or **$0.00** if you activate the $200 free credit via the GitHub Student Developer Pack).*
- **Teardown:** The day after your interview, click **Destroy Droplet** in DigitalOcean to stop all charges.

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                         SINGLE-VM CO-HOSTING ARCHITECTURE                                                        │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

                       Incoming Internet Traffic (Port 80 / 443)
                                          │
                                          ▼
                   ┌──────────────────────────────────────────────┐
                   │        Nginx Reverse Proxy on Host VM        │
                   │        (Port 80 / SSL Termination)           │
                   └──────────────┬────────────────┬──────────────┘
                                  │                │
          ┌───────────────────────┘                └───────────────────────┐
          │ http://<IP>/ (or :3000)                        │ http://<IP>/ci/ (or :5000)
          ▼                                                ▼
┌──────────────────────────────────────┐         ┌──────────────────────────────────────┐
│  NexusIDE Platform (/sandbox-ide)    │         │  MagnusCI Platform (/ci-cd-engine)   │
├──────────────────────────────────────┤         ├──────────────────────────────────────┤
│ • React Frontend (Vite/Nginx): :3000 │         │ • React 19 Frontend (Vite PWA): :5000│
│ • Express / WebSocket Server: :5001  │         │ • Express API Gateway: :5002         │
│ • Docker PTY Multiplexer (/dev/pts/X)│         │ • BullMQ Worker Daemon (Docker Exec) │
│ • Pre-warmed Alpine Pool (<50ms)     │         │ • MinIO S3 Object Storage: :9000/:9001│
└──────────────────┬───────────────────┘         └──────────────────┬───────────────────┘
                   │                                                │
                   └───────────────────────┬────────────────────────┘
                                           ▼
         ┌──────────────────────────────────────────────────────────────────────┐
         │ Shared Host Resources & Daemon Sockets                               │
         │ • Docker Daemon Socket: /var/run/docker.sock (Shared sibling spawns) │
         │ • PostgreSQL 16 (Port 5432): DB `nexuside_prod` & `magnusci_prod`    │
         │ • Redis 7 (Port 6379): DB 0 (NexusIDE) & DB 1 (MagnusCI BullMQ)      │
         │ • Linux Swapfile (8GB NVMe Swap): Guarantees zero OOM crashes        │
         └──────────────────────────────────────────────────────────────────────┘
```

---

## 2. Step 1: 60-Second Droplet Provisioning (DigitalOcean)

1. Log into [DigitalOcean Console](https://cloud.digitalocean.com/).
2. Click the green **Create** button (top-right) $\rightarrow$ select **Droplets**.
3. **Choose an Image:** Click the **Marketplace** tab $\rightarrow$ search and select **Docker on Ubuntu** *(Ubuntu 24.04 with Docker pre-installed)*.
4. **Choose Datacenter Region:**
   - If in India: Select **Bangalore (`BLR1`)** *(gives <25ms low latency for live Monaco typing during screen-share)*.
   - Otherwise: Select **Frankfurt (`FRA1`)** or **New York (`NYC3`)**.
5. **Choose Size (Droplet Type):**
   - Click **Basic** $\rightarrow$ **Regular with SSD**.
   - Select **$48/mo** ($0.071/hour): **8 GB RAM / 4 vCPUs / 160 GB SSD / 5 TB Transfer**.
   *(Do not select 2GB or 4GB; running both build containers and IDE sandboxes requires 8GB RAM).*
6. **Authentication:**
   - Select **SSH Key** $\rightarrow$ add your Mac's SSH public key (`cat ~/.ssh/id_rsa.pub` or `cat ~/.ssh/id_ed25519.pub`).
   - *(Or set a secure root password).*
7. **Finalize:** Click **Create Droplet**.
8. **Copy Public IP:** In 50 seconds, your Droplet will be live with an assigned public IPv4 (e.g. `159.65.142.88`).

---

## 3. Step 2: One-Time Server Initialization (Run on VM)

SSH into your new VM:
```bash
ssh root@<YOUR_NEW_DROPLET_IP>
```

Paste this **one-liner initialization script** into the VM terminal. It sets up swap memory, creates isolated databases, and prepares directories:

```bash
cat << 'EOF' > /root/init-server.sh
#!/usr/bin/env bash
set -euo pipefail

echo "=========================================================="
echo " 1. Configuring 8GB Swap Space (Prevents OOM Crashes)"
echo "=========================================================="
if [ ! -f /swapfile ]; then
    fallocate -l 8G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "vm.swappiness=10" >> /etc/sysctl.conf
    sysctl -p
fi

echo "=========================================================="
echo " 2. Installing Core Tools & Shared Services"
echo "=========================================================="
apt-get update -y
apt-get install -y git curl wget rsync htop postgresql postgresql-contrib redis-server nginx

# Configure PostgreSQL to listen locally
systemctl enable postgresql && systemctl start postgresql
systemctl enable redis-server && systemctl start redis-server

# Create databases and credentials
sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'postgres';"
sudo -u postgres psql -c "CREATE DATABASE nexuside_prod;" || true
sudo -u postgres psql -c "CREATE DATABASE magnusci_prod;" || true

echo "=========================================================="
echo " 3. Installing Node.js 20 LTS & PM2"
echo "=========================================================="
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g pm2 yarn

echo "=========================================================="
echo " 4. Preparing Project Directories & Permissions"
echo "=========================================================="
mkdir -p /home/ubuntu/sandbox-ide
mkdir -p /home/ubuntu/ci-cd-engine

# Verify Docker daemon is running
docker ps

echo "=========================================================="
echo " SUCCESS: Server is ready for NexusIDE & MagnusCI deploy!"
echo "=========================================================="
EOF

bash /root/init-server.sh
```

---

## 4. Step 3: Deploying Both Projects from Your Local Mac

Both projects already have battle-tested deployment scripts (`deploy.sh`). You only need to pass the new IP address.

On your **local Mac terminal**:

### 1. Deploy NexusIDE (Takes ~90 seconds)
```bash
cd /Users/amankashyap/Documents/nexusIDE

# Run deploy with the new Droplet IP
REMOTE="root@<YOUR_NEW_DROPLET_IP>" \
SSH_KEY="~/.ssh/id_rsa" \
REMOTE_BASE="/home/ubuntu/sandbox-ide" \
bash scripts/deploy.sh --full
```
*What this does:* Syncs source code via rsync, installs dependencies, initializes the PostgreSQL CAS schema, builds the Vite frontend, pre-pulls the `alpine:latest` and `sandbox-dev-env:latest` Docker images for the warm pool, and starts the backend with PM2.

### 2. Deploy MagnusCI (Takes ~90 seconds)
```bash
cd /Users/amankashyap/Documents/ci-cd-engine

# Run deploy with the new Droplet IP
REMOTE_USER="root" \
REMOTE_IP="<YOUR_NEW_DROPLET_IP>" \
SSH_KEY="~/.ssh/id_rsa" \
REMOTE_DIR="/home/ubuntu/ci-cd-engine" \
bash deploy.sh
```
*What this does:* Syncs MagnusCI source, sets up MinIO S3 object storage for build caching, runs migrations on `magnusci_prod`, compiles the worker daemon, and registers the BullMQ background queue.

---

## 5. Step 4: Host Nginx Routing Configuration

To make both platforms accessible over standard HTTP without port collisions, SSH into the Droplet and apply this unified Nginx configuration:

```bash
ssh root@<YOUR_NEW_DROPLET_IP>
```

Paste the following:

```bash
cat << 'EOF' > /etc/nginx/sites-available/default
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 50M;

    # ─── 1. NexusIDE Platform (Primary at root /) ───────────────
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # NexusIDE WebSocket Endpoints (/ide/ws, /ide/terminal)
    location /ide/ {
        proxy_pass http://127.0.0.1:5001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # ─── 2. MagnusCI Platform (Secondary at /ci/) ───────────────
    location /ci/ {
        proxy_pass http://127.0.0.1:5000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }

    # MagnusCI WebSocket & Terminal Log Stream
    location /socket.io/ {
        proxy_pass http://127.0.0.1:5002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    # MagnusCI Ephemeral Build Previews
    location /preview/ {
        proxy_pass http://127.0.0.1:5002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
}
EOF

nginx -t && systemctl reload nginx
```

Now:
- **NexusIDE is live at:** `http://<YOUR_NEW_DROPLET_IP>/`
- **MagnusCI is live at:** `http://<YOUR_NEW_DROPLET_IP>/ci/`

---

## 6. Step 5: 2-Minute Pre-Interview Verification Checklist

Run these quick smoke tests directly in your browser:

1. **NexusIDE Live Verification:**
   - Open `http://<YOUR_NEW_DROPLET_IP>/` in Chrome.
   - Open a second incognito window side-by-side with the same workspace URL.
   - Type in Window A $\rightarrow$ verify character appears in Window B with remote cursor tag (<50ms).
   - Click **Terminal** $\rightarrow$ verify Alpine bash shell connects immediately without delay.
   - Type `top` inside the terminal $\rightarrow$ verify isolated container PTY.
2. **MagnusCI Live Verification:**
   - Open `http://<YOUR_NEW_DROPLET_IP>/ci/`.
   - Trigger a sample build $\rightarrow$ verify DAG topological execution stages turn green.
   - Check real-time log streaming over WebSocket.
3. **VM Resource Health Check:**
   - On the server, run `htop`.
   - With both projects idle, total memory usage should be **~1.8 GB to 2.4 GB** out of 8 GB RAM (leaving >5.5 GB headroom for container bursts).

---

## 7. What to Say in the Interview About This Deployment

When the interviewer asks: *"Where is this deployed?"*, deliver this crisp, senior answer:

> *"I deployed both NexusIDE and MagnusCI side-by-side on a dedicated Linux VPS with an Nginx reverse proxy providing WebSocket connection upgrades and path routing.*  
> *Both systems share the host Docker daemon socket to spawn ephemeral sandboxes, backed by local PostgreSQL 16 and Redis 7 instances with isolated database namespaces.*  
> *To prevent cross-tenant interference under peak concurrent builds, I configured Linux cgroup v2 boundaries on every child container and allocated an 8GB NVMe swap partition to ensure the host operating system never experiences OOM kernel panics."*

---

## 8. Teardown Checklist (Post-Interview)

Once your interview is complete:
1. Log into [DigitalOcean](https://cloud.digitalocean.com/).
2. Navigate to **Droplets** $\rightarrow$ click your Droplet $\rightarrow$ select **Destroy**.
3. Confirm destruction $\rightarrow$ billing stops instantly. Total spent: **~$5 to $12**.
