# NexusIDE: Comprehensive Technical Interview Questions & Answers

This guide compiles 30 highly technical interview questions and answers mapping to the architecture, design choices, trade-offs, and failure modes of the NexusIDE platform. It is structured to help you navigate and defend your technical design in engineering interviews.

---

## Table of Contents
1. [Architecture & System Design (Q1–Q4)](#1-architecture--system-design-q1q4)
2. [Real-Time Collaboration & CRDTs (Q5–Q10)](#2-real-time-collaboration--crdts-q5q10)
3. [Container Isolation & Code Execution Sandbox (Q11–Q16)](#3-container-isolation--code-execution-sandbox-q11q16)
4. [Interactive Terminal & PTY Bridge (Q17–Q21)](#4-interactive-terminal--pty-bridge-q17q21)
5. [Voice Chat & WebRTC Mesh (Q22–Q24)](#5-voice-chat--webrtc-mesh-q22q24)
6. [Database Schema & Recursive Queries (Q25–Q27)](#6-database-schema--recursive-queries-q25q27)
7. [Deployment, Infrastructure & Reliability (Q28–Q30)](#7-deployment-infrastructure--reliability-q28q30)

---

## 1. Architecture & System Design (Q1–Q4)

### Q1: What is the overall architecture of NexusIDE, and how do components interact?
**Answer:** NexusIDE is built on a modular client-server architecture with stateful communication pipes:
1. **Frontend Client**: React and Monaco Editor capture user code edits and cursors. xterm.js renders the shell. WebRTC handles audio streams.
2. **Backend Server**: Express coordinates REST APIs for authentication and metadata. Standard WebSockets (`ws`) handle Yjs CRDT edits, interactive terminal streams, and LSP requests. Socket.IO routes signaling events (WebRTC, active-file presence, and directory refreshes).
3. **Sandbox Engine**: Docker Engine API (`dockerode`) isolates execution and terminal shells inside sandboxed container nodes.
4. **Relational Database**: PostgreSQL stores users, workspaces, directory node paths, binary CRDT updates (`yjs_state`), and execution telemetry.

---

### Q2: Why did you choose a monolithic Node.js backend over a microservices-based architecture?
**Answer:** A monolith was selected to reduce operational complexity and network latency in a real-time collaborative system:
* **Lower Latency**: Inter-service RPC calls (e.g., between an auth service, database service, and container coordinator) add latency. Keeping them in a single Node process allows direct, high-performance database pooling and memory operations.
* **Shared Socket Context**: The terminal relay, Yjs socket rooms, and Socket.IO voice signals run on a single HTTP port upgrade. In a microservices system, we would need to run a complex API gateway with WebSocket routing policies, distributed session stores, and Redis-backed message brokers.
* **Ease of Deployment**: The monolith runs simply under PM2 on a single VM, reducing the surface area of deployment, certificate management, and system routing.

---

### Q3: How would you scale the WebSocket-heavy backend horizontally?
**Answer:** Scaling standard WebSockets horizontally requires:
1. **Load Balancing with Session Sticky Sessions**: A load balancer (e.g., Nginx, HAProxy) must route clients to the same server node based on their `workspaceId`. Since Yjs documents are held in server memory for active merging, edits on a single file must route to the same host.
2. **Pub/Sub Broker**: A Redis adapter must bridge the Socket.IO signaling servers. When Peer A sends a signaling packet to Peer B, if Peer B is connected to a different server instance, the message is published to Redis and forwarded to the target instance.
3. **Distributed Lock/Consensus**: A coordinator (like Apache ZooKeeper or Redis Redlock) must manage workspace container ownership, ensuring that only one server instance provisions or controls a docker workspace container.

---

### Q4: How is authentication state managed across both HTTP REST APIs and WebSocket connections?
**Answer:** We enforce stateless token verification:
* **HTTP REST**: We use a standard JWT middleware. The client passes the token in the `Authorization: Bearer <token>` header. The backend validates the signature, extracts the user ID, and checks database RBAC permissions.
* **WebSockets (Yjs, LSP, Terminal)**: WebSockets do not support custom headers during the initial HTTP upgrade handshake. Instead, the client passes the token as a query parameter (e.g., `?token=JWT_VALUE`). The backend interceptor parses the URL, decodes the token, checks the user’s role in the DB, and accepts or drops the socket connection before finishing the upgrade handshake.

---

## 2. Real-Time Collaboration & CRDTs (Q5–Q10)

### Q5: Why did you choose Yjs (CRDTs) over Operational Transformation (OT) for editing?
**Answer:** OT requires a central, stateful server to sequence every edit, resolve conflicts, and transform offsets on the fly. This makes the server a major bottleneck and makes offline sync extremely difficult. 

Yjs uses Conflict-Free Replicated Data Types (CRDTs). Edits are treated as operations on a mathematical tree. The conflict-resolution math is performed locally by each client's CPU. The backend is a "dumb relay" that broadcasts binary update frames, allowing the platform to scale horizontally and support offline editing natively.

---

### Q6: How does the linked-list model inside Yjs resolve conflict ordering?
**Answer:** Yjs models text as a doubly-linked list of character items. Each item has a unique coordinate `{ clientId, clock }` and pointers to its left and right neighbors. 

If Client A inserts `X` and Client B inserts `Y` at the exact same insertion index concurrently:
1. Both operations refer to the same left neighbor.
2. When the concurrent updates arrive, the clients evaluate the conflicting insert items.
3. The merge algorithm resolves order deterministically by comparing the `clientId` value. The client with the higher numerical ID places its character first. Because the sorting logic is deterministic, all peers converge to the identical character order without server coordination.

---

### Q7: Explain the document duplication bug during rapid tab switching and how you fixed it.
**Answer:** 
* **The Bug**: `y-websocket` destroys a file document in memory when the last user disconnects to free up RAM. If a user switched tabs quickly, the server was slow to delete the document. The frontend local state immediately re-injected the file contents on mount, and the server merged its lingering document with this new copy, doubling the text.
* **The Fix**: We removed the client-side text cache injection. We bound a database persistence layer (`setPersistence`) to the backend. On connection, the server queries the database for the file's binary CRDT state (`yjs_state`), loads it into the `Y.Doc` *before* the client handshakes, and serves it as the absolute source of truth.

---

### Q8: How does Yjs manage memory footprint if a document has thousands of edits over time?
**Answer:** Yjs implements two main optimization techniques:
1. **Structuring/Item Splitting**: Consecutive character insertions by a single user are automatically squashed into a single `Item` block rather than separate character items.
2. **Garbage Collection (Tombstones)**: When a character is deleted, Yjs does not delete the item coordinate because neighbors reference it. Instead, it marks the item as deleted (a "Tombstone") and discards the text content, keeping only the minimal metadata pointers needed to link past and future edit vectors.

---

### Q9: Why debounce database updates for collaborative edits, and how is it implemented?
**Answer:** Writing to PostgreSQL on every single keypress would cause high write lock contention, degrade disk I/O, and crash under concurrent users. 

We implemented a **debouncing logic** inside `writeState`:
* When a socket client sends an edit update, Yjs updates the memory `Y.Doc`.
* The server schedules a database write to flush changes after 2000ms.
* If another edit occurs within that window, the timer resets. Once typing stops, the server compresses the document into a single binary update block using `Y.encodeStateAsUpdate(ydoc)` and updates the database row in a single transaction.

---

### Q10: How does Yjs reconcile offline changes once a client regains internet connection?
**Answer:** Reconnection uses Yjs's **State Vector Sync Protocol**:
1. Upon reconnection, the client computes its local `StateVector`—a summary map of `{ clientId: last_clock }`—and sends it.
2. The server compares this vector against its own.
3. The server computes a compressed binary delta containing only the operations (clock indexes) the client is missing.
4. The client applies the delta, merging its offline edits with remote updates. Yjs neighbor anchors resolve conflict offsets automatically.

---

## 3. Container Isolation & Code Execution Sandbox (Q11–Q16)

### Q11: Why did you isolate execution using Docker containers instead of direct host subprocesses?
**Answer:** Spawning host processes via `child_process.spawn` exposes the server to high security risks:
* **Host Takeover**: Users could run shell commands like `rm -rf /` or inspect secure backend environment variables (`.env`).
* **Resource Hijacking**: Infinite loops or memory allocations would exhaust host memory and CPU, crashing the server.
* **Network Exploits**: Arbitrary scripts could scan private network ports or exfiltrate codebase secrets.

Docker isolates these execution scopes into container namespaces (mount, network, PID, IPC) with strict hardware constraints.

---

### Q12: How does the sandbox prevent Fork-Bomb (`while(true) fork()`) resource attacks?
**Answer:** Fork-bombs exhaust the operating system's process table, freezing the kernel. We mitigate this using Linux kernel namespaces and cgroups:
* We pass `PidsLimit: 50` in the container's HostConfig settings.
* Once the container attempts to spawn more than 50 threads or child processes, the OS kernel rejects additional forks. The loop terminates without impacting the host machine.

---

### Q13: How is network exfiltration and host filesystem tampering blocked in sandboxes?
**Answer:** 
* **Network**: We set `NetworkMode: 'none'`. The container starts with no network interfaces mapped to the outer interface, disabling outbound requests.
* **Filesystem**: 
    1. The container runs with `ReadonlyRootfs: true`, locking system folders (like `/bin`, `/usr`) from modification.
    2. We provision temporary write spaces `/app` and `/tmp` using memory-backed `tmpfs` mounts capped at 10MB, which are discarded upon container teardown.

---

### Q14: Explain the in-memory tar directory hydration pipeline and why it outperforms bind mounts.
**Answer:** 
* **Bind Mounts**: Mounting host directories into containers is slow (adding up to 50ms on macOS virtual layers) and poses container-breakout security risks.
* **Piped Tar Hydration**: When a run is triggered, we fetch the workspace directories from PostgreSQL, pack them into a tarball in-memory using `tar-stream`, open one `docker exec` pipe running `tar -xf - -C /app` inside the container, and stream the tarball directly. This operates fully in RAM, avoids host disk writes, and initializes the environment in sub-10ms.

---

### Q15: Why implement a warm container pool instead of spawning containers on demand?
**Answer:** Spawning a Docker container from scratch introduces a cold-startup latency of 300ms to 1.5s (due to network routing initialization, filesystem mounts, and Docker API handshakes). This latency degrades user experience. 

We maintain a background **Warm Pool** of pre-initialized containers. When a run is triggered, we retrieve an active container from the pool (~0ms wait) and replenish the pool in the background, keeping execution latency low.

---

### Q16: How does the custom run config (`.nexusrun`/`nexus.config.json`) work?
**Answer:** Before executing code, the runner checks the hydrated directory for `.nexusrun` or `nexus.config.json`. If found:
1. It parses the JSON configuration to extract custom `build` and `run` command strings.
2. If `build` is defined, it runs the compilation step inside the container first. If the exit code is non-zero, it terminates execution and returns the compilation error logs.
3. If `run` is defined, it overrides the default runtime runner (e.g. `node code.js`) with the custom run wrapper (e.g. `sh -c "./build/main"`), preserving working directories.

---

## 4. Interactive Terminal & PTY Bridge (Q17–Q21)

### Q17: How does a Pseudo-Terminal (PTY) differ from a standard subprocess shell?
**Answer:** 
* **Standard Subprocess (`Tty: false`)**: Connects standard streams via raw pipe interfaces. Interactive features are disabled. Output is buffered, colors are stripped, arrow keys yield input garbage (e.g. `^[[A`), and screen utilities (`vim`) throw errors.
* **Pseudo-Terminal (PTY) (`Tty: true`)**: Docker allocates a pseudo-TTY device. The shell process detects a real terminal environment, enabling unbuffered streaming, escape codes for colors/cursors, raw key captures (like `Ctrl+C`), readline features, and terminal UI layouts.

---

### Q18: How do terminal keystrokes and shell outputs stream between xterm.js and the sandbox?
**Answer:** We establish a bidirectional raw WebSocket pipe:
1. In the browser, xterm.js captures keystrokes and sends raw character byte arrays over the WebSocket: `ws.send(bytes)`.
2. The Node.js server receives the socket frame and writes the bytes directly to the container PTY execution's standard input: `dockerStream.write(bytes)`.
3. The shell processes the input and emits output bytes (text, color escape codes).
4. The server receives the container stream chunks and forwards them directly to the client WebSocket: `ws.send(output_bytes)`.
5. xterm.js decodes the bytes and updates the screen grid.

---

### Q19: How are terminal sessions multiplexed, and how does the reconnection grace period work?
**Answer:** 
* **Multiplexing**: To prevent resource exhaustion, opening a workspace in multiple browser tabs shares the same underlying Docker container. The server keeps a connection reference count for the workspace.
* **Grace Period**: When the reference count drops to 0 (all tabs closed), instead of killing the container immediately, we start a **5-minute grace timer**. If the user reconnects within 5 minutes (e.g. page reload or socket glitch), the timer is canceled and the terminal session resumes without losing work.

---

### Q20: How are terminal columns and rows synchronized during layout resizing?
**Answer:** If the browser terminal layout grid doesn't match the PTY container grid, line wraps and screen editors (`vim`) render incorrectly.
We implement a resize synchronization routine:
1. The frontend `ResizeObserver` monitors the terminal container div.
2. On resize, the `FitAddon` calculates the new grid rows/columns and sends a JSON payload: `ws.send(JSON.stringify({ type: 'resize', rows, cols }))`.
3. The server catches this message, parses the values, and triggers the Docker API: `exec.resize({ h: rows, w: cols })`.
4. The container kernel updates the terminal PTY dimensions, and the shell reflows its output grid accordingly.

---

### Q21: How do you prevent orphaned container resources if a client closes their browser abruptly?
**Answer:** We enforce two levels of container cleanups:
1. **WebSocket Close Listener**: When the client WebSocket terminates, the server cleans up session handles, decrements reference counters, and triggers container removal if the reconnect grace period expires.
2. **Idle Timeout**: The server maintains a 10-minute idle timer. Every incoming keystroke resets the timer. If no key arrives for 10 minutes, the server shuts down the connection and cleans up container resources, preventing abandoned processes from leaking memory.

---

## 5. Voice Chat & WebRTC Mesh (Q22–Q24)

### Q22: Why did you choose a WebRTC P2P Mesh over an SFU (Selective Forwarding Unit)?
**Answer:** We chose a P2P Mesh architecture due to the nature of our workspace usage:
* **Zero Media Cost**: The backend does not process, decode, or relay audio data. Media traffic flows directly between peers, keeping server costs low.
* **Low Latency**: P2P connections route media directly, minimizing delay.
* **Scale Match**: Collaborative workspaces typically host 2-6 concurrent editors. For small groups, a mesh topology ($O(N^2)$ track allocations) runs efficiently without overloading browser bandwidth.

---

### Q23: Explain the SDP and ICE handshake lifecycle during a WebRTC connection.
**Answer:** Establishing a P2P WebRTC link requires a three-step signaling handshake:
1. **Access Hardware**: Peers query microphone tracks using `getUserMedia()`.
2. **SDP Negotiation**:
   * The caller creates a Session Description Protocol (SDP) offer (`createOffer()`) containing audio formats and codecs, sets it as its local descriptor, and routes it to the target peer via Socket.IO.
   * The target peer sets this as its remote description, generates an SDP answer (`createAnswer()`), sets its local descriptor, and returns the answer.
3. **ICE Candidate Gathering**: Concurrently, peers query STUN servers (`stun.l.google.com:19302`) to discover their public IP and NAT mapping port. These mapping paths (ICE Candidates) are sent via signaling and applied using `addIceCandidate()` to establish a direct connection.

---

### Q24: What is the difference between local muting and closing the peer connection?
**Answer:** 
* **Local Muting**: We toggle the `enabled` property of the local `AudioStreamTrack` (`track.enabled = !track.enabled`). This stops capturing audio at the hardware level. The WebRTC connection remains open, avoiding the latency of renegotiating SDP offers/answers when unmuting.
* **Teardown**: When a user leaves the call, we close the peer connections (`pc.close()`), release media tracks (`track.stop()`), and disconnect the socket connection to free system resources.

---

## 6. Database Schema & Recursive Queries (Q25–Q27)

### Q25: Why did you select the Adjacency List model over Materialized Path for the file system?
**Answer:** 
* **Materialized Path (e.g. `src/utils/math`)**: Requires updating all child paths in the database when a directory is moved or renamed, causing high write overhead for large folder structures.
* **Adjacency List (`parent_id REFERENCES files(id)`)**: Performs moving and renaming operations in $O(1)$ time by updating a single row's name or `parent_id` reference. We use recursive queries to handle directory tree rendering efficiently.

---

### Q26: How does a Recursive CTE query construct nested paths in a single round-trip?
**Answer:** The query uses two members combined with a union:
1. **Anchor Member**: Selects root folders (`parent_id IS NULL`) and sets their path to their base name.
2. **Recursive Member**: Joins the `files` table against the accumulator result table on `f.parent_id = accumulator.id`. It concatenates names: `(accumulator.path || '/' || f.name)`.
3. The query iterates until no child rows match, returning the complete file tree in a single database execution.

---

### Q27: How does `UNIQUE NULLS NOT DISTINCT` resolve the SQL root duplicate file problem?
**Answer:** Under standard SQL rules, `NULL` values are treated as distinct. A unique constraint like `UNIQUE (workspace_id, parent_id, name)` would allow duplicate filenames at the root level because `(workspace_id, NULL, name)` wouldn't match. 

PostgreSQL 15 introduces `NULLS NOT DISTINCT`. Setting this on the unique constraint tells the database to treat all root `parent_id` `NULL` values as equivalent, enforcing filename uniqueness at the root level.

---

## 7. Deployment, Infrastructure & Reliability (Q28–Q30)

### Q28: How does the Nginx reverse proxy direct API traffic, Yjs WS, and terminal streams?
**Answer:** Nginx acts as our public gateway. It terminates SSL (port 443) and routes traffic based on URL patterns:
* `/` routes to the frontend build files directory.
* `/api/` redirects HTTP REST calls to the backend on port 4000.
* `/socket.io/` handles WebSocket upgrades for presence and WebRTC signaling.
* `/terminal/` routes WebSocket connections to the terminal handler.
* WebSockets require forwarding headers like `Connection: "Upgrade"` and `Upgrade: $http_upgrade` to successfully switch protocols.

---

### Q29: How do you configure Node.js clusters under PM2 while ensuring WebSocket state consistency?
**Answer:** Node.js runs on a single-thread event loop. To scale across multiple CPU cores, PM2 runs the backend in cluster mode:
* Running multiple server processes means WebSocket handshakes could land on different processes.
* To prevent handshake failures, we configure the Nginx load balancer with sticky sessions, routing incoming connections from a client to the same PM2 process instance.

---

### Q30: How does the server prevent host disk exhaustion from dangling Docker containers and image builds?
**Answer:** When code executions or terminal sessions crash or time out, containers can accumulate on the host system. We prevent disk exhaustion using two mechanisms:
1. **Server Teardown Hooks**: Backend process signals (`SIGINT`/`SIGTERM`) trigger a cleanup routine that terminates and removes all containers in the active pools.
2. **Garbage Collection Cron Job**: A scheduled daily cron task prunes unused container resources on the host machine:
   ```bash
   0 2 * * * docker system prune -af --filter "until=24h"
   ```
