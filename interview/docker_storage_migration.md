# Architecture Migration: Docker Bind Mounts vs In-Memory Tmpfs

When discussing the storage layer of NexusIDE during an interview, this document outlines the migration from the MVP storage model to the production-ready Persistent Block Storage model.

## The Problem: Tmpfs & Database Bottlenecks

In the MVP version of NexusIDE, workspace files were stored purely in a PostgreSQL database. When a container booted, it was allocated an empty, temporary, RAM-backed filesystem (`tmpfs`). 
The backend had to execute a recursive SQL query, bundle the files into a tarball in memory, and pipe them into the container on every boot. 

**Drawbacks of the MVP Model:**
1. **Hydration Latency:** Booting a workspace with 1,000+ files required heavy CPU utilization to reconstruct the file tree, delaying container startup.
2. **NPM / Binary Bottlenecks:** When a user ran `npm install` inside the terminal, the `node_modules` folder was created in the `tmpfs`. The backend then had to poll the filesystem and attempt to upload 30,000+ files as individual rows into the SQL database. This caused catastrophic performance degradation.
3. **Volatility:** If the container crashed, any files not successfully synced to PostgreSQL were lost.

---

## The Solution: Local Host Volume Mapping (Docker Bind Mounts)

To solve this, we migrated the architecture to simulate **Persistent Block Storage** (the exact concept used by AWS EBS, GitHub Codespaces, and AWS Cloud9).

Instead of forcing the PostgreSQL database to act as a raw file server, we utilized the physical hard drive of the host machine running the backend.

### How it Works:
1. **Host-Side Directory:** When a workspace is created, the Node.js backend uses `fs.mkdir` to create a dedicated folder on the host's actual hard drive (`workspace_data/<workspace_id>`).
2. **Bind Mounting:** The Docker container is provisioned with a Bind Mount that maps the host's `workspace_data/` directory directly into the container at `/workspaces`.
3. **Native Disk I/O:** When the user's terminal performs file operations (like `npm install`), the container writes directly to the host's SSD. It completely bypasses the Node.js backend and the database.

---

## Technical Talking Points for Interviews

If an interviewer asks how you optimized the storage or dealt with file synchronization latency, you can explain:

> *"Initially, we stored all code inside PostgreSQL and streamed tar archives into a temporary Docker RAM filesystem. However, this became a bottleneck when executing package managers like NPM, which generated thousands of files that overwhelmed our database sync loop."*
> 
> *"To solve this, I migrated our architecture to use Docker Bind Mounts. I provisioned physical directories on the backend host machine and bound them directly into the Docker containers. This effectively decoupled heavy file I/O from our database, gave the terminal native SSD read/write speeds, and eliminated container hydration latency because the files persist physically on the host between container restarts."*

This demonstrates an understanding of **Storage Architectures**, **Docker Internals (tmpfs vs Bind Mounts)**, and **Database Optimization (offloading blob data to block storage)**.
