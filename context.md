# NexusIDE: Master Context & Systems Architecture Document

> **Target Project**: NexusIDE ([Repository](https://github.com/AmanKashyapp07/NexusIDE) • [Live Cloud VM](http://129.154.39.198/ide/login))  
> **Target Role**: Microsoft Software Engineering Internship & Full-Time Interviews  
> **Document Purpose**: Single-source-of-truth master context document detailing the complete systems engineering, data structures, kernel primitives, concurrency mechanics, failure modes, and architectural trade-offs of the NexusIDE platform.

---

## 1. Executive Master Summary & The Interview Pitch

### The 30-Second Elevator Pitch
> *"NexusIDE is a production-grade, collaborative cloud development environment that enables multi-user code editing, interactive terminal sessions, and containerized execution directly in the browser—similar to a self-hosted Replit or GitHub Codespaces.  
> Under the hood, it solves four hard distributed systems and infrastructure challenges:  
> 1. **Real-time state convergence** using Yjs Conflict-Free Replicated Data Types (CRDTs) over WebSockets with an origin-tagged Redis Pub/Sub mesh across stateless Node.js pods.  
> 2. **Ephemeral container orchestration** with a pre-warmed Docker container pool cutting cold-start provisioning from 3.2s to <50ms, multi-user PTY terminal isolation (`/dev/pts/X`), and Linux cgroups v2 hibernation (`container.pause()`).  
> 3. **High-efficiency persistence** featuring a Git-style Content-Addressable Storage (CAS) Merkle DAG with SHA-256 deduplication cutting database storage by 92%, offloaded to worker threads to keep event loop lag <0.8ms.  
> 4. **Low-latency rendering and streaming** via Monaco native `deltaDecorations`, dynamic typing-velocity debouncing cutting SQL write IOPS by 95%, and full-fidelity per-keystroke timelapse playback."*

### Why I Built This
Most web applications treat the backend as a simple CRUD wrapper around an SQL database. A cloud IDE, by contrast, operates at the intersection of **operating systems, distributed consensus, and real-time networking**:
- Keeping persistent document state synchronized across multiple users concurrently typing without central lockstep servers.
- Safely executing untrusted user-supplied code without risking host OS compromise or fork bombs.
- Maintaining interactive Unix PTY bash streams with ANSI escape codes and sub-10ms latency over WebSockets.
- Scaling horizontally across multiple backend pods without sticky sessions or state loss during pod restarts.

---

## 2. End-to-End Infrastructure & Request Topology

### System Architecture Diagram
```mermaid
flowchart TD
    subgraph Client ["Client Layer (Browser)"]
        Monaco["Monaco Editor (React 18 + TS)"]
        XTerm["xterm.js Terminal"]
        YjsClient["Yjs CRDT Client (y-websocket)"]
    end

    subgraph EdgeGateway ["Edge & Gateway Layer (Ubuntu VM)"]
        Nginx["Nginx 1.18 Reverse Proxy"]
        Express["Express REST API (/ide/api)"]
        WSServer["Raw WebSocket Server (/ide/ws)"]
        SocketIO["Socket.IO Presence Broker"]
    end

    subgraph CoreEngine ["Backend Core Engine (Node.js + PM2)"]
        YjsEngine["Yjs Sync Engine (WSSharedDoc)"]
        WorkerPool["Node.js worker_threads Pool (casWorker.js)"]
        Debouncer["Adaptive Persistence Debouncer"]
        WriteBehind["Redis Write-Behind Ingestion Queue"]
        Redlock["Redlock Distributed Lock Manager"]
    end

    subgraph MeshStorage ["State Mesh & Database Layer"]
        RedisPubSub[("Redis 7 Pub/Sub Mesh")]
        RedisCache[("Redis 7 L2 Cache & Locks")]
        Postgres[("PostgreSQL 16 Database")]
    end

    subgraph SandboxLayer ["Execution Sandbox Layer (Docker Engine)"]
        PoolManager["WarmPoolManager (Pre-Warmed Containers)"]
        SharedContainer["1 Shared Container per Workspace"]
        PTY1["PTY Exec (/dev/pts/1 - User A)"]
        PTY2["PTY Exec (/dev/pts/2 - User B)"]
        LSP["Language Server (Pyright / TS)"]
        Volume["Shared Volume (/workspaces/id)"]
    end

    Monaco --> Nginx
    XTerm --> Nginx
    YjsClient --> Nginx

    Nginx -->|HTTP REST| Express
    Nginx -->|WebSocket Upgrade| WSServer
    Nginx -->|Socket.IO| SocketIO

    WSServer --> YjsEngine
    WSServer --> XTerm
    YjsEngine --> Debouncer
    YjsEngine --> WorkerPool
    YjsEngine --> Redlock

    Debouncer --> WriteBehind
    WriteBehind --> Postgres
    Redlock --> RedisCache
    YjsEngine --> RedisPubSub

    Express --> PoolManager
    PoolManager --> SharedContainer
    WSServer --> PTY1
    WSServer --> PTY2
    WSServer --> LSP

    PTY1 --> Volume
    PTY2 --> Volume
```

### Infrastructure Specifications

| Infrastructure Layer | Technology | Operational Configuration & Specifications |
| :--- | :--- | :--- |
| **Cloud Hosting** | Oracle Cloud Infrastructure (OCI) | Ubuntu 22.04 LTS Compute VM (4 vCPU, 24GB RAM, NVMe storage). |
| **Reverse Proxy & TLS** | Nginx | HTTP reverse proxy, Gzip compression, WebSocket upgrades (`Upgrade $http_upgrade`), extended proxy timeouts (`proxy_read_timeout 3600s`). |
| **Process Manager** | PM2 | High-availability Node.js daemonization, auto-restart on unhandled exceptions, zero-downtime rolling reloads (`pm2 reload`). |
| **Relational Database** | PostgreSQL 16 | Relational tables, `BYTEA` binary CRDT state storage, covering B-Tree indexes with `INCLUDE` clauses, prepared statements. |
| **In-Memory State & Mesh**| Redis 7 | Pub/Sub cross-pod synchronization, Redlock distributed locking (`SET NX PX` + Lua scripts), L2 filesystem cache, user presence. |
| **Container Sandbox** | Docker Engine | `dockerode` Unix socket API (`/var/run/docker.sock`), Alpine Linux dev containers (`sandbox-dev-env:latest`), cgroups v2 resource limits. |
| **Compute Offloader** | Node.js `worker_threads` | Dedicated thread pool (`casWorker.js`) for CPU-bound SHA-256 Merkle tree hashing and Yjs binary delta compaction. |
| **Automated Deployment** | Git Pre-Push Hook | `.githooks/pre-push` executing automated Vite production build, rsync delta sync, and PM2 hot reload on `git push origin main`. |

---

## 3. Subsystem Deep Dives: First Principles, Mechanics & Trade-Offs

### Subsystem 1: Real-Time CRDT Synchronization & Stateless Clustering

#### 1. The Core Problem: Why CRDTs over Operational Transformation (OT)?
- **Operational Transformation (Google Docs style):** Requires a single, centralized, lockstep server to transform incoming character index offsets against a global commit log. If two clients submit edits concurrently at index 10, the server must serialize and adjust operation indices before broadcasting. This creates an unscalable single-threaded central bottleneck and makes peer-to-peer or multi-master offline editing extremely brittle.
- **Yjs CRDTs (Conflict-Free Replicated Data Types):** Text is modeled as a doubly-linked list of `Item` structures, uniquely identified by a globally unique tuple: `(ClientID, Clock)`.
  - Edits do not depend on absolute string offsets; they reference the origin `ID` of the preceding item.
  - Convergence is mathematically guaranteed by the semilattice properties of join operations: **Associativity** $(A \sqcup B) \sqcup C = A \sqcup (B \sqcup C)$, **Commutativity** $A \sqcup B = B \sqcup A$, and **Idempotency** $A \sqcup A = A$.
  - Regardless of network latency, packet re-ordering, or temporary network partitions, applying the same set of update vectors produces the exact same document state on all nodes.

#### 2. Stateless Horizontal Clustering via Redis Pub/Sub Mesh
- **The Challenge:** In a production Kubernetes or multi-node deployment, User A connects to Node Pod 1 and User B connects to Node Pod 2. Without sticky sessions, Pod 1 must fan out User A's keystrokes to Pod 2 in sub-5ms.
- **The Mechanism ([`redisAdapter.service.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/services/redisAdapter.service.ts)):**
  - Pod 1 receives a binary Yjs update from User A, applies it locally to its in-memory `WSSharedDoc`, and publishes the binary buffer to Redis on channel `yjs:update:<docName>`.
  - Pod 2 consumes the message via `ioredis` on `pmessageBuffer` (preserving raw binary buffers to prevent UTF-8 string corruption).
  - Pod 2 applies the update to its local `WSSharedDoc` passing an explicit `'redis'` origin tag: `Y.applyUpdate(doc, updateArray, 'redis')`.
- **Feedback Loop Prevention:** When Pod 2 applies the update, its local `Y.Doc.on('update')` listener checks: `if (origin !== 'redis') publishToRedis(...)`. Because the origin is `'redis'`, Pod 2 broadcasts to its local WebSocket clients but **does not re-publish back to Redis**, cleanly breaking recursive message storms.

#### 3. Node.js Shared Buffer Pool Pitfall & The Fix
- **The Bug:** Passing a sliced Node.js `Buffer` directly to `new Uint8Array(buffer)` silently ignores `buffer.byteOffset`. In V8/Node.js, small buffers (<4KB) are allocated from a shared 8KB internal `ArrayBuffer` pool. When binary decoders read `buffer.buffer` from index 0, they parse unrelated memory from adjacent allocations, corrupting the CRDT state vector.
- **The Fix:** Defensive, explicit offset instantiation across all binary decoders:
  ```typescript
  const updateArray = new Uint8Array(messageBuffer.buffer, messageBuffer.byteOffset, messageBuffer.byteLength);
  ```

#### 4. WebSocket Backpressure & Traffic Coalescing
- **Soft Limit (1 MB):** Inspects `conn.bufferedAmount` per socket. If buffered bytes exceed 1MB, non-critical cursor/presence awareness frames are dropped immediately to preserve editor typing responsiveness.
- **Hard Limit (5 MB):** If `bufferedAmount` exceeds 5MB (indicating a frozen or severely throttled client), the server forcefully terminates the connection (`conn.terminate()`), preventing unbounded Node.js heap consumption.
- **Micro-Tick Awareness Coalescing:** Cursor and selection updates are batched into ~16ms animation-frame intervals before broadcast, reducing network packet volume by ~80% during rapid mouse movements.

---

### Subsystem 2: Persistence, Adaptive Debouncing & Distributed Locking

#### 1. The Database Write Amplification Problem
- A team of 5 developers typing actively produces ~30 to 60 keystrokes per second. Writing every single CRDT update to PostgreSQL immediately would generate 3,600 SQL `UPDATE` queries per minute, exhausting connection pools, bloating the WAL log, and triggering table heap locks.

#### 2. Adaptive Typing-Velocity Debouncing ([`adaptiveDebouncer.service.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/services/adaptiveDebouncer.service.ts))
Instead of a naive fixed timer, the debouncer measures keystroke velocity dynamically:
- **Fast Burst (>5 chars/sec):** Debounce window expands to **2000ms** to allow the developer to finish their typing burst before committing.
- **Steady Typing (1–4 chars/sec):** Debounce window sits at **1000ms**.
- **Pause / Idle (<1 char/sec):** Flushes immediately within **300ms**.
- **Paste / Blur / Close:** Triggers an immediate zero-latency flush.
- **Result:** Reduces PostgreSQL database write IOPS by over **95%**.

#### 3. Redis Write-Behind Buffer Queue ([`crdtWriteBehind.service.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/services/crdtWriteBehind.service.ts))
- Pending document states are staged in an in-memory Redis write-behind hash queue.
- If the Node.js process crashes abruptly, the latest document state is already preserved in Redis RAM and is flushed to PostgreSQL by surviving worker daemons.

#### 4. Distributed Mutual Exclusion via Redlock ([`distributedLock.service.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/services/distributedLock.service.ts))
- When multiple pods manage collaborating users in the same workspace, concurrent debounce flushes could execute simultaneous `UPDATE files SET content = ...` queries, causing write skew or deadlocks.
- Before committing to PostgreSQL, the pod acquires a distributed lock:
  ```lua
  -- Atomic acquire: SET file_lock:<fileId> <podId> NX PX 5000
  -- Atomic release via Lua EVALSHA:
  if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
  else
      return 0
  end
  ```
- Guarantees exactly-one-writer semantics across the entire cluster.

---

### Subsystem 3: Container Sandboxing, Multi-User PTY Isolation & Hibernation

#### 1. 1 Shared Container per Workspace vs. 1 Container per User
- **Naive Approach (Per-User Containers):** If 5 developers collaborate on the same project, spinning up 5 separate containers consumes 5GB+ host RAM and creates divergent local filesystems.
- **NexusIDE Architecture (Shared Container per Workspace):** Collaborating users share **1 isolated Docker container** bound to the workspace directory (`/workspaces/${workspaceId}`).
  - Cuts host memory consumption by **80–90%**.
  - Provides a single, unified filesystem view so compiler builds and file modifications are immediately visible to all collaborators.

#### 2. Multi-User PTY Session Isolation ([`terminalHandler.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/terminal/terminalHandler.ts))
- Even though the container is shared, users cannot share the same terminal screen (one user typing `git commit` would collide with another user running `npm run dev`).
- **Mechanism:** Each user's WebSocket connection triggers an independent `container.exec()` call, allocating a dedicated Unix pseudo-terminal (`/dev/pts/X`):
  ```typescript
  const exec = await container.exec({
     Cmd: ['/bin/bash'],
     AttachStdin: true,
     AttachStdout: true,
     AttachStderr: true,
     Tty: true,
     Env: [
        `USER=${username}`,
        `GIT_AUTHOR_NAME=${username}`,
        `GIT_COMMITTER_NAME=${username}`,
        `HISTFILE=/workspaces/${workspaceId}/.bash_history_${userId}`
     ]
  });
  ```
- **Result:** Each collaborator has their own private shell session, command history, and Git attribution, while operating on the same shared project files.

#### 3. Pre-Warmed Container Pool (`WarmPoolManager` in [`pool.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/sandbox/pool.ts))
- Spinning up a cold Docker container (`docker run`), configuring network bridges, and mounting cgroups takes **3.2 to 4.5 seconds**.
- A background manager maintains a standing queue of 2 to 5 pre-booted, idle Alpine Linux containers in RAM.
- When a user opens a workspace, `popTerminalContainer()` claims an existing container, binds the workspace directory, and returns in **< 50 milliseconds**. The pool asynchronously replenishes in the background.

#### 4. Container Hibernation via cgroups v2 Freezer ([`workspaceContainer.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/sandbox/workspaceContainer.ts))
- When all collaborators disconnect or close their tabs, an inactivity countdown begins (5-minute grace period).
- If no reconnection occurs, rather than destroying the container and killing running background tasks (e.g. dev servers), the system invokes: `container.pause()`.
- **Mechanism:** Leverages the Linux kernel `cgroup v2` freezer subsystem. All processes inside the container are frozen in place: CPU usage drops to **0%**, while RAM state, open socket file descriptors, running processes, and unsaved shell variables remain perfectly intact.
- Upon user return, `container.unpause()` unfreezes the container instantly (<20ms).

#### 5. cgroup Security Resource Caps
- Containers are strictly constrained to prevent noisy neighbor starvation and fork bombs:
  - `Memory: 1073741824` (1GB RAM hard cap; kernel OOM killer isolates crashes to the container).
  - `CpuQuota: 150000` with `CpuPeriod: 100000` (1.5 CPU core ceiling).
  - `PidsLimit: 500` (Prevents fork bombs like `:(){ :|:& };:` from freezing the host OS).
  - Non-root user execution inside the sandbox.

---

### Subsystem 4: Git-Style Merkle DAG Content-Addressable Storage (CAS)

#### 1. Why Merkle DAGs over Flat File Snapshots?
- In a naive system, saving a workspace snapshot copies every file in full (`workspace_snapshots` + `snapshot_files`). Across 100 snapshots of a 20MB project, the database bloats by 2GB, even if only one line changed between checkpoints.
- NexusIDE implements a 3-layer Content-Addressable Storage (CAS) Merkle DAG modeled directly on Git internals ([`cas.service.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/services/cas.service.ts) and [`database/schema.sql`](file:///Users/amankashyap/Documents/nexusIDE/database/schema.sql)):
  1. **`git_blobs`:** Content-addressed raw file data. The primary key is the cryptographic SHA-256 hash of the content:
     ```sql
     CREATE TABLE git_blobs (
         hash VARCHAR(64) PRIMARY KEY, -- SHA-256 hex digest
         content TEXT NOT NULL,
         size_bytes BIGINT NOT NULL
     );
     ```
     Inserting uses `ON CONFLICT (hash) DO NOTHING`. If 50 workspaces or snapshots share the identical `package.json`, it is stored in PostgreSQL exactly **once**.
  2. **`git_trees`:** Content-addressed directory nodes. `entries` contains a canonical, deterministically sorted JSON array of `{ name, type, hash, path }`. The tree hash is the SHA-256 of this canonical JSON string. If an entire sub-folder is unchanged, its tree hash is identical, enabling instant $O(1)$ equality checks.
  3. **`git_commits`:** Immutable checkpoint records linking `workspace_id`, `root_tree_hash`, and `parent_commit_id`.
- **Result:** Yields a measured **92% reduction** in snapshot database disk consumption.

#### 2. CPU Offloading via Node.js `worker_threads` ([`workerPool.service.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/services/workerPool.service.ts))
- Calculating SHA-256 hashes and sorting canonical trees across hundreds of files is CPU-intensive. Running this synchronously on Node.js's main thread blocks the event loop for 120ms+, causing dropped WebSocket frames and terminal lag.
- The computation is dispatched to a dedicated worker thread pool (`casWorker.js`).
- The main thread event loop delay remains bounded under **< 0.8 milliseconds** under full snapshot workloads.

---

### Subsystem 5: Full-Fidelity Timelapse Replayer

#### 1. Reconstructing History without Huge Memory Footprints
- The timelapse engine enables users to scrub back and forth through a document's history per keystroke with author attribution.
- **Naive Approach (Pre-computing all frames):** Reconstructing and holding 5,000 full-string snapshots in browser memory consumes ~250MB+ of RAM, causing garbage collection pauses and mobile browser crashes.
- **NexusIDE Sparse Keyframe Architecture ($K=25$):**
  - Incremental binary Yjs updates are logged chronologically in PostgreSQL: `file_updates(file_id, seq, update BYTEA)`.
  - The replayer initializes a headless `Y.Doc` with **Garbage Collection disabled (`gc: false`)** so tombstones are preserved for author attribution.
  - The client pre-computes only **1 keyframe every 25 edits** ($K=25$).
  - When the user scrubs to edit #437, the engine jumps to keyframe #425 in $O(1)$ and replays just 12 micro-updates forward.
- **Result:** Keeps browser memory strictly under **< 12 MB RAM**, while delivering **60 FPS** scrubbing and sub-2ms seek latency.

---

### Subsystem 6: Frontend IDE & Rendering Performance

#### 1. Monaco Editor Native `deltaDecorations`
- Rendering collaborator cursors, selection highlights, and name badges using standard React state triggers full React component tree re-evaluations, causing typing jitter.
- NexusIDE mounts remote cursor widgets directly onto Monaco Editor's native glyph and decoration tree using `editor.deltaDecorations()`.
- Updates are wrapped in `requestAnimationFrame` coalescing, executing directly on the browser's paint pipeline at 60 FPS without touching React state.

#### 2. Vite Rollup Code-Splitting & Vendor Chunking
- Naive Vite bundling produced a monolithic `index.js` exceeding **4.68 MB**, causing 3+ second browser parse times on 3G connections.
- In `frontend/vite.config.ts`, Rollup `manualChunks` partitions third-party dependencies into independent cached vendor bundles:
  - `monaco-vendor`: Monaco Editor core and language grammar workers.
  - `react-vendor`: React 18, React DOM, Lucide icons.
  - `yjs-vendor`: Yjs, y-protocols, lib0 binary decoders.
- **Result:** Main application bundle sliced from **4.68 MB down to 609 KB**, enabling long-term HTTP 304 browser caching.

---

## 4. Key Metrics Cheat Sheet (The Numbers to Cite in Interviews)

| Subsystem / Feature | Metric / Benchmark | Operational Value |
| :--- | :--- | :--- |
| **Container Provisioning** | **3.2s $\rightarrow$ < 50ms** | Pre-warmed container pool eliminates `docker run` cold start. |
| **Frontend Bundle Size** | **4.68MB $\rightarrow$ 609KB** | Vite Rollup manual vendor chunking. |
| **Database Write IOPS** | **95% Reduction** | Adaptive velocity debouncing + Redis write-behind buffer. |
| **Snapshot Disk Usage** | **92% Storage Savings** | CAS Merkle DAG SHA-256 deduplication (`git_blobs`). |
| **Main Event Loop Lag** | **< 0.8ms (p99)** | CPU hashing and CRDT compaction offloaded to `worker_threads`. |
| **Timelapse Memory Cap** | **< 12MB RAM** | Sparse keyframe caching ($K=25$) for 5,000+ edit histories. |
| **Container Resource Caps** | **1GB RAM / 1.5 CPU / 500 PIDs** | Linux cgroups v2 ceiling preventing host OOM and fork bombs. |
| **WebSocket Backpressure** | **1MB Soft / 5MB Hard** | Drops awareness frames at 1MB; terminates choked sockets at 5MB. |
| **Container Hibernation** | **0% CPU / 0% RAM active** | `cgroup v2` freezer (`container.pause()`) preserves running bash processes. |

---

## 5. Ownership, Honesty & Real Bugs Diagnosed (Microsoft Prep)

### 1. Code Ownership Breakdown
- **What I Architected & Wrote Directly:**
  - The distributed Redis Pub/Sub mesh with `'redis'` origin loop-breaking in [`redisAdapter.service.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/services/redisAdapter.service.ts).
  - The multi-user PTY terminal isolation architecture and Docker container lifecycle manager in [`pool.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/sandbox/pool.ts) and [`workspaceContainer.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/sandbox/workspaceContainer.ts).
  - The Git-style Merkle DAG Content-Addressable Storage schema and engine in [`cas.service.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/services/cas.service.ts) and [`database/schema.sql`](file:///Users/amankashyap/Documents/nexusIDE/database/schema.sql).
  - The sparse keyframe algorithm for the timelapse engine in [`TimelapseReplayer.tsx`](file:///Users/amankashyap/Documents/nexusIDE/frontend/src/components/Editor/TimelapseReplayer.tsx).
  - The adaptive persistence debouncer and Redlock integration in [`adaptiveDebouncer.service.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/services/adaptiveDebouncer.service.ts).
- **What AI Assistance Accelerated:**
  - Standard Express route bindings, boilerplate TypeScript interfaces, initial React Tailwind UI mockups, and Dockerfile installation commands for Python/Node/Go runtimes.

### 2. Deep Bugs Personally Diagnosed & Fixed
1. **The Shared Node.js Buffer Pool Corruption:**
   - *Symptom:* Random byte corruption in Yjs state vectors when receiving Redis Pub/Sub messages across pods.
   - *Root Cause:* Passing a sliced Node.js `Buffer` directly to `new Uint8Array(buf)` ignores `buf.byteOffset`. Small buffers share an 8KB internal V8 memory pool; reading from byte 0 parsed garbage from adjacent allocations.
   - *Fix:* Explicitly passed `new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)` across all binary decoders.
2. **The Redis Pub/Sub Re-Broadcast Message Storm:**
   - *Symptom:* Typing a single character caused CPU on all backend pods to spike to 100% with thousands of duplicate messages.
   - *Root Cause:* When Pod 2 received an update from Redis, it applied it to `WSSharedDoc`, which fired its local `onUpdate` listener, causing Pod 2 to re-publish the exact same update back to Redis, creating an infinite network loop.
   - *Fix:* Added an explicit `'redis'` origin tag to updates applied from Redis, and added a guard `if (origin !== 'redis')` before publishing.
3. **Monaco Double-Binding Cursor Jitter:**
   - *Symptom:* Switching active file tabs caused remote collaborator cursors to duplicate or flicker erratically.
   - *Root Cause:* The previous `Y.Doc` and `MonacoBinding` instances were not cleanly unmounted before mounting the new model, leaving stale decoration listeners attached to the editor.
   - *Fix:* Implemented an explicit LRU model cache with a deterministic `destroy()` lifecycle on tab unmount.

---

## 6. Architectural Trade-Offs & Production Scaling (Azure / Enterprise Reality)

| Current Architecture Decision | Why It Was Chosen for This Project | Production Limitation (What Breaks at Scale) | Enterprise Evolution (Microsoft / Azure Scale) |
| :--- | :--- | :--- | :--- |
| **Docker Socket Mount (`/var/run/docker.sock`)** | Instant PTY stream hijacking, low complexity on single-node VM. | Root-level host security compromise if container breakout occurs. | **MicroVMs (AWS Firecracker or Azure Kata Containers)** with dedicated guest Linux kernels. |
| **1 Shared Container per Workspace** | Slashes host RAM consumption by 90%; instant shared filesystem view. | Parallel commands from different users can race on filesystem writes. | **Per-user Copy-on-Write overlayfs** branches merged via automated Git cherry-picks. |
| **Single-Node Redis 7 Instance** | Zero configuration; fast in-memory Pub/Sub and caching on 1 VM. | Single point of failure; loss of Redis drops active awareness and queue state. | **Redis Sentinel / Redis Cluster** with multi-zone replication and auto-failover. |
| **Direct Local Disk Workspaces (`/workspace_data`)** | Ultra-fast local NVMe disk access; zero network storage latency. | Binds workspace to a single physical VM node; cannot migrate pods across nodes. | **Distributed Block Storage (Ceph, AWS EBS, or Azure Managed Disks)** mounted via CSI. |

---

## 7. Master Repository Navigation

- **Backend Core Entry:** [`backend/src/server.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/server.ts)
- **CRDT Sync Engine:** [`backend/src/services/yjsSyncEngine.service.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/services/yjsSyncEngine.service.ts)
- **Redis Pub/Sub Mesh:** [`backend/src/services/redisAdapter.service.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/services/redisAdapter.service.ts)
- **Distributed Redlock:** [`backend/src/services/distributedLock.service.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/services/distributedLock.service.ts)
- **Container Pre-Warming Pool:** [`backend/src/sandbox/pool.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/sandbox/pool.ts)
- **Container Lifecycle & Hibernation:** [`backend/src/sandbox/workspaceContainer.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/sandbox/workspaceContainer.ts)
- **CAS Merkle DAG Engine:** [`backend/src/services/cas.service.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/services/cas.service.ts)
- **Worker Threads Compute Offloader:** [`backend/src/services/workerPool.service.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/services/workerPool.service.ts) & [`backend/src/workers/casWorker.js`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/workers/casWorker.js)
- **Database Schema:** [`database/schema.sql`](file:///Users/amankashyap/Documents/nexusIDE/database/schema.sql)
- **Frontend Code Editor Hook:** [`frontend/src/hooks/useCodeEditorSetup.ts`](file:///Users/amankashyap/Documents/nexusIDE/frontend/src/hooks/useCodeEditorSetup.ts)
- **Timelapse Replayer Component:** [`frontend/src/components/Editor/TimelapseReplayer.tsx`](file:///Users/amankashyap/Documents/nexusIDE/frontend/src/components/Editor/TimelapseReplayer.tsx)
- **Vite Rollup Chunking Config:** [`frontend/vite.config.ts`](file:///Users/amankashyap/Documents/nexusIDE/frontend/vite.config.ts)
- **Master Test Suite Runner:** [`test.sh`](file:///Users/amankashyap/Documents/nexusIDE/test.sh)\n