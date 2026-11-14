# NexusIDE Production-Grade Performance Audit & Benchmark Report

**Audit Date**: November 14, 2026  
**Benchmark Owner**: NexusIDE Engineering Audit  
**Target Repository**: [NexusIDE](https://github.com/AmanKashyapp07/NexusIDE)  
**Evidence Standard**: Multi-Tiered Empirical Classification (Tier A: Production Component Integration, Tier B: Production Infrastructure & Algorithms, Tier C: Emulated Interface Tests, Tier D: Experimental Prototypes & Microbenchmarks).  
**Execution Environment**:
- **Hardware**: Apple Silicon ARM64 (Apple M4, 10 CPU cores, 16 GB RAM)
- **Host OS**: macOS 27.2.1 (Build 26B131), Darwin Kernel 27.2.0
- **Node.js**: v26.5.0 (V8 14.6.202.34-node.24, libuv 1.52.1)
- **Docker Engine**: Daemon v29.5.2 via `/Users/amankashyap/.docker/run/docker.sock` (Base Image: `sandbox-dev-env:latest`)
- **Redis Server**: Redis v8.8.0 on `127.0.0.1:6379`
- **PostgreSQL**: PostgreSQL 14.20 on `localhost:5432/sandbox` with connection pooling
- **Measurement Instrumentation**: Monotonic high-resolution millisecond timing via Node.js `performance.now()` (`perf_hooks`) with JIT warmup phases and statistical percentile distributions (min, median, max, p95, p99, stddev).
  - *Percentile Estimator Specification*: Nearest-rank discrete estimator (`floor(n * 0.95)` / `floor(n * 0.99)`). Because of integer truncation, the 95th percentile index equals $n-1$ (selecting the maximum observation) for all $n \le 20$; similarly, the 99th percentile index selects the maximum observation for all $n \le 100$. Small-sample evaluations are explicitly flagged with sample warnings.

---

## 1. Executive Summary

This report delivers a rigorous, statistically verified performance audit of NexusIDE. The benchmark suite exercises production components, live distributed infrastructure, and isolated algorithmic prototypes under strictly documented scopes:

1. **Production Component Integration (Tier A)**: Real Docker daemon container allocations (`pool.ts`), real Redis write-behind buffering and PostgreSQL persistence flushes (`crdtWriteBehind.service.ts`), and terminal stream buffer frame coalescing over loopback WebSocket TCP transport (`terminalStreamBuffer.ts`).
2. **Infrastructure & Component Harnesses (Tier B)**: PostgreSQL raw row and parameterized batch write throughput using an isolated pool matching production configuration, real multi-client WebSocket convergence using production `WSSharedDoc`, and single-host Redis Pub/Sub mesh update propagation.
3. **Production Algorithm Microbenchmarks (Tier B)**: Merkle DAG SHA-256 tree hashing, diffing, and deduplication (`cas.service.ts`) operating on synthetic in-memory file sets.
4. **Emulated Interface Tests (Tier C)**: Terminal buffer backpressure throttling evaluated against socket driver buffer thresholds.
5. **Experimental Prototypes & In-Memory Microbenchmarks (Tier D)**: The 8-byte bit-packed cursor codec evaluated against JSON and prospective 12-byte / room-scoped migration designs, and in-memory Yjs CRDT tombstone growth under `gc: false`.

All sample counts, percentile distributions, trade-offs, and boundary edge cases are explicitly disclosed. Small-sample tail latency caveats (e.g., $n=5$ for Docker allocations where p95/p99 reflect the maximum observation) are mathematically documented.

### Production Performance Scorecard

| Subsystem | Metric | Baseline | Production Engine | Improvement / Speedup | Evidence Tier & Scope |
|---|---|---|---|---|---|
| **Docker Container Pool** | Workspace Allocation Latency | 118.00 ms (Cold Boot Median, n=5) | 0.2774 ms (Warm Pool Pop Median, n=5) | **425.4× faster checkout (~117.7ms saved)** | **Tier A (Warm) / Tier B (Cold)** (Live Docker 29.5.2) |
| **Docker Container Pool** | Depleted Pool Fallback | 118.00 ms (Cold Provisioning) | 112.33 ms (On-Demand Fallback, n=5) | **Graceful non-blocking degradation** | **Tier A** (Live Docker 29.5.2) |
| **Terminal Stream Buffer** | Socket Framing (1,000 Chunks) | 1,000 individual frames | 4 coalesced frames | **99.6% frame reduction** (+5.12ms latency delta) | **Tier A** (Real WS TCP Transport) |
| **Terminal Stream Buffer** | Socket Framing (100 Chunks) | 100 individual frames | 2 coalesced frames | **98.0% frame reduction** (+10.01ms latency delta)| **Tier A** (Real WS TCP Transport) |
| **Terminal Stream Buffer** | Socket Throttling & Drain | Unchecked buffer bloat | Deferred transmission at 64KB threshold | **Zero byte loss, strictly ordered FIFO** | **Tier C** (Emulated Socket Interface) |
| **Redis Write-Behind Buffer** | 100-Update Ingestion Throughput | 29,215 updates/s (Single) | 1,502,336 updates/s (Batch Pipeline) | **51.4× throughput gain** | **Tier A** (Live Redis 8.8) |
| **Redis Write-Behind Buffer** | 500-Update Burst Ingestion | 15.13 ms (500 sequential calls) | 0.24 ms (Pipelined Batch call) | **98.39% latency drop (62.1× speedup)** | **Tier A** (Live Redis 8.8) |
| **Redis Write-Behind Buffer** | Database Write Coalescing | 50 separate SQL INSERTs | 1 coalesced row write in 5.20 ms | **98.0% write amplification reduction** | **Tier A** (Live Redis + PostgreSQL) |
| **PostgreSQL Persistence** | 100-Update Multi-Row INSERT | 0.0700 ms / row (Single INSERT) | 0.00305 ms / row effective | **328,339 rows/sec effective capacity** | **Tier B** (Direct SQL / Isolated Pool) |
| **PostgreSQL Persistence** | Concurrent Client Writes (5 workers)| N/A | 29,793 rows/sec (16.78 ms burst) | **Zero transaction deadlocks** | **Tier B** (Direct SQL / Isolated Pool) |
| **Merkle DAG CAS Engine** | Snapshot Speed (100 Files) | Naive directory walk | 0.0781 ms full DAG build | **12,807 DAGs/sec** | **Tier B** (Production Algorithm) |
| **Merkle DAG CAS Engine** | Content Deduplication | 100 physical copies | 51 unique blobs (50% duplicate tree) | **61.26% storage bytes saved** | **Tier B** (Production Algorithm) |
| **Real-Time CRDT Sync** | Dynamic Multi-Client Convergence | N/A | 7.59ms (2 clients), 37.43ms (10 clients) | **100% bit-for-bit convergence** | **Tier B** (WSSharedDoc Harness) |
| **CRDT Tombstone Growth** | Deletion State Inflation | 521 B (Fresh doc, 500 chars) | 1,037 B (`gc: false`, 50% deleted) | **+99.04% tombstone expansion** | **Tier D** (In-Memory Engine Microbenchmark) |
| **Binary Cursor Codec** | 100-User Payload Size | 6,798 Bytes (JSON) | 800 Bytes (8-Byte) / 1,200 Bytes (12-Byte) | **88.23% / 82.35% payload reduction** | **Tier D** (Experimental Prototype) |
| **Binary Cursor Codec** | 100-User Batch Deserialization | 109.1K batch ops/s (JSON.parse) | 3.00M batch ops/s (8-Byte) / 2.18M (12-Byte) | **27.53× / 19.97× faster batch decoding** | **Tier D** (Experimental Prototype) |

---

## 2. Component-by-Component Benchmark Analysis

### 2.1. Pre-Warmed Docker Container Sandbox Pool (`pool.ts`)

- **Production Source**: `backend/src/sandbox/pool.ts` (`warmPoolManager`)
- **Execution Script**: `benchmarks/scripts/bench-container-pool.ts`
- **Raw Data**: `benchmarks/results/raw/container-pool-production.json`
- **Evidence Classification**:
  - Warm Checkout & Fallback: **Tier A** (Production Component Integration: `warmPoolManager.popTerminalContainer()`)
  - Cold Baseline: **Tier B** (Equivalent Infrastructure Baseline: Docker container with equivalent production cgroup/volume configuration)
- **Statistical Sample Note**: $n=5$ trials per condition. Tail percentiles (p95/p99) reflect the maximum observation due to small sample size ($n < 20$).

#### Methodology & Lifecycle Isolation
Containers were provisioned directly against the host Docker Engine daemon (`sandbox-dev-env:latest`) with production Linux CGroup constraints (`1.5 CPU cores`, `1 GB RAM`, `500 PID limit`, `256 MB tmpfs`).
To eliminate asynchronous replenishment races and guarantee non-destructive cleanup:
1. Every container created during the run was dynamically tagged with a unique run label: `Labels: { 'nexus.benchmark.run': 'nexus-bench-<timestamp>-<rand>' }`.
2. Baseline cold provisioning was measured across 5 separate container starts using equivalent production parameters outside the pool.
3. Warm checkouts synchronized with `waitForReplenishmentComplete()` and asserted `terminalPool.length > 0` before every pop.
4. Fallback checkouts waited for in-flight refills, drained `terminalPool` to strictly 0 depth, and asserted `terminalPool.length === 0` immediately before measuring on-demand creation.
5. Teardown deactivated background replenishment, removed tracked containers, queried the Docker daemon strictly for containers bearing the run ID label, and asserted that zero benchmark containers remain.

#### Results
- **Cold Provisioning Latency (5 real trials, equivalent production config)**:
  - Recorded Samples: `[120.95, 118.00, 98.06, 121.78, 114.70]` ms
  - **Median**: **118.00 ms** | Mean: 114.70 ms | Min: 98.06 ms | Max: 121.78 ms | p95: 121.78 ms
- **Warm Pool Allocation Latency (5 real trials on production `warmPoolManager`)**:
  - Recorded Samples: `[0.2774, 0.4134, 0.2815, 0.2317, 0.2264]` ms
  - **Median**: **0.2774 ms (277.4 µs)** | Mean: 0.2861 ms | Min: 0.2264 ms | Max: 0.4134 ms | p95: 0.4134 ms
  - **Speedup**: Warm checkout is **425.4× faster** than cold boot (**99.76% latency eliminated**, saving ~117.7 ms per checkout).
- **Pool Exhaustion Fallback (5 real trials with verified empty pool)**:
  - Recorded Samples: `[115.34, 103.78, 117.10, 112.33, 108.81]` ms
  - **Median**: **112.33 ms** | Mean: 111.47 ms | Min: 103.78 ms | Max: 117.10 ms | p95: 117.10 ms
  - *Degradation Behavior*: When the pool is depleted, allocation seamlessly falls back to ~112 ms on-demand container boot without throwing or deadlocking.
- **Run-Scoped Cleanup Guarantee**: All 27 benchmark containers created during the run were destroyed. An end-to-end `docker.listContainers({ filters: { label: [...] } })` scan verified **zero benchmark containers with this run ID remain on the host**. Unrelated containers were untouched.

---

### 2.2. Terminal PTY Stream Buffer (`terminalStreamBuffer.ts`)

- **Production Source**: `backend/src/terminal/terminalStreamBuffer.ts`
- **Execution Script**: `benchmarks/scripts/bench-terminal-buffer.ts`
- **Raw Data**: `benchmarks/results/raw/terminal-buffer-production.json`
- **Evidence Classification**:
  - Scenarios A–D: **Tier A** (Real WebSocket TCP Transport + Production `TerminalStreamBuffer`)
  - Scenario E (Backpressure): **Tier C** (Emulated Socket-Level Interface Test)

#### Methodology
A real local WebSocket server on `127.0.0.1:49152` and a real WebSocket client were established over loopback TCP. Workloads were transmitted using both direct unbuffered `ws.send()` (baseline) and production `TerminalStreamBuffer` (10ms coalescing window, 16KB batch threshold). Scenario E evaluated backpressure throttling by setting `serverWs.bufferedAmount = 70,000` (> 64KB threshold), verifying that the client receives 0 frames during congestion and receives the exact retained payload bit-for-bit upon socket drain.

#### Results Matrix
| Workload Scenario | Input Chunks | Direct WS Frames | Buffered WS Frames | Frame Reduction % | Direct Latency | Buffered Latency | Latency Delta | Bit-for-Bit Integrity |
|---|---|---|---|---|---|---|---|---|
| **A. Standard Output (100 × 256 B)** | 100 | 100 frames | **2 frames** | **98.00%** | 1.36 ms | 11.38 ms | **+10.01 ms** | **100% Match ✓** |
| **B. High-Velocity Burst (1,000 × 64 B)** | 1,000 | 1,000 frames | **4 frames** | **99.60%** | 5.32 ms | 10.44 ms | **+5.12 ms** | **100% Match ✓** |
| **C. Large Streaming (10 × 8 KB)** | 10 | 10 frames | **5 frames** | **50.00%** | 0.09 ms | 0.12 ms | **+0.03 ms** | **100% Match ✓** |
| **D. Mixed Escapes & Output (100 chunks)**| 100 | 100 frames | **13 frames** | **87.00%** | 0.53 ms | 10.39 ms | **+9.86 ms** | **100% Match ✓** |

#### Latency Trade-Off & Backpressure Evaluation
1. **Engineering Trade-off**:
   - In Scenario A (standard output), buffered delivery adds **+10.01 ms** latency delta (1.36 ms vs 11.38 ms).
   - In Scenario B (high burst), buffered delivery adds **+5.12 ms** latency delta (5.32 ms vs 10.44 ms).
   - This trade-off is deliberate: the added delay stays strictly within the 10 ms coalescing window budget and remains below the 16.7 ms (60 FPS) human visual perception threshold, while eliminating 98–99.6% of WebSocket framing headers.
2. **Backpressure Congestion Safety (Tier C Interface Audit)**:
   - When socket congestion was applied (`bufferedAmount = 70,000 > 64KB`), `TerminalStreamBuffer` deferred flush, holding 47 bytes in RAM (client received 0 frames).
   - Upon socket drain (`bufferedAmount = 0`), the deferred payload was transmitted immediately; the client received all 47 bytes with 100% bit-for-bit fidelity and zero dropped bytes.
   - *Scope Limitation*: Evaluated transport driver throttling logic and delivery upon drain. Physical OS kernel TCP socket buffer saturation was not performed.

---

### 2.3. Redis Write-Behind & Write Coalescing (`crdtWriteBehind.service.ts`)

- **Production Source**: `backend/src/services/crdtWriteBehind.service.ts` & `backend/src/utils/redisCache.ts`
- **Execution Script**: `benchmarks/scripts/bench-redis-writebehind.ts`
- **Raw Data**: `benchmarks/results/raw/redis-writebehind-production.json`
- **Evidence Classification**: **Tier A** (Live Redis 8.8.0 & PostgreSQL 14.20)

#### Results
- **Single Keystroke Ingestion (`bufferCrdtUpdate` - 1,000 iterations)**:
  - Median: **0.0342 ms** | p95: **0.1052 ms** | p99: **0.1466 ms** | **29,215 ops/sec**
  - Redis RAM Queue Depth: Exactly 1,000 buffered updates verified.
- **Batch Pipeline Ingestion (`bufferCrdtUpdatesBatch`)**:
  - Batch of 10: 0.003413 ms / update effective (**293,040 updates/sec effective batch throughput**)
  - Batch of 50: 0.000954 ms / update effective (**1,048,042 updates/sec effective batch throughput**)
  - Batch of 100: 0.000666 ms / update effective (**1,502,336 updates/sec effective batch throughput**)
- **500-Update Burst Ingestion (Sequential vs Pipelined Live Comparison)**:
  - 500 Sequential unbatched writes: **15.13 ms**
  - 500 Pipelined batch write: **0.24 ms**
  - **Burst Speedup**: **62.1× faster (98.39% latency reduction)**
- **End-to-End Persistence Flush (`flushFileBuffer`)**:
  - Flushing 50 buffered updates from Redis into PostgreSQL executed in **5.20 ms** (under distributed lock).
  - All 50 edits were merged via `Y.mergeUpdates` and coalesced into a single database row write, achieving a **98.0% reduction in database write amplification**.
- **Redis Cache Read & Write Latency**:
  - `RedisCache.set`: Median **0.0244 ms** (41,061 ops/sec)
  - `RedisCache.get` (Hit): Median **0.0242 ms** (41,380 ops/sec, 100% hit rate across 500 lookups)
  - *Architectural Note*: `RedisCache` in `backend/src/utils/redisCache.ts` uses an in-memory Map strictly as an offline fallback when Redis is unreachable, not as an active write-through L1 cache.

---

### 2.4. PostgreSQL Persistence Engine (`db.ts`, `file_updates`)

- **Production Source**: `backend/src/db.ts` (Configuration reference)
- **Execution Script**: `benchmarks/scripts/bench-postgres-persistence.ts`
- **Raw Data**: `benchmarks/results/raw/postgres-persistence-production.json`
- **Evidence Classification**: **Tier B** (PostgreSQL Infrastructure Benchmark: Direct SQL with Dedicated Pool matching Production Parameters)
- **Scope Note**: Direct-SQL infrastructure benchmark measuring database engine raw row and parameterized batch write throughput using a dedicated pool with production settings (`max: 30`, `idleTimeout: 10000ms`, `statement_timeout: 5000ms`). Isolating pool lifecycle prevents interfering with any running application's singleton pool. Application write coalescing is benchmarked in Section 2.3.

#### Results
- **Connection Ping (`SELECT 1` - 500 iterations)**: Median **0.0601 ms** | p95: **0.1000 ms** (16,626 queries/sec)
- **Single `BYTEA` Row INSERT (500 iterations)**: Median **0.0700 ms** | p95: **0.1024 ms** | p99: **0.1875 ms** (14,294 rows/sec)
- **Parameterized Multi-Row Batch Inserts**:
  - Batch of 10: Median 0.1012 ms $\rightarrow$ **0.01012 ms / row** (98,786 rows/sec effective)
  - Batch of 50: Median 0.2767 ms $\rightarrow$ **0.00553 ms / row** (180,696 rows/sec effective)
  - Batch of 100: Median 0.3046 ms $\rightarrow$ **0.00305 ms / row** (**328,339 rows/sec effective**)
- **Concurrent Client Writes**: 5 parallel client workers executed 500 total writes in 16.78 ms (**29,793 rows/sec burst throughput**, zero transaction deadlocks).
- **Document State Replay**: Reading 500 ordered sequential bytea updates for document reconstruction took **0.4455 ms** (2,245 replays/sec).
- **Deterministic Teardown Guarantee**: Dedicated isolated table `bench_file_updates_*` dropped and dedicated benchmark pool closed cleanly in a deterministic `finally` block.

---

### 2.5. Yjs CRDT Synchronization & Real-Time Collaboration (`yjsSyncEngine.service.ts`)

- **Production Source**: `backend/src/services/yjsSyncEngine.service.ts` & `backend/src/services/redisAdapter.service.ts`
- **Execution Script**: `benchmarks/scripts/bench-yjs-crdt.ts`
- **Raw Data**: `benchmarks/results/raw/yjs-crdt-production.json`
- **Evidence Classification**:
  - Level 1: **Tier D** (In-Memory Microbenchmark)
  - Level 2: **Tier B** (Component Test Harness: Real WebSocket clients connected to production `WSSharedDoc` class)
  - Level 3: **Tier B** (Single-Host Distributed Harness: Redis Pub/Sub propagation and state vector convergence across Y.Doc instances)
  - Level 4: **Tier D** (In-Memory CRDT Engine Microbenchmark: Tombstone byte overhead with `gc: false`)
- **Scope Qualification**: Measures `WSSharedDoc` synchronization concurrency over real WebSockets and Redis Pub/Sub update replication between document instances in a single-host environment with bounded safety timeouts. Full multi-instance production clustering with HTTP upgrade auth was not evaluated.

#### Results
1. **Local Mutation Throughput (Level 1)**:
   - 100 insertions: 1.44 ms (69,642 ins/s, 1.19 B/char)
   - 1,000 insertions: 3.12 ms (320,500 ins/s, 1.02 B/char)
   - 5,000 insertions: 10.17 ms (491,511 ins/s, 1.00 B/char)
2. **Real Multi-Client WebSocket Collaboration (`WSSharedDoc` - Level 2)**:
   - Tested concurrent clients performing 20 edits each over real WebSockets, verified via dynamic state vector convergence polling with a 10-second safety timeout:
     - **2 Clients (40 total edits)**: Converged in **7.59 ms** (100% bit-for-bit identical ✓)
     - **5 Clients (100 total edits)**: Converged in **20.74 ms** (100% bit-for-bit identical ✓)
     - **10 Clients (200 total edits)**: Converged in **37.43 ms** (100% bit-for-bit identical ✓)
3. **Redis Pub/Sub Cross-Instance Propagation & Convergence (Level 3)**:
   - Origin `Y.Doc` mutations broadcast via `publishYjsUpdate`, received and applied by replica `Y.Doc` over Redis channel `yjs:update:*`.
   - Measured with per-update promise synchronization and a 5-second safety timeout (eliminating timestamp overwrite race conditions):
     - **Median**: **0.0659 ms (65.9 µs)** | p95: **0.0856 ms** | p99: **0.1824 ms**
     - Content and state vectors matched bit-for-bit across all 100 replicated characters (Convergence Verified: YES ✓).
4. **Tombstone Growth Analysis under `gc: false` (Level 4 - In-Memory Engine Microbenchmark)**:
   - 0% Deleted: 1,021 Bytes (baseline)
   - 25% Deleted: 1,040 Bytes vs 771 Bytes fresh doc (**+34.89% inflation**)
   - 50% Deleted: 1,037 Bytes vs 521 Bytes fresh doc (**+99.04% inflation**)
   - 75% Deleted: 1,040 Bytes vs 271 Bytes fresh doc (**+283.76% inflation**)

---

### 2.6. Merkle DAG Content-Addressable Snapshot Engine (`cas.service.ts`)

- **Production Source**: `backend/src/services/cas.service.ts`
- **Execution Script**: `benchmarks/scripts/bench-merkle-dag.ts`
- **Raw Data**: `benchmarks/results/raw/merkle-dag-production.json`
- **Evidence Classification**: **Tier B** (Production Algorithm Microbenchmark with Synthetic In-Memory Inputs)

#### Results
- **Content Hashing Throughput (SHA-256)**:
  - 1 KB: 0.00113 ms (888,889 ops/s, 868.1 MB/s)
  - 10 KB: 0.00400 ms (250,000 ops/s, 2.44 GB/s)
  - 100 KB: 0.03538 ms (28,269 ops/s, 2.76 GB/s)
  - 1 MB: 0.35592 ms (2,810 ops/s, **2.81 GB/s**)
- **Workspace DAG Generation (`buildMerkleTreeInline`)**:
  - 10 files: **0.0098 ms** (101,698 dags/s)
  - 50 files: **0.0410 ms** (24,365 dags/s)
  - 100 files: **0.0781 ms** (12,807 dags/s)
  - 500 files: **0.3876 ms** (2,580 dags/s)
- **Structural Tree Diffing (`diffTrees` across 100 files)**:
  - 1 file modified: 0.0081 ms (123K diffs/s)
  - 10 files modified: 0.0052 ms (192K diffs/s)
  - 100 files modified: 0.0055 ms (180K diffs/s)
- **Content Deduplication Across Variable Redundancy**:
  - 25% Duplication (Templates): 76 unique blobs (**34.38% bytes saved**)
  - 50% Duplication (Vendored): 51 unique blobs (**61.26% bytes saved**)
  - 75% Duplication (Shared): 26 unique blobs (**82.29% bytes saved**)

---

### 2.7. Bit-Packed Binary Cursor Codec (`cursorCodec.service.ts`)

- **Production Source**: `backend/src/services/cursorCodec.service.ts`
- **Execution Script**: `benchmarks/scripts/bench-cursor-codec.ts`
- **Raw Data**: `benchmarks/results/raw/cursor-codec-production.json`
- **Evidence Classification**: **Tier D** (Experimental Prototype Microbenchmark - Non-Production)
- **Status & Integration Note**: The 8-byte bit-packed cursor codec in `backend/src/services/cursorCodec.service.ts` is explicitly an **experimental component microbenchmark**. It is **not integrated into the live WebSocket collaboration awareness loop** in `websocketServer.service.ts`. Production collaboration currently uses standard JSON cursor awareness.

#### Methodology
10,000 iterations were performed for each collaborator tier (1, 10, 50, 100, 250, 500 collaborators) comparing:
1. Production experimental 8-byte binary bit-packing.
2. Verified 12-byte uint32 collision-free binary codec (`encodeBitPackedCursor12` / `decodeBitPackedCursor12`).
3. Equivalent JSON representations (`[{ userHash, lineNumber, column, selectionLength }, ...]`).
JIT warmup (1,000 iterations) was executed prior to measurement. Latency and batch throughput (batch operations per second) were measured using `performance.now()`.

#### Results Matrix (8-Byte vs 12-Byte vs JSON)
| Collabs | 8-Byte Size | 12-Byte Size | JSON Size | 8-B Reduction | 12-B Reduction | 8-B Decode Ops/s | 12-B Decode Ops/s | JSON Parse Ops/s | 8-B Speedup | 12-B Speedup |
|---|---|---|---|---|---|---|---|---|---|---|
| **1** | 8 B | 12 B | 64 B | **87.50%** | **81.25%** | 12.05M | 12.05M | 4.00M | **3.01×** | **3.01×** |
| **10** | 80 B | 120 B | 655 B | **87.79%** | **81.68%** | 11.90M | 11.90M | 960K | **12.40×** | **12.40×** |
| **50** | 400 B | 600 B | 3,365 B | **88.11%** | **82.17%** | 4.81M | 4.00M | 211K | **22.84×** | **19.00×** |
| **100** | 800 B | 1,200 B | 6,798 B | **88.23%** | **82.35%** | 3.00M | 2.18M | 109.1K | **27.53×** | **19.97×** |
| **250** | 2,000 B | 3,000 B | 17,257 B | **88.41%** | **82.62%** | 1.26M | 828K | 44.0K | **28.72×** | **18.83×** |
| **500** | 4,000 B | 6,000 B | 34,606 B | **88.44%** | **82.66%** | 667K | 436K | 22.2K | **30.06×** | **19.67×** |

*Note: Throughput numbers reflect batch operations per second (i.e. encoding/decoding entire collaborator arrays).*

#### Correctness, Boundary Invariants & Hash Collision Analysis:
1. **8-Byte Round-Trip & Invariants**: Verified that `(userHash: 42, line: 145, col: 82, selection: 14)` round-trips bit-for-bit. Coordinates $> 65,535$ clamp strictly to `65,535`. Truncated/corrupted buffers safely decode to 0 elements without throwing.
2. **16-bit Hash Space & Birthday Paradox Collision Risks**:
   - Because the 8-byte layout compresses user IDs into a 16-bit unsigned integer (`uint16`, range 0–65,535), the collision probability follows the birthday paradox:
     - 10 active users in a room: **0.069% collision probability**
     - 50 active users in a room: **1.852% collision probability**
     - 100 active users in a room: **7.278% collision probability**
     - 10,000 global users: **17.14% empirical collision rate**
3. **Evaluated Migration Designs**:
   - **Approach A (`RoomIdentityTable`)**: In a collaborative editing session, clients join a room where the room server assigns each participant an ephemeral integer index (0, 1, 2, ... $N-1$) mapped to their permanent UUID. Tested and verified for 100 concurrent room participants: **0.00% collision rate by construction**.
   - **Approach B (Prospective 12-Byte uint32 Format)**: Implemented and tested in the benchmark script (`encodeBitPackedCursor12` / `decodeBitPackedCursor12`). Encodes 32 bits for `userId` (0 to 4,294,967,295), preserving an **82.35% payload reduction** over JSON at 100 collaborators. *Note on UUID Mapping*: The 12-byte binary format accepts numeric IDs; achieving end-to-end collision freedom for UUID-based users requires pairing it with an external identity allocator (e.g. database sequence, snowflake generator, or session index) rather than relying on the binary encoding alone.

---

## 3. Discovered Bottlenecks & Optimization Recommendations

1. **Sequential Replenishment in `pool.ts`**:
   The container replenishment loop currently provisions containers sequentially. Refactoring to parallel creation (`Promise.allSettled`) would reduce pool refill latency during burst checkout.
2. **Tombstone Accumulation in `yjsSyncEngine.service.ts`**:
   Disabling GC (`gc: false`) is necessary for replay history but causes **+283.8% state size inflation** when 75% of text is deleted. Implementing periodic snapshot checkpoints into the Merkle CAS will allow active memory compaction without losing historical auditability.
3. **Cursor Codec Identity Architecture**:
   The experimental 8-byte uint16 user hash presents a 7.28% collision risk for 100 users. Expanding the header to the benchmarked 12-byte layout (`uint32 userId`) or adopting a room-scoped integer index table (`RoomIdentityTable`) guarantees 0% collision while retaining an 82.35% payload reduction over JSON before any production deployment.

---

## 4. Limitations and Untested Scenarios

1. **Cross-Region WAN Latency**: Benchmarks executed over local TCP loopback (`127.0.0.1`). Real-world cross-continental 80ms+ ping latency and network jitter were not evaluated.
2. **Client-Side Canvas Rendering**: Terminal buffering was measured up to the WebSocket transport emission. Browser-side WebGL and DOM canvas rendering times in `xterm.js` were not tested.
3. **Physical Kernel TCP Buffer Saturation**: Terminal backpressure was validated at the transport interface layer (`bufferedAmount` threshold throttling); physical OS kernel TCP buffer saturation was not performed.
4. **Physical CGroup OOM Termination**: Linux container resource limits (1GB RAM, 500 PIDs) were configured in Docker, but active physical host memory exhaustion (OOM-killer trigger) was not evaluated.

---

## 5. Reproduction Instructions

Every benchmark can be independently reproduced using `tsx`:
```bash
# Execute any benchmark:
export PATH="/opt/homebrew/bin:$PATH"
node backend/node_modules/tsx/dist/cli.mjs benchmarks/scripts/<script-name>.ts
```
Raw outputs are preserved under `benchmarks/results/raw/`.  
Historical exploratory scripts and results are preserved under `benchmarks/archive/historical-v1/`.
