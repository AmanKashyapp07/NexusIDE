# NexusIDE: Collaborative Cloud IDE

<div align="center">

### A Production-Ready Collaborative Cloud IDE

**Real-time Collaboration** • **Docker Sandboxing** • **Persistent Terminals** • **Language Server Protocol** • **Git Merge Conflict Resolver** • **Stateless Redis Clustering**

[View Repository](https://github.com/AmanKashyapp07/sandbox-ide) · [Live Demo](https://github.com/AmanKashyapp07/sandbox-ide) · [Report Issue](https://github.com/AmanKashyapp07/sandbox-ide/issues)

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)

---

</div>

NexusIDE is an advanced, browser-based collaborative development environment engineered around infrastructure-level distributed-systems challenges: eventual-consistency state synchronization, container lifecycle orchestration, pseudo-terminal streaming, and defense-in-depth code sandboxing.

Rather than a thin compilation widget, NexusIDE models real cloud-IDE infrastructure end-to-end — pre-warmed container pools, reference-counted container multiplexing, raw JSON-RPC language server streams, Redis-backed stateless clustering with Redlock-guarded writes, and transactional Merkle-DAG state restoration.

---

## Table of Contents
- [Core Features](#core-features)
- [Systems Architecture](#systems-architecture)
- [Tech Stack](#tech-stack)
- [Deep-Dive Engineering Highlights](#deep-dive-engineering-highlights)
- [Security & Isolation](#security--isolation)
- [Performance Optimizations](#performance-optimizations)
- [Repository Structure](#repository-structure)
- [Getting Started](#getting-started)
- [Testing Suite](#testing-suite)
- [Engineering Learnings](#engineering-learnings)

---

## Core Features

| Feature | Engineering Description |
| :--- | :--- |
| **Content-Addressable Storage (CAS)** | Git-style Merkle DAG commit architecture with SHA-1 blob deduplication (`git_blobs`, `git_trees`, `git_commits`), enabling O(1) unchanged-subtree detection during diffs. |
| **Real-time Collaboration** | Multi-user conflict-free editing via Yjs CRDTs (Conflict-free Replicated Data Types), with presence indicators, awareness protocol broadcasting, and live cursor synchronization. |
| **Stateless WebSocket Clustering** | Redis Pub/Sub mesh bridges independent, horizontally-scaled Node.js pods; Redlock atomic distributed locking (Lua `SET NX PX` + `EVALSHA`) prevents concurrent PostgreSQL write contention across instances. |
| **Persistent Workspaces** | Long-lived, stateful developer sandboxes; xterm.js terminals binding directly to Docker pseudo-terminal (PTY) devices for native shell fidelity. |
| **Workspace Snapshotting & Diffs** | Merkle tree snapshots (max 10 history points) with hash-based fast diff computation (`NEW`, `DEL`, `MOD`) and transactional Yjs document reload. |
| **Multi-Port Live Preview** | Reverse-proxied live application previews with cookie-based session persistence and subresource routing across arbitrary container ports. |
| **Git Conflict Resolver** | Interactive side-by-side collaborative resolve view supporting manual edits, three-way diff context, and auto-staging (`git add`) on resolution. |
| **AI Autocomplete** | Mistral AI (Codestral) powered Fill-in-the-Middle (FIM) code suggestions with context-aware prompt completion and inline ghost text. |
| **LSP Language Intelligence** | In-container Pyright and TypeScript Language Servers streamed via JSON-RPC 2.0 over WebSockets, delivering real-time diagnostics, hovers, and completions. |
| **Bidirectional Sync** | Dynamic, low-latency synchronization between database persistence, live client editors, and container filesystems. |
| **Granular RBAC** | Fine-grained, role-based access enforcement dynamically applied at both REST and socket gateway layers (`Admin`, `Editor`, `Viewer`). |

---

## Systems Architecture

```mermaid
graph TD
    %% Browser Layer
    subgraph Client [Browser Client Layer]
        A1[Monaco Editor]
        A2[xterm.js Terminal]
        A3[Yjs CRDT Client]
        A4[Socket.IO Client]
    end

    %% Gateway Layer
    subgraph Gateway [Express & WebSocket Gateway]
        B1[Express HTTP Server]
        B2[Raw WebSockets Upgrade Handler]
        B3[Socket.IO Event Gateway]
    end

    %% Business Logic Layer
    subgraph Logic [Backend Engines]
        C1[GitHub OAuth Manager]
        C2[Workspace Lifecycle Coordinator]
        C3[LSP Stream Bridge]
        C4[Mistral AI Autocomplete Engine]
        C5[CRDT Sync Engine]
        C6[Redis Adapter / Cluster Mesh]
        C7[Redlock Distributed Lock]
    end

    %% Resource Layer
    subgraph Infrastructure [Resource Infrastructure]
        D1[(PostgreSQL Database)]
        D2[Docker Pool Manager]
        D3[Active Workspace Containers]
        D4[Mistral AI Endpoint]
        D5[(Redis Pub/Sub + Cache)]
    end

    %% Connections
    A1 <-->|JSON-RPC| B2
    A2 <-->|PTY Stream| B2
    A3 <-->|CRDT Sync Messages| B2
    A4 <-->|Voice Signaling / Presence / Tree Events| B3

    B1 -->|Import / Setup| C1
    B1 -->|REST Actions| C2
    B2 -->|Raw WebSocket Streams| C3 & C5
    B1 -->|Autocomplete FIM| C4

    C1 & C2 <-->|Schema Operations| D1
    C2 -->|Control Loop / Provision| D2
    D2 -->|Pre-warmed Containers| D3
    C3 <-->|Docker Stream Bindings| D3
    C4 <-->|Prompt Completion| D4
    C5 <-->|Binary Blob Updates| D1
    C5 <-->|CRDT Fan-out / Awareness| C6
    C6 <-->|Pub/Sub Channels| D5
    C7 <-->|Lua Atomic Locks| D5
    C5 -->|Acquire Write Lock| C7
```

---

## Tech Stack

* **Frontend:** React, TypeScript, Tailwind CSS, Monaco Editor, xterm.js
* **Backend:** Node.js, Express, Socket.IO, WS (raw WebSockets), Dockerode
* **Database:** PostgreSQL (relational schema + `BYTEA` binary CRDT persistence)
* **Collaboration:** Yjs CRDTs (Conflict-free Replicated Data Types) with awareness protocol
* **Clustering:** Redis (Pub/Sub fan-out mesh, Yjs state cache, Redlock atomic distributed locking)
* **AI Engine:** Mistral AI (Codestral Fill-in-the-Middle completion)
* **Language Intelligence:** Pyright (Python LSP), TypeScript Language Server (JS/TS LSP) over JSON-RPC
* **Security & Auth:** JWT, GitHub OAuth 2.0, Docker sandboxed kernel namespaces, cgroup resource limiting

---

## Deep-Dive Engineering Highlights

<details>
<summary><b>Persistent Docker Workspaces & PTY Streaming</b></summary>
<br/>

Unlike lightweight web sandboxes that execute code inside ephemeral browser workers, NexusIDE provisions a fully isolated backend Linux environment per workspace.
* **PTY Integration:** xterm.js in the browser binds directly to a raw Unix pseudo-terminal (`/bin/bash` or `/bin/sh`) inside a sandbox container via `dockerode`. Keystrokes and terminal resize (`SIGWINCH`) events are packed as raw binary packets and piped bidirectionally over WebSockets with sub-frame latency.
* **Warm Container Pools:** Cold-booting a Docker container typically costs 800ms–1.5s. A background pool-manager daemon maintains a standing reserve of pre-warmed, idle developer containers, collapsing perceived provisioning latency down to **under 50ms**.
* **Reference-Counted Multiplexing:** To prevent RAM exhaustion under multi-tab usage, concurrent tabs from the same user to the same workspace share a single underlying container via reference counting, with idle containers scheduled for graceful teardown after 30 minutes of absolute inactivity.
</details>

<details>
<summary><b>Yjs CRDT Real-Time Collaboration</b></summary>
<br/>

Multiple collaborators edit concurrently with mathematically guaranteed convergence and zero manual merge conflicts.
* **Distributed Synchronization:** Every keystroke is modeled as an incremental CRDT operation. The client applies edits locally-first for zero-latency responsiveness, then propagates compact, delta-encoded state-update vectors to peers.
* **Binary Database Persistence:** Yjs document states are serialized into binary update blobs (`Buffer`) and persisted in PostgreSQL `BYTEA` columns for durable recovery.
* **Debounced Writes:** To eliminate database write amplification, persistence is decoupled from the hot edit path — in-memory Yjs documents update instantly on keystroke, while PostgreSQL writes are debounced to fire only after 2 seconds of edit silence.
</details>

<details>
<summary><b>Git Merge Conflict Resolver</b></summary>
<br/>

Standard Git merge conflicts (e.g., following a `git pull`) can otherwise break naive web-based editors.
* **Conflict Parsing:** A purpose-built parser scans files for standard Git conflict markers (`<<<<<<< HEAD`, `=======`, `>>>>>>>`), decomposing them into structured, readable blocks representing current ("Ours") and incoming ("Theirs") changes.
* **Resolving & Auto-Staging:** Resolutions made through the split-screen UI trigger an atomic PostgreSQL update, a live transactional push to every connected Monaco session via `applyRestoredContentToLiveDocs`, and a dynamic `git add <filepath>` executed inside the workspace's Docker container to auto-stage the resolved file.
</details>

<details>
<summary><b>Content-Addressable Storage (CAS) & Merkle DAG Snapshots</b></summary>
<br/>

NexusIDE implements a Git-inspired object model for immutable, deduplicated workspace versioning:
* **Deduplicated Merkle DAG:** Instead of duplicating entire file trees per checkpoint, snapshots form a content-addressable storage (CAS) graph:
  - **`git_blobs`:** Unique file contents indexed by SHA-1 hash (`blob_hash`) — unmodified files across snapshots consume zero additional storage.
  - **`git_trees`:** Recursive directory tree nodes mapping filenames to blob or subtree hashes (`tree_hash`), with deterministic sorting for reproducible root-tree computation.
  - **`git_commits`:** Immutable commit records (`id`, `workspace_id`, `root_tree_hash`, `parent_commit_id`, `label`, `created_at`, `created_by`) forming a full commit DAG lineage.
* **Fast Diff Engine:** Computes instant snapshot diffs by comparing root tree hashes down to individual leaves, achieving near O(1) unchanged-subtree short-circuiting and classifying changes into `NEW`, `MOD`, and `DEL` states with full path preservation.
* **Transactional State Restoration:** Restores entire workspace hierarchies inside atomic SQL transactions, re-syncs container filesystems, updates Yjs state records, evicts stale in-memory documents (`cancelAndEvictWorkspaceDocs`), and broadcasts `snapshot-restored` events cluster-wide to connected Monaco editors.
* **Snapshot Eviction Policy:** Enforces a bounded cap of 10 snapshots per workspace, automatically pruning the oldest commits on new snapshot creation to keep storage growth predictable.
</details>

<details>
<summary><b>Stateless WebSocket Clustering via Redis Pub/Sub & Redlock</b></summary>
<br/>

NexusIDE's collaboration engine operates as a fully stateless, horizontally-scalable cluster — multiple independent Node.js WebSocket pods serve the same workspace concurrently without shared memory or sticky-session requirements.

* **Redis Pub/Sub Mesh (`redisAdapter.service.ts`):** Every Yjs CRDT update and awareness cursor packet written on one pod is instantly fanned out via `psubscribe` pattern-matched channels (`yjs:update:*`, `yjs:awareness:*`). Peer pods consume these on their `pmessageBuffer` handler and apply them with a `'redis'` origin tag to break re-broadcast feedback loops. Binary payloads are decoded using `new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)` — a critical correctness detail for respecting `byteOffset` on pooled Node.js `Buffer` slices.
* **Distributed Locking (`distributedLock.service.ts`):** Before each debounced PostgreSQL save, the engine acquires a per-file Redlock distributed lock via an atomic Lua `SET NX PX` + `EVALSHA` script, guaranteeing mutual exclusion across pods and preventing conflicting `UPDATE files` queries during simultaneous saves — last-writer-wins consistency without application-level serialization bottlenecks.
* **Cluster-Wide Workspace Eviction:** Snapshot restores and workspace deletions broadcast a `workspace:evict:<workspaceId>` signal to Redis. Every subscribed pod locally invokes `cancelAndEvictWorkspaceDocs` with `skipBroadcast=true` and force-closes connected clients with WebSocket close code `4100` ("Snapshot restored"), triggering client-side editor reload.
* **Yjs State Caching:** Freshly saved Yjs binary states are pushed to a Redis `SETEX` cache (5-minute TTL). Subsequent cold loads check Redis before falling back to PostgreSQL, substantially reducing DB read latency for warm documents.

</details>

<details>
<summary><b>AI Autocomplete & Fill-in-the-Middle (FIM) Completion Engine</b></summary>
<br/>

NexusIDE provides intelligent code completions powered by Codestral (Mistral AI) with low latency:
* **Fill-in-the-Middle (FIM) Prompting:** Code preceding and following the user's cursor is extracted into prefix (`<PREFIX>`) and suffix (`<SUFFIX>`) tokens, enabling contextual inline code synthesis rather than standard naive append-only completions.
* **Debounced Request Pipeline:** Autocomplete requests are debounced on user typing bursts with active request cancellation (AbortController) to minimize API token consumption and eliminate stale response rendering.
* **Inline Ghost Text:** Integrates with Monaco Editor's `InlineCompletionsProvider` to render grayed ghost text completions, allowing seamless single-tab acceptance or escape cancellation.

</details>

## Security & Isolation

Security is treated as a first-class concern given arbitrary user-supplied code execution:
* **Resource Limits:** Docker containers are provisioned with hard cgroup boundaries (`1GB RAM`, `1.5 CPU cores`, `500 PIDs limit`) to neutralize fork-bomb and resource-exhaustion attacks.
* **Write Isolation:** Sandboxes run without root privileges; system-level commands are aliased or restricted to a user-safe binary allowlist.
* **Network Isolation:** Workspaces are attached to an isolated internal Docker bridge network with strict egress controls, blocking lateral access to internal infrastructure.
* **Granular RBAC Enforcer:** REST and socket gateways validate every incoming request against `workspace_collaborators` role assignments:
  - `Admin`: Full write, snapshot management, collaborator administration.
  - `Editor`: Code editing, terminal command execution, directory creation.
  - `Viewer`: Read-only access (no writes, terminal interaction, or settings changes).

---

## Performance Optimizations

NexusIDE implements high-throughput, low-latency optimizations across the full stack:

* **Redis-Backed Yjs Caching:** Dual-layer Redis/PostgreSQL cache for real-time Yjs document states, warm-cached on WebSocket handshake and invalidated on debounced database saves (800ms).
* **Redis Cluster Mesh Fan-out:** Cross-pod CRDT relay over Redis Pub/Sub channels delivers update packets to peer WebSocket servers in sub-5ms round-trips, with `'redis'` origin tagging to eliminate recursive feedback loops.
* **Redlock Distributed Saves:** Atomic Lua-scripted Redlock ensures exactly one pod executes an `UPDATE files` query per `fileId` at any instant, preventing split-brain write contention under load-balanced, multi-instance deployments.
* **Index-Covered Queries:** Composite indexes (e.g., `(file_id, seq)` for timelapse operations) and query rewrites (`UNION` over `OR` predicates) that favor index scans over sequential scans.
* **Gzip Middleware Compression:** Applies Gzip compression to all API responses exceeding 1KB, cutting file-tree JSON payload sizes by **up to 80%**.
* **Direct Streamed Exports:** Workspace ZIP archive exports are constructed via recursive Common Table Expressions (CTEs) and streamed as compressed bytes directly to the HTTP response socket, with zero intermediate host-file allocation.
* **Warm Container Pools:** A background pool daemon maintains pre-warmed idle containers, collapsing cold-start latency from 1.5s down to **under 50ms**.
* **Docker Bind Mounts:** Workspace directories mount directly into sandbox containers via bind mounts, eliminating intermediate file-transfer overhead and redundant database pulls during container initialization.

---

## Repository Structure

```
nexus-ide/
├── backend/
│   ├── src/
│   │   ├── routes/              # HTTP REST Controllers (Workspaces, Files, Auth)
│   │   ├── sandbox/             # Docker container pools & orchestration
│   │   ├── services/            # Core engines (WebSocket, Yjs Sync, Redis Adapter, Redlock)
│   │   ├── terminal/            # WebSocket PTY & LSP handlers
│   │   ├── utils/                # Redis cache, Yjs cache, parsing utilities
│   │   ├── docsRegistry.ts      # In-memory doc Map, eviction & cluster broadcast
│   │   └── server.ts            # Entrypoint & raw WS handler
├── frontend/
│   ├── src/
│   │   ├── api/                  # Modular REST API layer (workspace, auth, files, AI, snapshots)
│   │   ├── components/           # Shared components (ConflictResolver, SnapshotPanel, CodeEditor)
│   │   ├── contexts/             # React Context Providers (Workspace, Socket, Collaboration, LSP)
│   │   ├── hooks/                 # Custom React hooks (useCodeEditorSetup, useBlameAnnotations, useTimelapsePlayer)
│   │   ├── services/              # Standalone OOP services (LspService, MonacoLspAdapter)
│   │   └── pages/                 # IdePage, Dashboard, Login pages
├── database/
│   └── schema.sql               # Database schemas & triggers
└── testing/
    ├── test-utils.ts            # Composable test setup & helper utilities
    ├── api.test.ts               # REST API service unit tests
    ├── backend.test.ts           # Backend API & DB integration tests
    ├── redis-cluster.test.ts     # Redis Pub/Sub mesh, Redlock & cluster E2E tests
    ├── frontend.test.tsx         # React IDE component unit tests
    ├── lsp-service.test.ts       # JSON-RPC framing & LSP service unit tests
    ├── cas-service.test.ts       # CAS SHA-256 hashing & Merkle tree unit tests
    ├── timelapse.test.ts         # Timelapse calculation engine unit tests
    ├── collaboration.spec.ts     # Playwright E2E Collaboration & Git Merge tests
    ├── terminal-lsp.spec.ts      # Playwright E2E Terminal PTY & LSP tests
    └── timelapse.spec.ts         # Playwright E2E Timelapse Replay & Attribution tests
```

---

## Getting Started

### Prerequisites
* Node.js v20+
* PostgreSQL v14+
* Docker Engine

### 1. Database Setup
Create a PostgreSQL database named `sandbox` and initialize the schema:
```bash
createdb sandbox
psql -d sandbox -f database/schema.sql
```

### 2. Configure Environment Variables
Create a `.env` file in `backend/`:
```env
PORT=4000
DATABASE_URL=postgresql://postgres:password@localhost:5432/sandbox
JWT_SECRET=super_secret_jwt_key

GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret

MISTRAL_API_KEY=your_mistral_api_key
MISTRAL_AUTOCOMPLETE_MODEL=codestral-latest

# Redis clustering (optional — falls back to localhost:6379)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
```

### 3. Install Dependencies
Run installation commands for both projects:
```bash
# Install backend packages
cd backend && npm install

# Install frontend packages
cd ../frontend && npm install
```

### 4. Run Development Servers
```bash
# Start Backend (Listening on http://localhost:4000)
cd backend && npm run dev

# Start Frontend (Listening on http://localhost:5173)
cd ../frontend && npm run dev
```

---

## Testing Suite

NexusIDE features a comprehensive test suite validating full, real-browser collaboration flows, REST APIs, JSON-RPC framing, and CRDT replay engines.

* **Frontend Unit & Integration Tests (Vitest / JSDOM):**
  - `frontend.test.tsx`: Monaco editor initialization, Socket.IO reconnect loops, UI error boundary stability, viewer-role blockages.
  - `lsp-service.test.ts`: JSON-RPC protocol framing, buffer parsing, request timeouts, and LSP event handling.
* **Backend Integration Tests (Vitest / Node):**
  - `backend.test.ts`: REST API routes, PostgreSQL transactions, Redis caching, RBAC authorization, PTY lifecycle.
  - `api.test.ts`: API service client headers, request formatting, and authorization payload validation.
  - `timelapse.test.ts`: Pure unit tests for CRDT snapshot extraction, activity downsampling, and Monaco offset calculations.
  - `cas-service.test.ts`: SHA-256 blob hashing, Merkle tree determinism, and O(1) structural tree diff correctness.
  - `redis-cluster.test.ts`: Redis Pub/Sub channel publishing, Redlock lock acquisition/contention (including 50-thread concurrency), cross-pod CRDT update relay, and cluster-wide workspace eviction with close code `4100`.
* **E2E Integration Tests (Playwright):**
  - `collaboration.spec.ts`: Multi-user live typing, cursor presence, snapshot time-travel, and Git merge conflict resolution.
  - `terminal-lsp.spec.ts`: Interactive PTY bash streaming, background process execution, and Pyright / TS Language Server diagnostics.
  - `timelapse.spec.ts`: Keystroke recording, timeline scrubbing, author attribution, and full-fidelity replay engine tests.

### Running Test Suites
You can run test suites using the project test runner script:

```bash
# Run Frontend Unit & Component Tests (15 tests passing)
bash test.sh --frontend

# Run Backend API & Integration Tests (107 tests passing, 2 skipped)
bash test.sh --backend

# Run E2E Playwright Integration Tests against deployed VM
NEXUS_BASE_URL="http://YOUR_SERVER_IP" bash test.sh --e2e

# Run a specific E2E test in isolation
(cd frontend && NEXUS_BASE_URL="http://YOUR_SERVER_IP" npx playwright test ../testing/collaboration.spec.ts -g "14. broadcasts snapshot-restored")
```

### 5. Deployment & Remote E2E Testing

The project is designed to be fully deployable on cloud VMs (e.g., Oracle VM) under PM2 process management.
- **Dynamic Host Resolution**: The client application dynamically resolves the API endpoint and WebSocket gateway hostnames relative to `window.location.hostname` (mapping port `4000` for API/WS traffic), enabling out-of-the-box support for remote deployments and SSH tunneling without hardcoding target servers at compile time.
- **Headless E2E Execution**: To validate the integration suite directly on a deployed VM, install headless browsers and execute Playwright against the target `NEXUS_BASE_URL`:
  ```bash
  # Inside your SSH session on the VM:
  cd /home/ubuntu/sandbox-ide/frontend
  npx playwright install --with-deps
  NEXUS_BASE_URL=http://localhost:3000 npm run test:e2e
  ```

---

## Engineering Learnings

* **CRDTs vs OT:** Implementing Yjs demonstrated that CRDT state convergence is highly reliable at the algorithmic level, but debouncing persistence is critical for scaling database write throughput.
* **Warm Pools:** Pre-warming Docker containers is effectively mandatory for interactive, low-latency web tooling. Asynchronous resource pre-provisioning eliminates perceived startup latency entirely.
* **WebSocket Streams:** Pipelining standard JSON-RPC language server traffic and raw stdio directly through WebSocket connections dramatically simplifies backend routing versus bespoke protocol translation layers.
* **Redis Pub/Sub Origin Tagging:** Re-broadcast feedback loops are the primary failure mode in multi-pod Yjs deployments. Tagging every Redis-sourced update with a `'redis'` origin and gating re-publication on `if (origin !== 'redis')` is the canonical fix.
* **Buffer Slicing in Node.js:** `new Uint8Array(buffer)` silently ignores `byteOffset` on pooled buffers, corrupting shared `ArrayBuffer` segments. The correct, defensive pattern is `new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)`.
* **Distributed Locking Scope:** Redlock TTLs must comfortably exceed the expected critical-section duration — undersized TTLs cause mid-save lock expiry, allowing a second pod to acquire the lock and produce duplicate writes.

---

## Future Plans & Architectural Roadmap

### 1. High-Density Sandboxing with microVMs
While Docker containers provide clean namespace-level isolation, upgrading to lightweight microVM architectures (e.g., AWS Firecracker) is planned to secure host kernels against advanced container-escape exploits during arbitrary untrusted user code execution.

### 2. Real-Time Collaborative Voice & Video Mesh
Integrate peer-to-peer WebRTC mesh channels directly into the workspace gateway to support zero-dependency spatial audio, screen sharing, and quick developer huddles directly alongside live Monaco editing sessions.

### 3. WebAssembly (WASM) Extension Engine
Expose a lightweight WASM-based extension runtime enabling users to load custom linters, formatters, and language analyzers directly inside the browser client without server-side overhead or security risks.