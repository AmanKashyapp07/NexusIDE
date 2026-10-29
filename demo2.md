# NexusIDE & MagnusCI — VISA Interview Guide

**Candidate:** Aman Kashyap · IIIT Allahabad (IT, 2024–2028) · [GitHub Profile](https://github.com/AmanKashyapp07)  
**Target Role:** VISA Software Engineering Internship  
**Core Competencies:** Distributed Systems Concurrency, Eventual Consistency vs. ACID Durability, Linux Systems Programming (Docker/PTY/cgroups), Algorithmic Rigor (LeetCode Knight, 700+ solved).

---

## Quick Reference Card

| Item | Value |
|---|---|
| **Local Startup** | `bash dev.sh --skip-deps` *(or `npm run dev:quick`)* |
| **Local Application URL** | `http://localhost:5173/ide` |
| **Window 1 (Main)** | Chrome standard window -> User: `demo` / Pass: `test` |
| **Window 2 (Collaborator)** | Incognito side-by-side -> User: `collab` / Pass: `test` |
| **Live Cloud Backup** | `http://129.154.39.198/ide/login` *(Oracle Cloud VM)* |
| **Static Portfolio Showcase** | `https://amankashyapp07.github.io/NexusIDE/` |

---

## 1. Interview Strategy & Framing for VISA

In enterprise fintech interviews (like VISA), projects typically receive **8–12 minutes** of discussion before transitioning into Data Structures & Algorithms and Core CS fundamentals (Operating Systems, DBMS, Computer Networks).

**Guiding Principles:**
1. **Show, Don't Tell:** Let the live behavior prove the implementation in under 3 minutes.
2. **Bridge to Systems Fundamentals:** Connect every feature to a fundamental computer science concept (concurrency, idempotency, transaction isolation, backpressure).
3. **Architectural Rigor:** Explicitly decouple in-memory convergence from database durability; distinguish process sandboxing from hardware virtualization.

---

## 2. 30-Second Opening Pitch

> "I built NexusIDE, a collaborative cloud development environment in the browser. It combines real-time multi-user editing, an interactive Linux terminal, and workspace-level access control.  
> The core engineering focus was handling high-frequency distributed state: merging concurrent edits commutatively using Yjs CRDTs over WebSockets without central locks, protecting PostgreSQL from write saturation via an adaptive velocity debouncer, and streaming interactive PTY sessions into containerized sandboxes governed by Linux cgroups v2.  
> I can give a quick 2-minute workflow demo, or dive straight into the concurrency and storage architecture."

---

## 3. 3-Minute Live Demo Script

Arrange two browser windows side-by-side before the call begins:
- **Left Window:** Primary session (`demo`) with Monaco Editor and active file.
- **Right Window:** Collaborator session (`collab`) viewing the same workspace and file.

### Step 1: Editor & Worker Offloading (0:00–0:30)
- Log in and open the workspace. Point out Monaco Editor and the file tree.
- **Talking Point:** *"Monaco is bound to dedicated client-side Web Workers for TypeScript, JSON, and CSS processing off the main UI thread, ensuring heavy AST parsing never blocks our real-time WebSocket event loop."*

### Step 2: Real-Time Concurrency (0:30–1:30)
- Type in Window 1 (`// hello visa`). Point out the characters and colored cursor presence updating in Window 2. Type concurrently in both windows.
- **Talking Point:** *"Edits merge commutatively using Yjs CRDTs over WebSockets. There is no central lock; every replica mathematically converges to the same state vector. Cursor awareness is stream-packed into custom 8-byte binary frames rather than verbose JSON to minimize network bandwidth."*

### Step 3: Sandboxed Terminal Execution (1:30–2:15)
- Click into the terminal panel. Run `pwd`, `node -v`, or `python3 -c "print('VISA Demo Ready!')"`.
- **Talking Point:** *"Each workspace connects to an isolated Alpine Linux Docker container via a raw WebSocket-to-PTY bridge (/dev/pts). Resource quotas are enforced using Linux cgroups v2."*

### Step 4: Persistence Lifecycle (2:15–2:45)
- Make a quick edit, pause 1 second, and hard-refresh (`Cmd+Shift+R`). The file reloads with the edit preserved.
- **Talking Point:** *"Edits are debounced dynamically based on typing velocity and flushed to PostgreSQL as a binary state vector BYTEA column, slashing transactional database write IOPS by ~75%."*

### Step 5: Transition to Technical Discussion (2:45–3:00)
- **Talking Point:** *"That covers the primary loop: browser Monaco editing, CRDT convergence, containerized execution, and debounced relational persistence. I’d be happy to open the code or discuss the distributed state trade-offs."*

---

## 4. 25 Hot Technical Questions on NexusIDE (Resume Deep-Dive)

These 25 questions are derived directly from the NexusIDE bullet points on your resume:

### Group 1: Collaborative Editing & CRDTs (Resume Bullet 1)

#### Q1: Why did you choose Conflict-Free Replicated Data Types (CRDTs) over Operational Transformation (OT)?
**Answer:** Operational Transformation (used in Google Docs) requires a centralized server to serialize and transform concurrent operations before broadcasting. This creates a central bottleneck and single point of failure that prevents horizontal scaling. CRDTs (specifically the YATA algorithm in Yjs) are mathematically commutative and associative: operations can arrive in different orders across replicas and guarantee convergence without central coordination. The trade-off is metadata overhead: CRDTs retain character identity and tombstone history in memory, whereas OT operates on plain string offsets.

#### Q2: How does Yjs resolve concurrent character insertions at the exact same cursor position without central arbitration?
**Answer:** Every character in Yjs is assigned an immutable ID consisting of a unique client ID and a sequentially incrementing clock: `(client, clock)`. Each character also references its left and right origin neighbours. When two users insert at the exact same location, Yjs uses the YATA algorithm to break ties deterministically by comparing client IDs: the character with the higher client ID is consistently placed to the left (or right). Because all replicas execute this deterministic comparison, document convergence is mathematically guaranteed without server arbitration.

#### Q3: What is a CRDT state vector, and how does delta synchronization work over WebSockets?
**Answer:** A state vector is a compact dictionary mapping each known client ID to the highest clock integer received from that client (e.g., `{ clientA: 45, clientB: 120 }`). During the two-step WebSocket handshake, the connecting client sends its local state vector. The server computes the missing diff by selecting only operations with clocks greater than what the client has observed. The server encodes this delta into a compressed binary Uint8Array using lib0 encoding, minimizing network transfer during initial document sync.

#### Q4: Does CRDT convergence guarantee database durability? How do you bridge in-memory convergence and disk persistence?
**Answer:** No. CRDT convergence is strictly an in-memory consistency guarantee across active replicas. Durability is decoupled from real-time replication. In NexusIDE, document updates merge in memory within `WSSharedDoc`. To make edits durable without issuing synchronous database writes on every keystroke, we use an `AdaptivePersistenceDebouncer` that measures typing velocity in a 1-second sliding window and commits the binary Yjs state vector (`BYTEA`) into PostgreSQL atomically via a named prepared statement.

#### Q5: Why did you set `gc: false` (garbage collection disabled) in Yjs, and what are the memory implications of keeping tombstones?
**Answer:** In default Yjs, deleted characters are garbage-collected into count summaries. Setting `gc: false` retains deleted character nodes in the struct store as tombstones with their original author ID and clock. This enables git-blame style historical attribution and keystroke timelapse replay, because we can step backward through the edit tree without losing character ancestry. The trade-off is higher RAM consumption, as deleted characters remain in memory until the document is closed and compacted.

#### Q6: How does NexusIDE handle offline editing when a disconnected client reconnects with hundreds of local edits?
**Answer:** When offline, the client continues inserting edits into its local Yjs document (`Y.Doc`). When connectivity resumes, the client transmits its local state vector to the server. Yjs computes an incremental binary update containing all offline mutations. The server integrates this binary delta into the master `WSSharedDoc` using `Y.applyUpdate()`, merges any concurrent edits that occurred while the client was disconnected, and fans out the combined state back to the client and peer pods.

---

### Group 2: Multi-Instance Scaling, Redis & Distributed State (Resume Bullet 1)

#### Q7: How does Redis Pub/Sub distribute editing updates across backend instances, and how do you prevent broadcast echo loops?
**Answer:** When a client edits a document, the handling server pod updates its local `WSSharedDoc` and publishes the binary delta to Redis channel `yjs:update:{docName}`. All connected pods subscribe to `yjs:update:*`. When a peer pod receives a message from Redis, it applies it to its local document with an explicit origin tag `'redis'`. The local document update listener explicitly checks `if (origin !== 'redis') publish()`. This origin check breaks the cycle and prevents recursive re-publication.

#### Q8: What happens if Redis crashes or suffers a network partition? Does collaboration break?
**Answer:** Collaboration degrades gracefully rather than failing completely. Clients connected to the same Node.js pod continue collaborating without interruption, as in-memory CRDT replication does not depend on Redis. Cross-pod replication pauses until Redis reconnects. For persistence, if Redis is down, document loading falls back directly to PostgreSQL `files.yjs_state`, and distributed locks fall back to in-process mutexes.

#### Q9: How does distributed locking (Redlock) protect persistence when multiple pods handle the same workspace?
**Answer:** In a clustered deployment, multiple pods could trigger persistence flushes for the same file simultaneously. We use a Redlock-style Redis mutex (`distributedLock.service.ts`): the acquiring pod executes `SET lock:file:{fileId} {podId} PX 8000 NX`. Only the pod that successfully acquires the key can flush to PostgreSQL. To release safely, we run a Lua script verifying that the key value matches `podId` before deleting, preventing a slow pod from deleting a lock acquired by a newer pod after TTL expiration.

#### Q10: Why did you design an 8-byte binary cursor codec instead of using standard JSON for mouse presence?
**Answer:** JSON cursor payloads (`{"userId":"abc-123","line":42,"col":15,"sel":0}`) consume ~250 bytes per mouse movement. With 10 active collaborators, continuous 60fps cursor streaming generates significant bandwidth and JSON serialization overhead. Our codec packs coordinates into an exact 8-byte buffer using `DataView`: `[uint16 userHash, uint16 line, uint16 col, uint16 selectionLength]`. This delivers an O(1) encode/decode with a 96.8% payload size reduction, eliminating JSON parsing on high-frequency awareness channels.

#### Q11: Why not store documents directly in Redis instead of PostgreSQL?
**Answer:** Redis is an in-memory data store with asynchronous snapshotting (RDB) and append-only logging (AOF), prioritizing low latency over relational constraints and complex queries. PostgreSQL provides strict ACID transactions, complex foreign key constraints (cascading workspace deletions to collaborators, files, and snapshots), and efficient B-tree index-only scans for authorization. Redis is used as an L2 cache and coordination bus, while PostgreSQL remains the authoritative system of record.

---

### Group 3: Docker Engine API, Container Pooling & Linux cgroups v2 (Resume Bullet 2)

#### Q12: How does the container pre-warming daemon reduce cold-start latency from ~3.5s to sub-100ms?
**Answer:** Booting an Alpine Linux Docker container with runtime dependencies, compilers, and volume binds takes approximately 3.5 seconds. `WarmPoolManager` runs a background lifecycle loop that maintains a pool of pre-booted idle containers running `sleep infinity`. When a user opens a workspace, a container is popped from the queue in O(1) (<100ms) and assigned to the workspace directory. The pool manager then asynchronously replenishes the warm pool in the background without blocking the user thread.

#### Q13: Why did you choose 1 shared container per workspace instead of 1 container per user? What are the trade-offs?
**Answer:** The decision prioritizes resource efficiency and developer collaboration. In a collaborative project, teammates need to inspect the same filesystem, share installed packages (such as `node_modules`), run shared dev servers, and observe build artifacts. Provisioning 1 container per user would require separate container filesystems and consume 1GB+ RAM per person. One shared container per workspace reduces host memory by ~90%, while isolating user input by granting each collaborator a private interactive PTY session (`/dev/pts`) inside that container.

#### Q14: What specific Linux cgroups v2 controllers are configured, and what happens when a container exceeds its memory limit?
**Answer:** We configure three primary cgroup v2 controllers via the Docker Engine API: `NanoCpus: 1_500_000_000` (caps CPU execution to 1.5 cores), `Memory: 1024 * 1024 * 1024` (1GB hard memory ceiling), and `PidsLimit: 500` (prevents fork bombs from exhausting OS process tables). If a process inside the container allocates memory beyond 1GB, the Linux kernel Out-Of-Memory (OOM) killer terminates the offending process rather than crashing the host server or affecting other workspace containers.

#### Q15: Can a user escape the Docker container and compromise the host system? What are the security boundaries?
**Answer:** Docker containers share the host Linux kernel, so cgroups and namespaces provide process isolation and resource governance, but do not represent a hardware cryptographic boundary against kernel privilege escalation exploits. To harden the sandbox, containers run without `--privileged` flags, employ restricted bash shells (`/bin/bash --restricted`) for Viewer roles with a stripped `/viewer_bin` PATH, and mount temporary directories as `tmpfs`. For production environments executing untrusted multi-tenant code, hardware-isolated microVMs (such as AWS Firecracker or gVisor) would be required.

#### Q16: How do you manage container lifecycle and prevent orphaned container leaks when users close their browser tabs?
**Answer:** We use reference-counted container management (`workspaceContainer.ts`). When a user attaches a terminal or language server, `refCount` increments. When all WebSockets disconnect, `refCount` drops to 0 and a 5-minute delayed teardown timer starts. If the user refreshes their browser or reconnects within 5 minutes, the timer cancels and the container is reused. If the timer expires without reconnections, the container is stopped and removed, preventing idle container accumulation.

---

### Group 4: Merkle DAG, CAS & SHA-256 Deduplication (Resume Bullet 3)

#### Q17: How does your Merkle DAG model files, directories, and snapshots? How does it mirror Git's object model?
**Answer:** The snapshot engine uses a 3-tier directed acyclic graph:
1. `git_blobs`: Raw file contents keyed by their SHA-256 hex digest.
2. `git_trees`: Directory nodes containing a canonical JSON array of entry tuples `(name, type, hash, path)`. The tree hash is the SHA-256 digest of this canonical JSON string.
3. `git_commits`: Snapshot records containing `workspace_id`, `root_tree_hash`, commit message, and a `parent_commit_id` pointing to the previous snapshot, forming a singly-linked commit history.

#### Q18: How does Content-Addressable Storage (CAS) achieve deduplication across multiple snapshots and workspaces?
**Answer:** When creating a snapshot, every file is hashed via SHA-256 before inserting. We execute `INSERT INTO git_blobs (hash, content, size_bytes) VALUES (...) ON CONFLICT (hash) DO NOTHING`. If a 100MB file or common library exists in 50 snapshots across different workspaces, it is stored exactly once in PostgreSQL. Commits merely reference the existing hash, transforming storage scaling from quadratic O(N x S) to incremental O(delta).

#### Q19: How do you guarantee identical directory trees produce identical SHA-256 tree hashes regardless of insertion order?
**Answer:** We enforce deterministic canonical sorting in `cas.service.ts`. Tree entries are sorted alphabetically by `name`, with ties broken by relative `path`. Because serialization to JSON occurs after sorting, identical directory contents always generate the exact same byte string and identical SHA-256 tree hash, independent of database row retrieval order or filesystem iteration order.

#### Q20: How does the CAS garbage collector distinguish live blobs from orphaned blobs without blocking active snapshots?
**Answer:** The garbage collector (`casGarbageCollector.service.ts`) executes a two-phase mark-and-sweep routine. In the mark phase, it traverses all `root_tree_hash` references in `git_commits` down through `git_trees` to identify all referenced blob hashes and writes them into a temporary table. In the sweep phase, it identifies blobs not present in the reference table that were created before a safety grace period (e.g. 1 hour). The grace period ensures in-flight snapshot insertions are not deleted mid-transaction.

#### Q21: How does the Merkle DAG structure enable fast O(1) diffing between two snapshots?
**Answer:** In a flat storage model, computing differences between two revisions requires comparing every file path and content. In a Merkle DAG, if two directory trees or subtrees have identical SHA-256 hashes, their contents are cryptographically guaranteed to be identical. The diff algorithm compares root tree hashes: if equal, zero files changed in O(1). If hashes differ, it descends only into child entries whose hashes do not match, skipping unchanged subtrees entirely.

---

### Group 5: PTY Pipeline, WebSockets & Security Boundaries (Resume Bullet 4)

#### Q22: What is the difference between a Linux PTY (pseudo-terminal) and a standard OS pipe or subprocess stream?
**Answer:** A standard OS pipe (`pipe()`) is an anonymous unidirectional byte stream with no terminal semantics: programs buffering output do not flush immediately, and interactive features like tab completion, cursor positioning, and password masking fail. A PTY (`/dev/ptmx` and `/dev/pts/N`) emulates hardware terminal lines. It provides a terminal line discipline that handles keyboard interrupt signals (`Ctrl+C` SIGINT, `Ctrl+Z` SIGTSTP), terminal window resizing (`SIGWINCH`), and raw unbuffered character delivery required by shells like `bash` and interactive tools like `vim` or `top`.

#### Q23: How does the streaming pipeline handle terminal backpressure when a command outputs megabytes of text?
**Answer:** If a user runs `cat 100mb.log`, the container emits data faster than the client's browser WebSocket can consume. If unthrottled, Node.js memory bloats and stalls the event loop. In `terminalStreamBuffer.ts`, we chunk container output into 4KB frame buffers and inspect the WebSocket `bufferedAmount`. When buffered data exceeds 1MB, writes pause until the client TCP buffer drains; if it breaches a 5MB critical threshold, the socket terminates to protect server memory.

#### Q24: How do you enforce role-based access control (RBAC) in the terminal (Viewer vs. Editor vs. Admin)?
**Answer:** Role enforcement occurs during the WebSocket HTTP upgrade handshake in `terminalHandler.ts`. The user's role is queried via the `idx_collab_auth` covering index. If the user is a `viewer`, the backend rejects write access or spawns `/bin/bash --restricted` with a stripped `PATH` pointing to `/viewer_bin` containing only read-only utilities (`ls`, `cat`, `echo`, `pwd`), preventing write commands or arbitrary script execution. Editors and Admins receive standard interactive shell sessions.

#### Q25: Why raw WebSockets (`ws`) for Yjs and terminal streams instead of Socket.IO or HTTP/2 Server-Sent Events (SSE)?
**Answer:** Socket.IO introduces packet wrapping, event multiplexing headers, and JSON stringification overhead that interferes with raw binary streams. Server-Sent Events (SSE) is strictly unidirectional (server-to-client) and requires separate HTTP POST requests for client-to-server typing, creating severe round-trip latency. Raw WebSockets (`ws`) provide full-duplex TCP framing with minimal 2-to-10 byte framing overhead, allowing direct binary passing of Yjs Uint8Array state vectors and raw PTY byte buffers with sub-millisecond latency.

---

## 5. Resume Deep-Dive: MagnusCI (Second Resume Project)

Interviewers frequently examine the second project on your resume:

- **Source Code & Architecture:** Containerized CI/CD Engine using TypeScript, Node.js, React, PostgreSQL, Redis, BullMQ, Docker, K3s.
- **Q: Why BullMQ + Redis instead of running builds synchronously?**  
  *A: GitHub webhooks require an HTTP 200 response within 10 seconds. Compiling code or running tests takes minutes. BullMQ offloads webhook payloads into a durable Redis queue, decoupling ingestion from execution and allowing worker concurrency limits to prevent host CPU saturation.*
- **Q: How does the DAG pipeline scheduler work?**  
  *A: CI pipelines define dependencies (for example, `test` depends on `build`). We model stages as a Directed Acyclic Graph (DAG). We use **DFS-based cycle detection** during validation to reject recursive pipeline definitions, and **Kahn’s Algorithm (in-degree tracking)** to schedule stages whose dependencies have completed.*
- **Q: How do you secure webhook endpoints?**  
  *A: We verify GitHub's `X-Hub-Signature-256` header using HMAC-SHA256 with the pre-shared secret: `crypto.createHmac('sha256', secret).update(rawBody).digest('hex')` and evaluate it using `crypto.timingSafeEqual` to prevent timing attacks.*

---

## 6. The 5 Core Systems Concepts for VISA

### 1. Persistence Debouncing vs. ACID Durability
- **Problem:** 10 collaborators typing at 10 chars/sec = 100 writes/sec, saturating PostgreSQL connections and WAL write volume.
- **Solution:** An adaptive debouncer (`adaptiveDebouncer.service.ts`) tracks typing velocity in a 1-second sliding window:
  - Idle pause -> **300ms** commit.
  - High typing burst -> scales up to **2,500ms**.
  - Hard ceiling -> forced commit at **5,000ms** during infinite typing.
- **Durability Trade-off:** A bounded 5-second crash window of transient edits held in memory before committing to PostgreSQL as an atomic `UPDATE` with a named prepared statement on `files.yjs_state`.

### 2. Distributed Locking with Redlock & Lua Scripts
- **Problem:** Multiple backend pods attempting to flush the same file's CRDT buffer simultaneously creates race conditions.
- **Solution:** Redlock distributed mutex (`distributedLock.service.ts`):
  ```lua
  -- Atomic acquire:
  SET lock:file:{fileId} {podId} PX 8000 NX
  -- Safe release: only delete if current pod is the owner
  if redis.call("get", KEYS[1]) == ARGV[1] then 
    return redis.call("del", KEYS[1]) 
  else 
    return 0 
  end
  ```
  Lease TTL of 8,000ms prevents deadlocks on pod crash. Gracefully falls back to an in-process mutex if Redis is unavailable.

### 3. PostgreSQL Covering Index (Index-Only Scan)
- **Problem:** Every API request and socket handshake requires verifying workspace membership and role.
- **Solution:**
  ```sql
  CREATE INDEX idx_collab_auth 
  ON workspace_collaborators (workspace_id, user_id) 
  INCLUDE (role);
  ```
  Because `role` is embedded directly into the B-tree leaf page, PostgreSQL answers authorization queries via an **Index-Only Scan**, satisfying the query directly from the buffer cache without visiting table heap pages.

### 4. Bit-Packed 8-Byte Binary Cursor Codec
- **Problem:** JSON cursor updates (`{"userId":"...","line":42,"col":15}`) consume ~250 bytes per move. High-frequency mouse movement saturates bandwidth.
- **Solution:** Bit-packed binary frame (`cursorCodec.service.ts`):
  ```text
  [uint16 userHash (2B) | uint16 line (2B) | uint16 col (2B) | uint16 selectionLength (2B)] = 8 bytes
  ```
  O(1) encode/decode via `DataView`. For an assumed 250-byte JSON representation, the raw payload size is reduced by **96.8%**.

### 5. Multi-Tier Fallback Resilience
- **If Redis crashes:**
  - Real-time editing continues seamlessly in single-node memory (`WSSharedDoc`).
  - Document loading falls back directly to PostgreSQL `files.yjs_state`.
  - Distributed locks fall back to local in-process mutexes.
  - Redis Pub/Sub cross-pod fanout degrades to single-node room broadcasting until reconnect.

---

## 7. Core CS Cross-Examination

| Subject | Project Feature | What VISA Will Ask | Direct Answer |
|---|---|---|---|
| **OS** | Linux cgroups v2 (`pool.ts`) | *What is the difference between a process limit and a container?* | *A container is not a distinct kernel entity; it is a standard Linux process isolated via namespaces (pid, mount, net) and throttled via cgroups v2 (`memory.max`, `cpu.max`, `pids.max`).* |
| **OS** | PTY Duplex Stream (`terminalHandler.ts`) | *What does a PTY provide that a regular pipe (`pipe()`) does not?* | *A pipe is a unidirectional byte stream with no terminal semantics. A PTY (`/dev/ptmx` and `/dev/pts/N`) emulates hardware terminal lines: it handles line editing, echoing, window resizing (`SIGWINCH`), and terminal control signals (`Ctrl+C` SIGINT, `Ctrl+Z` SIGTSTP).* |
| **DBMS** | Covering Index (`schema.sql`) | *When would an index-only scan fall back to a heap read?* | *If the page in the visibility map has not been marked all-visible (meaning recent un-vacuumed dead tuples exist), Postgres must visit the table heap to verify MVCC transaction visibility.* |
| **DBMS** | PostgreSQL Transactions | *How does PostgreSQL achieve ACID durability?* | *Via Write-Ahead Logging (WAL). PostgreSQL writes log records to disk before writing data pages to buffer pool cache, allowing crash recovery via WAL replay.* |
| **Networks** | WebSocket RFC 6455 | *Why WebSockets instead of HTTP/2 Server-Sent Events (SSE)?* | *SSE is unidirectional (server-to-client). Collaborative text and interactive terminal sessions require bidirectional, full-duplex, low-latency streaming with minimal framing overhead (2 to 10 bytes per frame).* |
| **Networks** | TCP Backpressure | *How do you prevent slow clients from consuming all server memory?* | *We inspect `ws.bufferedAmount`. When it exceeds 1MB, we drop non-essential awareness frames; if it exceeds 5MB, we disconnect the choked socket to reclaim memory.* |

---

## 8. Emergency Recovery Matrix

| Symptom | Calm Spoken Anchor | Terminal Fix |
|---|---|---|
| **Remote Cloud VM Down** | *"The cloud VM is restarting; let me spin up the identical local instance."* | `bash dev.sh --skip-deps` |
| **Port 4000 Conflict** | *"A stale process held port 4000; clearing it now."* | `lsof -ti:4000 \| xargs kill -9 && bash dev.sh --skip-deps` |
| **Terminal Sandbox Stalled** | *"The container pool is initializing; warm container ready in 2 seconds."* | Wait 3 seconds, click terminal tab again |
| **Collaborator Window Desynced** | *"Let me refresh the collaborator session to initiate a clean awareness handshake."* | Hard-refresh Incognito tab (`Cmd+Shift+R`) |
| **Frontend Blank** | *"Vite HMR reload; quick browser refresh."* | Hard-refresh (`Cmd+Shift+R`) |

---

## 9. 60-Second Closing Statement

> "The central engineering challenge in NexusIDE was balancing responsive real-time collaboration with systems correctness: using CRDTs so distributed edits merge deterministically without central bottlenecks, batching persistence to protect PostgreSQL, and using container PTY sandboxing to run untrusted code safely.  
> I’d be excited to dive deeper into any of these areas, or discuss algorithmic problem-solving and core systems design."

---

*Interview Playbook · Aman Kashyap · IIIT Allahabad · VISA Software Engineering Internship*
