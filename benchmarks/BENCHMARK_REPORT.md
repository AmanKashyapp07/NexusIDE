# NexusIDE Production-Grade Performance Audit & Benchmark Report

**Audit Date**: November 14, 2026  
**Benchmark Owner**: NexusIDE Engineering Audit  
**Target Repository**: [NexusIDE](https://github.com/AmanKashyapp07/NexusIDE)  
**Evidence Standard**: Production-Backed (Tier A) & Production-Code Microbenchmarks (Tier B).  
**Execution Environment**:
- **Hardware**: Apple Silicon ARM64 (Apple M4, 10 CPU cores, 16 GB RAM)
- **Host OS**: macOS 27.2.1 (Build 26B131), Darwin Kernel 27.2.0
- **Node.js**: v26.5.0 (V8 14.6.202.34-node.24, libuv 1.52.1)
- **Docker Engine**: Daemon v29.5.2 via `/Users/amankashyap/.docker/run/docker.sock` (Base Image: `sandbox-dev-env:latest`)
- **Redis Server**: Redis v8.8.0 on `127.0.0.1:6379`
- **PostgreSQL**: PostgreSQL 14.20 on `localhost:5432/sandbox` with connection pooling (`getPool()`)
- **Measurement Instrumentation**: Monotonic high-resolution millisecond timing via Node.js `performance.now()` (`perf_hooks`) with JIT warmup phases and statistical percentile distributions (min, median, max, p95, p99, stddev).

---

## 1. Executive Summary

This report provides the verified, reproducible performance audit of the NexusIDE system. Every benchmark directly exercises the **actual TypeScript production implementations** from `backend/src/` against **live infrastructure services** (Live Docker Engine v29.5.2, Redis 8.8, and PostgreSQL 14.20 over loopback TCP).

All historical extrapolations, unverified speedup ratios, and simulated cache claims have been eliminated. Sample counts, distributions, trade-offs, and boundary edge cases are explicitly disclosed.

### Production Performance Scorecard

| Subsystem | Metric | Baseline | Production Engine | Improvement / Speedup | Evidence Tier & Scope |
|---|---|---|---|---|---|
| **Binary Cursor Codec** | 100-User Payload Size | 6,798 Bytes (JSON) | 800 Bytes (8-Byte) / 1,200 Bytes (12-Byte) | **88.23% / 82.35% payload reduction** | **Tier B** (Component Microbenchmark) |
| **Binary Cursor Codec** | 100-User Batch Deserialization | 108.1K batch ops/s (JSON.parse) | 3.00M batch ops/s (8-Byte) / 2.18M (12-Byte) | **27.78× / 20.20× faster batch decoding** | **Tier B** (Component Microbenchmark) |
| **Binary Cursor Codec** | 500-User Batch Deserialization | 22.1K batch ops/s (JSON.parse) | 648.9K batch ops/s (8-Byte) / 436.3K (12-Byte)| **29.36× / 19.74× faster batch decoding** | **Tier B** (Component Microbenchmark) |
| **Docker Container Pool** | Workspace Allocation Latency | 125.20 ms (Cold Boot Median, n=5) | 0.2100 ms (Warm Pool Pop Median, n=5) | **596.2× faster checkout (~125.0ms saved)** | **Tier A** (Live Docker 29.5.2) |
| **Docker Container Pool** | Depleted Pool Fallback | 125.20 ms (Cold Provisioning) | 130.52 ms (On-Demand Fallback, n=5) | **Graceful non-blocking degradation** | **Tier A** (Live Docker 29.5.2) |
| **Terminal Stream Buffer** | Socket Framing (1,000 Chunks) | 1,000 individual frames | 4 coalesced frames | **99.6% frame reduction** (+5.76ms latency delta) | **Tier A** (Real WS TCP Transport) |
| **Terminal Stream Buffer** | Socket Framing (100 Chunks) | 100 individual frames | 2 coalesced frames | **98.0% frame reduction** (+10.03ms latency delta)| **Tier A** (Real WS TCP Transport) |
| **Terminal Stream Buffer** | Socket Throttling & Drain | Unchecked buffer bloat | Deferred transmission at 64KB threshold | **Zero byte loss, strictly ordered FIFO** | **Tier C** (Emulated Socket Interface) |
| **Redis Write-Behind Buffer** | 100-Update Ingestion Throughput | 21,305 updates/s (Single) | 1,578,432 updates/s (Batch Pipeline) | **74.1× throughput gain** | **Tier A** (Live Redis 8.8) |
| **Redis Write-Behind Buffer** | 500-Update Burst Ingestion | 11.61 ms (500 sequential calls) | 0.27 ms (Pipelined Batch call) | **97.66% latency drop (42.8× speedup)** | **Tier A** (Live Redis 8.8) |
| **Redis Write-Behind Buffer** | Database Write Coalescing | 50 separate SQL INSERTs | 1 coalesced row write in 4.74 ms | **98.0% write amplification reduction** | **Tier A** (Live Redis + PostgreSQL) |
| **PostgreSQL Persistence** | 100-Update Multi-Row INSERT | 0.0726 ms / row (Single INSERT) | 0.00311 ms / row effective | **321,436 rows/sec effective capacity** | **Tier B** (Infrastructure / Direct SQL) |
| **PostgreSQL Persistence** | Concurrent Client Writes (5 workers)| N/A | 26,930 rows/sec (18.57 ms burst) | **Zero transaction deadlocks** | **Tier B** (Infrastructure / Direct SQL) |
| **Merkle DAG CAS Engine** | Snapshot Speed (100 Files) | Naive directory walk | 0.0803 ms full DAG build | **12,461 DAGs/sec** | **Tier B** (Production Algorithm) |
| **Merkle DAG CAS Engine** | Content Deduplication | 100 physical copies | 51 unique blobs (50% duplicate tree) | **61.28% storage bytes saved** | **Tier B** (Production Algorithm) |
| **Real-Time CRDT Sync** | Dynamic Multi-Client Convergence | N/A | 7.44ms (2 clients), 47.23ms (10 clients) | **100% bit-for-bit convergence** | **Tier B** (WSSharedDoc Harness) |
| **CRDT Tombstone Growth** | Deletion State Inflation | 521 B (Fresh doc, 500 chars) | 1,040 B (`gc: false`, 50% deleted) | **+99.62% tombstone expansion** | **Tier A** (Yjs Engine) |

---

## 2. Component-by-Component Benchmark Analysis

### 2.1. Bit-Packed Binary Cursor Codec (`cursorCodec.service.ts`)

- **Production Source**: `backend/src/services/cursorCodec.service.ts`
- **Execution Script**: `benchmarks/scripts/bench-cursor-codec.ts`
- **Raw Data**: `benchmarks/results/raw/cursor-codec-production.json`
- **Evidence Classification**: **Tier B** (Component Microbenchmark)
- **Status & Integration Note**: The 8-byte bit-packed cursor codec in `backend/src/services/cursorCodec.service.ts` is explicitly an **experimental component microbenchmark**. It is **not yet integrated into the live WebSocket collaboration awareness loop** in `websocketServer.service.ts`.

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
| **10** | 80 B | 120 B | 655 B | **87.79%** | **81.68%** | 11.90M | 11.90M | 961K | **12.39×** | **12.39×** |
| **50** | 400 B | 600 B | 3,365 B | **88.11%** | **82.17%** | 4.81M | 4.00M | 214K | **22.43×** | **18.66×** |
| **100** | 800 B | 1,200 B | 6,798 B | **88.23%** | **82.35%** | 3.00M | 2.18M | 108.1K | **27.78×** | **20.20×** |
| **250** | 2,000 B | 3,000 B | 17,257 B | **88.41%** | **82.62%** | 1.26M | 857K | 43.7K | **28.88×** | **19.60×** |
| **500** | 4,000 B | 6,000 B | 34,606 B | **88.44%** | **82.66%** | 649K | 436K | 22.1K | **29.36×** | **19.74×** |

*Note: Throughput numbers reflect batch operations per second (i.e. encoding/decoding entire collaborator arrays).*

#### Correctness, Boundary Invariants & Hash Collision Analysis:
1. **8-Byte Round-Trip & Invariants**: Verified that `(userHash: 42, line: 145, col: 82, selection: 14)` round-trips bit-for-bit. Coordinates $> 65,535$ clamp strictly to `65,535`. Truncated/corrupted buffers safely decode to 0 elements without throwing.
2. **16-bit Hash Space & Birthday Paradox Collision Risks**:
   - Because the 8-byte layout compresses user IDs into a 16-bit unsigned integer (`uint16`, range 0–65,535), the collision probability follows the birthday paradox:
     - 10 active users in a room: **0.069% collision probability**
     - 50 active users in a room: **1.852% collision probability**
     - 100 active users in a room: **7.278% collision probability**
     - 10,000 global users: **17.14% empirical collision rate**
3. **Implemented Collision-Free Identity Solutions**:
   - **Solution A (`RoomIdentityTable`)**: In a collaborative editing session, clients join a room where the room server assigns each participant an ephemeral integer index (0, 1, 2, ... $N-1$) mapped to their permanent UUID. Tested and verified for 100 concurrent room participants: **0.00% collision rate by construction**.
   - **Solution B (12-Byte uint32 Codec)**: Fully implemented and tested in the benchmark script (`encodeBitPackedCursor12` / `decodeBitPackedCursor12`). Allocates 32 bits for `userId` (0 to 4,294,967,295), eliminating collisions across global UUID hashes (0% collision probability) while preserving an **82.35% payload reduction** over JSON at 100 collaborators.

---

### 2.2. Pre-Warmed Docker Container Sandbox Pool (`pool.ts`)

- **Production Source**: `backend/src/sandbox/pool.ts`
- **Execution Script**: `benchmarks/scripts/bench-container-pool.ts`
- **Raw Data**: `benchmarks/results/raw/container-pool-production.json`
- **Evidence Classification**: **Tier A** (Live Docker Engine v29.5.2)

#### Methodology
Containers were spawned directly against the host Docker Engine daemon using the production image (`sandbox-dev-env:latest`) with full Linux CGroup constraints (`1.5 CPU cores`, `1 GB RAM`, `500 PID limit`, `256 MB tmpfs`).
To eliminate spurious samples caused by asynchronous background replenishment:
1. Baseline cold provisioning was measured across 5 separate container creations using the exact production CGroup, port, and tmpfs configuration.
2. Warm checkouts synchronized with `waitForReplenishmentComplete()` and verified `terminalPool.length > 0` before every pop.
3. Fallback checkouts waited for in-flight refills, drained `terminalPool` to strictly 0 depth, and verified `terminalPool.length === 0` immediately before measuring on-demand creation.
4. Teardown lifecycle explicitly deactivated background replenishment (`fillTerminalPool`), drained remaining pool containers, and verified against the Docker daemon that zero benchmark containers remain.

#### Results
- **Cold Provisioning Latency (5 real trials)**:
  - Recorded Samples: `[100.28, 95.74, 132.00, 125.20, 127.65]` ms
  - **Median**: **125.20 ms** | Mean: 116.17 ms | Min: 95.74 ms | Max: 132.00 ms | p95: 132.00 ms
- **Warm Pool Allocation Latency (5 real trials)**:
  - Recorded Samples: `[0.2100, 0.2496, 0.2021, 0.2369, 0.1775]` ms
  - **Median**: **0.2100 ms (210.0 µs)** | Mean: 0.2152 ms | Min: 0.1775 ms | Max: 0.2496 ms | p95: 0.2496 ms
  - **Speedup**: Warm checkout is **596.2× faster** than cold boot (**99.83% latency eliminated**, saving ~125.0 ms per checkout).
- **Pool Exhaustion Fallback (5 real trials with verified empty pool)**:
  - Recorded Samples: `[121.02, 131.34, 130.52, 131.32, 109.39]` ms
  - **Median**: **130.52 ms** | Mean: 124.72 ms | Min: 109.39 ms | Max: 131.34 ms | p95: 131.34 ms
  - *Degradation Behavior*: When the pool is exhausted, allocation seamlessly falls back to ~131 ms on-demand container boot without throwing or deadlocking.
- **Deterministic Cleanup Guarantee**: All 29 benchmark containers created during the run were destroyed. An end-to-end `docker.listContainers` daemon scan verified **zero benchmark containers remain on the host**.

---

### 2.3. Terminal PTY Stream Buffer (`terminalStreamBuffer.ts`)

- **Production Source**: `backend/src/terminal/terminalStreamBuffer.ts`
- **Execution Script**: `benchmarks/scripts/bench-terminal-buffer.ts`
- **Raw Data**: `benchmarks/results/raw/terminal-buffer-production.json`
- **Evidence Classification**:
  - Scenarios A–D: **Tier A** (Real WebSocket TCP Transport)
  - Scenario E (Backpressure): **Tier C** (Emulated Socket-Level Interface Test)

#### Methodology
A real local WebSocket server on `127.0.0.1:49152` and a real WebSocket client were established over loopback TCP. Workloads were transmitted using both direct unbuffered `ws.send()` (baseline) and production `TerminalStreamBuffer` (10ms coalescing window, 16KB batch threshold). Scenario E evaluated backpressure throttling by setting `serverWs.bufferedAmount = 70,000` (> 64KB threshold), verifying that the client receives 0 frames during congestion and receives the exact retained payload bit-for-bit upon socket drain.

#### Results Matrix
| Workload Scenario | Input Chunks | Direct WS Frames | Buffered WS Frames | Frame Reduction % | Direct Latency | Buffered Latency | Latency Delta | Bit-for-Bit Integrity |
|---|---|---|---|---|---|---|---|---|
| **A. Standard Output (100 × 256 B)** | 100 | 100 frames | **2 frames** | **98.00%** | 1.38 ms | 11.41 ms | **+10.03 ms** | **100% Match ✓** |
| **B. High-Velocity Burst (1,000 × 64 B)** | 1,000 | 1,000 frames | **4 frames** | **99.60%** | 5.07 ms | 10.83 ms | **+5.76 ms** | **100% Match ✓** |
| **C. Large Streaming (10 × 8 KB)** | 10 | 10 frames | **5 frames** | **50.00%** | 0.08 ms | 0.11 ms | **+0.03 ms** | **100% Match ✓** |
| **D. Mixed Escapes & Output (100 chunks)**| 100 | 100 frames | **13 frames** | **87.00%** | 0.57 ms | 10.35 ms | **+9.78 ms** | **100% Match ✓** |

#### Latency Trade-Off & Backpressure Evaluation:
1. **Engineering Trade-off**:
   - In Scenario A (standard output), buffered delivery adds **+10.03 ms** latency delta (1.38 ms vs 11.41 ms).
   - In Scenario B (high burst), buffered delivery adds **+5.76 ms** latency delta (5.07 ms vs 10.83 ms).
   - This trade-off is deliberate: the added delay stays strictly within the 10 ms coalescing window budget and remains below the 16.7 ms (60 FPS) human visual perception threshold, while eliminating 98–99.6% of WebSocket framing headers.
2. **Backpressure Congestion Safety (Tier C Interface Audit)**:
   - When socket congestion was applied (`bufferedAmount = 70,000 > 64KB`), `TerminalStreamBuffer` deferred flush, holding 47 bytes in RAM (client received 0 frames).
   - Upon socket drain (`bufferedAmount = 0`), the deferred payload was transmitted immediately; the client received all 47 bytes with 100% bit-for-bit fidelity and zero dropped bytes.
   - *Scope Limitation*: Evaluated transport driver throttling logic and delivery upon drain. Physical OS kernel TCP socket buffer saturation was not performed.

---

### 2.4. Redis Write-Behind & Write Coalescing (`crdtWriteBehind.service.ts`)

- **Production Source**: `backend/src/services/crdtWriteBehind.service.ts` & `backend/src/utils/redisCache.ts`
- **Execution Script**: `benchmarks/scripts/bench-redis-writebehind.ts`
- **Raw Data**: `benchmarks/results/raw/redis-writebehind-production.json`
- **Evidence Classification**: **Tier A** (Live Redis 8.8.0 & PostgreSQL 14.20)

#### Results
- **Single Keystroke Ingestion (`bufferCrdtUpdate` - 1,000 iterations)**:
  - Median: **0.0469 ms** | p95: **0.1041 ms** | p99: **0.1522 ms** | **21,305 ops/sec**
  - Redis RAM Queue Depth: Exactly 1,000 buffered updates verified.
- **Batch Pipeline Ingestion (`bufferCrdtUpdatesBatch`)**:
  - Batch of 10: 0.002656 ms / update effective (**376,478 updates/sec**)
  - Batch of 50: 0.000803 ms / update effective (**1,245,485 updates/sec**)
  - Batch of 100: 0.000634 ms / update effective (**1,578,432 updates/sec**)
- **500-Update Burst Ingestion (Sequential vs Pipelined Live Comparison)**:
  - 500 Sequential unbatched writes: **11.61 ms**
  - 500 Pipelined batch write: **0.27 ms**
  - **Burst Speedup**: **42.8× faster (97.66% latency reduction)**
- **End-to-End Persistence Flush (`flushFileBuffer`)**:
  - Flushing 50 buffered updates from Redis into PostgreSQL executed in **4.74 ms** (under distributed lock).
  - All 50 edits were merged via `Y.mergeUpdates` and coalesced into a single database row write, achieving a **98.0% reduction in database write amplification**.
- **Redis Cache Read & Write Latency**:
  - `RedisCache.set`: Median **0.0193 ms** (51,725 ops/sec)
  - `RedisCache.get` (Hit): Median **0.0240 ms** (41,667 ops/sec, 100% hit rate across 500 lookups)
  - *Architectural Note*: `RedisCache` in `backend/src/utils/redisCache.ts` uses an in-memory Map strictly as an offline fallback when Redis is unreachable, not as a write-through L1 cache.

---

### 2.5. PostgreSQL Persistence Engine (`db.ts`, `file_updates`)

- **Production Source**: `backend/src/db.ts` (`getPool()`)
- **Execution Script**: `benchmarks/scripts/bench-postgres-persistence.ts`
- **Raw Data**: `benchmarks/results/raw/postgres-persistence-production.json`
- **Evidence Classification**: **Tier B** (PostgreSQL Infrastructure Benchmark: Direct SQL with Production `getPool()` Connection Pool)
- **Scope Note**: Measures database engine raw row and batch write throughput via the production connection pool (`max: 30`, `idleTimeout: 10000ms`, `statement_timeout: 5000ms`). The complete application persistence lifecycle (write coalescing) is benchmarked in Section 2.4.

#### Results
- **Connection Ping (`SELECT 1` - 500 iterations)**: Median **0.0608 ms** | p95: **0.0910 ms** (16,461 queries/sec)
- **Single `BYTEA` Row INSERT (500 iterations)**: Median **0.0726 ms** | p95: **0.1041 ms** | p99: **0.2055 ms** (13,777 rows/sec)
- **Parameterized Multi-Row Batch Inserts**:
  - Batch of 10: Median 0.0907 ms $\rightarrow$ **0.00907 ms / row** (110,268 rows/sec effective)
  - Batch of 50: Median 0.2905 ms $\rightarrow$ **0.00581 ms / row** (172,129 rows/sec effective)
  - Batch of 100: Median 0.3111 ms $\rightarrow$ **0.00311 ms / row** (**321,436 rows/sec effective**)
- **Concurrent Client Writes**: 5 parallel client workers executed 500 total writes in 18.57 ms (**26,930 rows/sec burst throughput**, zero transaction deadlocks).
- **Document State Replay**: Reading 500 ordered sequential bytea updates for document reconstruction took **0.4126 ms** (2,424 replays/sec).
- **Safe Lifecycle Guarantee**: Dedicated isolated table `bench_file_updates_*` dropped and connection pool closed in a deterministic `finally` block.

---

### 2.6. Yjs CRDT Synchronization & Real-Time Collaboration (`yjsSyncEngine.service.ts`)

- **Production Source**: `backend/src/services/yjsSyncEngine.service.ts` & `backend/src/services/redisAdapter.service.ts`
- **Execution Script**: `benchmarks/scripts/bench-yjs-crdt.ts`
- **Raw Data**: `benchmarks/results/raw/yjs-crdt-production.json`
- **Evidence Classification**: **Tier B** (Component Test Harness: Production `WSSharedDoc` Class + Single-Host Redis Pub/Sub Mesh)
- **Scope Qualification**: Measures `WSSharedDoc` synchronization concurrency over real WebSockets and Redis Pub/Sub update replication between document instances in a single-host environment. Full multi-instance production clustering with HTTP upgrade auth was not evaluated.

#### Results
1. **Local Mutation Throughput (Level 1)**:
   - 100 insertions: 1.39 ms (71,749 ins/s, 1.20 B/char)
   - 1,000 insertions: 3.19 ms (313,291 ins/s, 1.02 B/char)
   - 5,000 insertions: 14.86 ms (336,528 ins/s, 1.00 B/char)
2. **Real Multi-Client WebSocket Collaboration (`WSSharedDoc` - Level 2)**:
   - Tested concurrent clients performing 20 edits each over real WebSockets, verified via dynamic state vector convergence polling:
     - **2 Clients (40 total edits)**: Converged in **7.44 ms** (100% bit-for-bit identical ✓)
     - **5 Clients (100 total edits)**: Converged in **41.89 ms** (100% bit-for-bit identical ✓)
     - **10 Clients (200 total edits)**: Converged in **47.23 ms** (100% bit-for-bit identical ✓)
3. **Redis Pub/Sub Cross-Instance Propagation & Convergence (Level 3)**:
   - Origin `Y.Doc` mutations broadcast via `publishYjsUpdate`, received and applied by replica `Y.Doc` over Redis channel `yjs:update:*`.
   - Measured with per-update promise synchronization (eliminating timestamp overwrite race conditions):
     - **Median**: **0.0772 ms (77.2 µs)** | p95: **0.1695 ms**
     - Content and state vectors matched bit-for-bit across all 100 replicated characters (Convergence Verified: YES ✓).
4. **Tombstone Growth Analysis under `gc: false` (Level 4)**:
   - 0% Deleted: 1,021 Bytes (baseline)
   - 25% Deleted: 1,040 Bytes vs 771 Bytes fresh doc (**+34.89% inflation**)
   - 50% Deleted: 1,040 Bytes vs 521 Bytes fresh doc (**+99.62% inflation**)
   - 75% Deleted: 1,040 Bytes vs 271 Bytes fresh doc (**+283.76% inflation**)

---

### 2.7. Merkle DAG Content-Addressable Snapshot Engine (`cas.service.ts`)

- **Production Source**: `backend/src/services/cas.service.ts`
- **Execution Script**: `benchmarks/scripts/bench-merkle-dag.ts`
- **Raw Data**: `benchmarks/results/raw/merkle-dag-production.json`
- **Evidence Classification**: **Tier B** (Production Algorithm Microbenchmark)

#### Results
- **Content Hashing Throughput (SHA-256)**:
  - 1 KB: 0.00117 ms (857,633 ops/s, 837.5 MB/s)
  - 10 KB: 0.00396 ms (252,653 ops/s, 2.47 GB/s)
  - 100 KB: 0.0355 ms (28,136 ops/s, 2.75 GB/s)
  - 1 MB: 0.358 ms (2,791 ops/s, **2.79 GB/s**)
- **Workspace DAG Generation (`buildMerkleTreeInline`)**:
  - 10 files: **0.0098 ms** (101,698 dags/s)
  - 50 files: **0.0417 ms** (24,000 dags/s)
  - 100 files: **0.0803 ms** (12,461 dags/s)
  - 500 files: **0.397 ms** (2,516 dags/s)
- **Structural Tree Diffing (`diffTrees` across 100 files)**:
  - 1 file modified: 0.0084 ms (119K diffs/s)
  - 10 files modified: 0.0053 ms (189K diffs/s)
  - 100 files modified: 0.0055 ms (180K diffs/s)
- **Content Deduplication Across Variable Redundancy**:
  - 25% Duplication (Templates): 76 unique blobs (**34.36% bytes saved**)
  - 50% Duplication (Vendored): 51 unique blobs (**61.28% bytes saved**)
  - 75% Duplication (Shared): 26 unique blobs (**82.32% bytes saved**)

---

## 3. Discovered Bottlenecks & Optimization Recommendations

1. **Sequential Replenishment in `pool.ts`**:
   The container replenishment loop currently provisions containers sequentially. Refactoring to parallel creation (`Promise.allSettled`) would reduce pool refill latency during burst checkout.
2. **Tombstone Accumulation in `yjsSyncEngine.service.ts`**:
   Disabling GC (`gc: false`) is necessary for replay history but causes **+283.8% state size inflation** when 75% of text is deleted. Implementing periodic snapshot checkpoints into the Merkle CAS will allow active memory compaction without losing historical auditability.
3. **Cursor Codec Identity Architecture**:
   The experimental 8-byte uint16 user hash presents a 7.28% collision risk for 100 users. Expanding the header to the benchmarked 12-byte layout (`uint32 userId`) or adopting a room-scoped integer index table (`RoomIdentityTable`) guarantees 0% collision while retaining an 82.35% payload reduction over JSON.

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
node backend/node_modules/tsx/dist/cli.mjs benchmarks/scripts/<script-name>.ts
```
Raw outputs are preserved under `benchmarks/results/raw/`.  
Historical exploratory scripts and results are preserved under `benchmarks/archive/historical-v1/`.
