# NexusIDE Production-Grade Performance Audit & Benchmark Report

**Audit Date**: November 14, 2026  
**Benchmark Owner**: NexusIDE Engineering Audit  
**Target Repository**: [NexusIDE](https://github.com/AmanKashyapp07/NexusIDE)  
**Evidence Standard**: Production-Backed (Tier A) & Production-Code Microbenchmarks (Tier B).  
**Execution Environment**:
- **Hardware**: Apple Silicon ARM64 (Apple M4, 10 CPU cores, 16 GB RAM)
- **Host OS**: macOS 15.3 (Darwin 27.2.0)
- **Node.js**: v26.5.0 (V8 14.6.202.34-node.24, libuv 1.52.1)
- **Docker Engine**: Daemon v29.5.2 via `/Users/amankashyap/.docker/run/docker.sock` (Base Image: `sandbox-dev-env:latest`)
- **Redis Server**: Redis v8.8.0 on `127.0.0.1:6379`
- **PostgreSQL**: PostgreSQL 14.20 on `localhost:5432/sandbox` with connection pooling (`getPool()`)
- **Measurement Instrumentation**: Monotonic high-resolution millisecond timing via Node.js `performance.now()` (`perf_hooks`) with JIT warmup phases and statistical percentile distributions (min, median, max, p95, p99, stddev).

---

## 1. Executive Summary

This report provides the verified, reproducible performance audit of the NexusIDE system. Every benchmark directly exercises the **actual TypeScript production implementations** from `backend/src/` against **live infrastructure services** (Live Docker Engine v29.5.2, Redis 8.8, and PostgreSQL 14.20 over loopback TCP).

All historical extrapolations, unverified speedup ratios, and simulated L1 cache claims have been removed. Sample counts, distributions, trade-offs, and boundary edge cases are explicitly disclosed.

### Production Performance Scorecard

| Subsystem | Metric | Baseline | Production Engine | Improvement / Speedup | Evidence Tier & Scope |
|---|---|---|---|---|---|
| **Binary Cursor Codec** | 100-User Payload Size | 6,798 Bytes (JSON) | 800 Bytes (Packed Binary) | **88.23% payload reduction** | **Tier B** (Component Microbenchmark) |
| **Binary Cursor Codec** | 100-User Batch Deserialization | 108.6K batch ops/s (JSON.parse) | 3.42M batch ops/s (Binary Decode) | **31.53× faster batch decoding** | **Tier B** (Component Microbenchmark) |
| **Binary Cursor Codec** | 500-User Batch Deserialization | 22.1K batch ops/s (JSON.parse) | 648.5K batch ops/s (Binary Decode) | **29.37× faster batch decoding** | **Tier B** (Component Microbenchmark) |
| **Docker Container Pool** | Workspace Allocation Latency | 102.63 ms (Cold Boot Median, n=5) | 0.2882 ms (Warm Pool Pop Median, n=5) | **356.1× faster checkout (~102.3ms saved)** | **Tier A** (Live Docker 29.5.2) |
| **Docker Container Pool** | Depleted Pool Fallback | 102.63 ms (Cold Provisioning) | 104.72 ms (On-Demand Fallback, n=5) | **Graceful non-blocking degradation** | **Tier A** (Live Docker 29.5.2) |
| **Terminal Stream Buffer** | Socket Framing (1,000 Chunks) | 1,000 individual frames | 4 coalesced frames | **99.6% frame reduction** (+4.34ms latency delta) | **Tier A** (Real WS TCP Transport) |
| **Terminal Stream Buffer** | Socket Framing (100 Chunks) | 100 individual frames | 2 coalesced frames | **98.0% frame reduction** (+8.84ms latency delta) | **Tier A** (Real WS TCP Transport) |
| **Terminal Stream Buffer** | Socket Throttling & Drain | Unchecked buffer bloat | Deferred transmission at 64KB threshold | **Zero byte loss, strictly ordered FIFO** | **Tier C** (Emulated Socket Interface) |
| **Redis Write-Behind Buffer** | 100-Update Ingestion Throughput | 22,264 updates/s (Single) | 1,476,451 updates/s (Batch Pipeline) | **66.3× throughput gain** | **Tier A** (Live Redis 8.8) |
| **Redis Write-Behind Buffer** | 500-Update Burst Ingestion | 13.04 ms (500 sequential calls) | 0.22 ms (Pipelined Batch call) | **98.33% latency drop (59.9× speedup)** | **Tier A** (Live Redis 8.8) |
| **Redis Write-Behind Buffer** | Database Write Coalescing | 50 separate SQL INSERTs | 1 coalesced row write in 5.13 ms | **98.0% write amplification reduction** | **Tier A** (Live Redis + PostgreSQL) |
| **PostgreSQL Persistence** | 100-Update Multi-Row INSERT | 0.0714 ms / row (Single INSERT) | 0.00311 ms / row effective | **321,436 rows/sec effective capacity** | **Tier B** (Infrastructure / Direct SQL) |
| **PostgreSQL Persistence** | Concurrent Client Writes (5 workers)| N/A | 24,016 rows/sec (20.82 ms burst) | **Zero transaction deadlocks** | **Tier B** (Infrastructure / Direct SQL) |
| **Merkle DAG CAS Engine** | Snapshot Speed (100 Files) | Naive directory walk | 0.0793 ms full DAG build | **12,618 DAGs/sec** | **Tier B** (Production Algorithm) |
| **Merkle DAG CAS Engine** | Content Deduplication | 100 physical copies | 51 unique blobs (50% duplicate tree) | **61.28% storage bytes saved** | **Tier B** (Production Algorithm) |
| **Real-Time CRDT Sync** | Dynamic Multi-Client Convergence | N/A | 10.54ms (2 clients), 42.57ms (10 clients) | **100% bit-for-bit convergence** | **Tier B** (WSSharedDoc Harness) |
| **CRDT Tombstone Growth** | Deletion State Inflation | 520 B (Fresh doc, 500 chars) | 1,040 B (`gc: false`, 50% deleted) | **+100.0% tombstone expansion** | **Tier A** (Yjs Engine) |

---

## 2. Component-by-Component Benchmark Analysis

### 2.1. Bit-Packed Binary Cursor Codec (`cursorCodec.service.ts`)

- **Production Source**: `backend/src/services/cursorCodec.service.ts`
- **Execution Script**: `benchmarks/scripts/bench-cursor-codec.ts`
- **Raw Data**: `benchmarks/results/raw/cursor-codec-production.json`
- **Evidence Classification**: **Tier B** (Production Implementation Microbenchmark)
- **Integration Status**: Implemented and tested in `backend/src/services/cursorCodec.service.ts`. Currently a standalone component service; not yet hooked into the live WebSocket collaboration awareness loop in `websocketServer.service.ts`.

#### Methodology
10,000 iterations were performed for each collaborator tier (1, 10, 50, 100, 250, 500 collaborators) comparing production binary bit-packing against equivalent JSON representations. JIT warmup (1,000 iterations) was executed prior to measurement. Latency and batch throughput (batch operations per second) were measured using `performance.now()`.

#### Results Matrix
| Collaborators | Binary Size | JSON Size | Payload Reduction | Binary Encode | JSON Stringify | Encode Speedup | Binary Decode | JSON Parse | Decode Speedup |
|---|---|---|---|---|---|---|---|---|---|
| **1** | 8 B | 64 B | **87.50%** | 5.99M ops/s | 11.90M ops/s | 0.50× | 12.05M ops/s | 4.00M ops/s | **3.01×** |
| **10** | 80 B | 655 B | **87.79%** | 5.99M ops/s | 2.67M ops/s | **2.25×** | 12.05M ops/s | 961K ops/s | **12.54×** |
| **50** | 400 B | 3,365 B | **88.11%** | 4.00M ops/s | 600K ops/s | **6.67×** | 5.99M ops/s | 212K ops/s | **28.19×** |
| **100** | 800 B | 6,798 B | **88.23%** | 3.42M ops/s | 300K ops/s | **11.41×** | 3.42M ops/s | 108.6K ops/s | **31.53×** |
| **250** | 2,000 B | 17,257 B | **88.41%** | 1.50M ops/s | 121K ops/s | **12.37×** | 1.26M ops/s | 44.4K ops/s | **28.41×** |
| **500** | 4,000 B | 34,606 B | **88.44%** | 842K ops/s | 60.5K ops/s | **13.93×** | 648.5K ops/s | 22.1K ops/s | **29.37×** |

*Note: Throughput numbers reflect batch operations per second (i.e. encoding/decoding entire collaborator arrays).*

#### Correctness, Boundary Invariants & Hash Collision Analysis:
1. **Round-Trip Bit Fidelity**: Verified that `(userHash: 42, line: 145, col: 82, selection: 14)` round-trips bit-for-bit through `encodeBitPackedCursor` and `decodeBitPackedCursor`.
2. **Boundary Clamping**: Coordinates $> 65,535$ clamp strictly to `65,535`, preventing uint16 overflow wrap-around.
3. **Corrupted Buffer Safety**: Buffers whose length is not a multiple of 8 bytes safely decode to 0 elements without throwing uncaught exceptions or reading out-of-bounds memory.
4. **16-bit Hash Space & Birthday Paradox Collision Risks**:
   - Because user IDs are hashed into a 16-bit unsigned integer (`uint16`, range 0–65,535), the collision probability follows the birthday paradox:
     - 10 active users in a room: **0.069% collision probability**
     - 50 active users in a room: **1.852% collision probability**
     - 100 active users in a room: **7.278% collision probability**
     - 10,000 global users: **17.14% empirical collision rate**
5. **Engineering Resolution — 12-Byte uint32 Layout**:
   - Expanding the header to 12 bytes (`uint32 userHash`, `uint16 line`, `uint16 col`, `uint16 selectionLength`, 2 bytes padding) was benchmarked:
     - Collision probability for 100 users drops to $<0.000001\%$, and 0 collisions were observed across 10,000 global IDs.
     - Payload size at 100 users is 1,200 bytes, retaining an **82.35% payload reduction** over 6,798-byte JSON.
     - *Recommendation*: Migrate to the 12-byte layout before integrating into the live WebSocket awareness loop.

---

### 2.2. Pre-Warmed Docker Container Sandbox Pool (`pool.ts`)

- **Production Source**: `backend/src/sandbox/pool.ts`
- **Execution Script**: `benchmarks/scripts/bench-container-pool.ts`
- **Raw Data**: `benchmarks/results/raw/container-pool-production.json`
- **Evidence Classification**: **Tier A** (Live Docker Engine v29.5.2)

#### Methodology
Containers were spawned directly against the host Docker Engine daemon using the production image (`sandbox-dev-env:latest`) with full Linux CGroup constraints (`1.5 CPU cores`, `1 GB RAM`, `500 PID limit`, `256 MB tmpfs`).
To eliminate spurious samples caused by asynchronous background replenishment:
1. Warm checkouts synchronized with `waitForReplenishmentComplete()` and verified `terminalPool.length > 0` before every pop.
2. Fallback checkouts waited for in-flight refills, drained `terminalPool` to strictly 0 depth, and verified `terminalPool.length === 0` immediately before measuring on-demand creation.
3. Five verified trials were recorded for each scenario (n=5).

#### Results
- **Cold Provisioning Latency (5 real trials)**:
  - Recorded Samples: `[106.67, 97.73, 102.63, 113.49, 102.51]` ms
  - **Median**: **102.63 ms** | Mean: 104.61 ms | Min: 97.73 ms | Max: 113.49 ms | p95: 113.49 ms
- **Warm Pool Allocation Latency (5 real trials)**:
  - Recorded Samples: `[0.2935, 0.2882, 0.4325, 0.2841, 0.2526]` ms
  - **Median**: **0.2882 ms (288.2 µs)** | Mean: 0.3102 ms | Min: 0.2526 ms | Max: 0.4325 ms | p95: 0.4325 ms
  - **Speedup**: Warm checkout is **356.1× faster** than cold boot (**99.72% latency eliminated**, saving ~102.3 ms per checkout).
- **Pool Exhaustion Fallback (5 real trials with verified empty pool)**:
  - Recorded Samples: `[100.30, 90.76, 104.72, 105.88, 111.54]` ms
  - **Median**: **104.72 ms** | Mean: 102.64 ms | Min: 90.76 ms | Max: 111.54 ms | p95: 111.54 ms
  - *Degradation Behavior*: When the pool is exhausted, allocation seamlessly falls back to ~105 ms on-demand container boot without throwing or blocking.
- **Resource Cleanup**: All 25 containers created during the benchmark run were completely removed (`container.remove({ force: true, v: true })`). Zero orphan containers remained.

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
| **A. Standard Output (100 × 256 B)** | 100 | 100 frames | **2 frames** | **98.00%** | 1.49 ms | 10.34 ms | **+8.84 ms** | **100% Match ✓** |
| **B. High-Velocity Burst (1,000 × 64 B)** | 1,000 | 1,000 frames | **4 frames** | **99.60%** | 6.03 ms | 10.38 ms | **+4.34 ms** | **100% Match ✓** |
| **C. Large Streaming (10 × 8 KB)** | 10 | 10 frames | **5 frames** | **50.00%** | 0.09 ms | 0.14 ms | **+0.05 ms** | **100% Match ✓** |
| **D. Mixed Escapes & Output (100 chunks)**| 100 | 100 frames | **13 frames** | **87.00%** | 0.55 ms | 10.36 ms | **+9.81 ms** | **100% Match ✓** |

#### Latency Trade-Off & Backpressure Evaluation:
1. **Engineering Trade-off**:
   - In Scenario A (standard output), buffered delivery adds **+8.84 ms** latency delta (1.49 ms vs 10.34 ms).
   - In Scenario B (high burst), buffered delivery adds **+4.34 ms** latency delta (6.03 ms vs 10.38 ms).
   - This trade-off is deliberate: the added delay stays strictly within the 10 ms coalescing window budget and remains below the 16.7 ms (60 FPS) human visual perception threshold, while eliminating 98–99.6% of WebSocket framing headers.
2. **Backpressure Congestion Safety (Tier C Interface Audit)**:
   - When socket congestion was applied (`bufferedAmount = 70,000 > 64KB`), `TerminalStreamBuffer` deferred flush, holding 47 bytes in RAM (client received 0 frames).
   - Upon socket drain (`bufferedAmount = 0`), the deferred payload was transmitted immediately; the client received all 47 bytes with 100% bit-for-bit fidelity and zero dropped bytes.

---

### 2.4. Redis Write-Behind & Write Coalescing (`crdtWriteBehind.service.ts`)

- **Production Source**: `backend/src/services/crdtWriteBehind.service.ts` & `backend/src/utils/redisCache.ts`
- **Execution Script**: `benchmarks/scripts/bench-redis-writebehind.ts`
- **Raw Data**: `benchmarks/results/raw/redis-writebehind-production.json`
- **Evidence Classification**: **Tier A** (Live Redis 8.8.0 & PostgreSQL 14.20)

#### Results
- **Single Keystroke Ingestion (`bufferCrdtUpdate` - 1,000 iterations)**:
  - Median: **0.0449 ms** | p95: **0.0827 ms** | p99: **0.1478 ms** | **22,264 ops/sec**
  - Redis RAM Queue Depth: Exactly 1,000 buffered updates verified.
- **Batch Pipeline Ingestion (`bufferCrdtUpdatesBatch`)**:
  - Batch of 10: 0.002769 ms / update effective (**361,180 updates/sec**)
  - Batch of 50: 0.000976 ms / update effective (**1,024,338 updates/sec**)
  - Batch of 100: 0.000677 ms / update effective (**1,476,451 updates/sec**)
- **500-Update Burst Ingestion (Sequential vs Pipelined Live Comparison)**:
  - 500 Sequential unbatched writes: **13.04 ms**
  - 500 Pipelined batch write: **0.22 ms**
  - **Burst Speedup**: **59.9× faster (98.33% latency reduction)**
- **End-to-End Persistence Flush (`flushFileBuffer`)**:
  - Flushing 50 buffered updates from Redis into PostgreSQL executed in **5.13 ms** (under distributed lock).
  - All 50 edits were merged via `Y.mergeUpdates` and coalesced into a single database row write, achieving a **98.0% reduction in database write amplification**.
- **Redis Cache Read & Write Latency**:
  - `RedisCache.set`: Median **0.0246 ms** (40,609 ops/sec)
  - `RedisCache.get` (Hit): Median **0.0235 ms** (42,553 ops/sec, 100% hit rate across 500 lookups)
  - *Architectural Note*: `RedisCache` in `backend/src/utils/redisCache.ts` uses an in-memory Map strictly as an offline fallback when Redis is unreachable, not as a write-through L1 cache.

---

### 2.5. PostgreSQL Persistence Engine (`db.ts`, `file_updates`)

- **Production Source**: `backend/src/db.ts` (`getPool()`)
- **Execution Script**: `benchmarks/scripts/bench-postgres-persistence.ts`
- **Raw Data**: `benchmarks/results/raw/postgres-persistence-production.json`
- **Evidence Classification**: **Tier B** (PostgreSQL Infrastructure Benchmark: Direct SQL with Production `getPool()` Connection Pool)
- **Scope Note**: Measures database engine raw row and batch write throughput via the production connection pool (`max: 30`, `idleTimeout: 10000ms`, `statement_timeout: 5000ms`). The complete application persistence lifecycle (write coalescing) is benchmarked in Section 2.4.

#### Results
- **Connection Ping (`SELECT 1` - 500 iterations)**: Median **0.0611 ms** | p95: **0.0942 ms** (16,377 queries/sec)
- **Single `BYTEA` Row INSERT (500 iterations)**: Median **0.0714 ms** | p95: **0.1914 ms** | p99: **0.4463 ms** (14,011 rows/sec)
- **Parameterized Multi-Row Batch Inserts**:
  - Batch of 10: Median 0.0881 ms $\rightarrow$ **0.00881 ms / row** (113,502 rows/sec effective)
  - Batch of 50: Median 0.2735 ms $\rightarrow$ **0.00547 ms / row** (182,829 rows/sec effective)
  - Batch of 100: Median 0.3111 ms $\rightarrow$ **0.00311 ms / row** (**321,436 rows/sec effective**)
- **Concurrent Client Writes**: 5 parallel client workers executed 500 total writes in 20.82 ms (**24,016 rows/sec burst throughput**, zero transaction deadlocks).
- **Document State Replay**: Reading 500 ordered sequential bytea updates for document reconstruction took **2.62 ms** (381 replays/sec).

---

### 2.6. Yjs CRDT Synchronization & Real-Time Collaboration (`yjsSyncEngine.service.ts`)

- **Production Source**: `backend/src/services/yjsSyncEngine.service.ts` & `backend/src/services/redisAdapter.service.ts`
- **Execution Script**: `benchmarks/scripts/bench-yjs-crdt.ts`
- **Raw Data**: `benchmarks/results/raw/yjs-crdt-production.json`
- **Evidence Classification**: **Tier B** (Component Test Harness: Production `WSSharedDoc` Class + Single-Host Redis Pub/Sub Mesh)
- **Scope Qualification**: Measures `WSSharedDoc` synchronization concurrency over real WebSockets and Redis Pub/Sub update replication between document instances in a single-host environment. Full multi-instance production clustering with HTTP upgrade auth was not evaluated.

#### Results
1. **Local Mutation Throughput (Level 1)**:
   - 100 insertions: 1.56 ms (64,269 ins/s, 1.20 B/char)
   - 1,000 insertions: 3.27 ms (305,682 ins/s, 1.02 B/char)
   - 5,000 insertions: 28.30 ms (176,677 ins/s, 1.00 B/char)
2. **Real Multi-Client WebSocket Collaboration (`WSSharedDoc` - Level 2)**:
   - Tested concurrent clients performing 20 edits each over real WebSockets, verified via dynamic state vector convergence polling:
     - **2 Clients (40 total edits)**: Converged in **10.54 ms** (100% bit-for-bit identical ✓)
     - **5 Clients (100 total edits)**: Converged in **29.56 ms** (100% bit-for-bit identical ✓)
     - **10 Clients (200 total edits)**: Converged in **42.57 ms** (100% bit-for-bit identical ✓)
3. **Redis Pub/Sub Cross-Instance Propagation & Convergence (Level 3)**:
   - Origin `Y.Doc` mutations broadcast via `publishYjsUpdate`, received by replica `Y.Doc` over Redis channel `yjs:update:*`:
   - Median: **0.165 ms** | p95: **0.495 ms**
   - Content and state vectors matched bit-for-bit across all 100 replicated characters (Convergence Verified: YES ✓).
4. **Tombstone Growth Analysis under `gc: false` (Level 4)**:
   - 0% Deleted: 1,021 Bytes (baseline)
   - 25% Deleted: 1,040 Bytes vs 771 Bytes fresh doc (**+34.89% inflation**)
   - 50% Deleted: 1,040 Bytes vs 520 Bytes fresh doc (**+100.0% inflation**)
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
  - 10 KB: 0.00404 ms (247,402 ops/s, 2.42 GB/s)
  - 100 KB: 0.0353 ms (28,335 ops/s, 2.77 GB/s)
  - 1 MB: 0.356 ms (2,809 ops/s, **2.81 GB/s**)
- **Workspace DAG Generation (`buildMerkleTreeInline`)**:
  - 10 files: **0.0107 ms** (93,756 dags/s)
  - 50 files: **0.0414 ms** (24,169 dags/s)
  - 100 files: **0.0793 ms** (12,618 dags/s)
  - 500 files: **0.392 ms** (2,553 dags/s)
- **Structural Tree Diffing (`diffTrees` across 100 files)**:
  - 1 file modified: 0.0082 ms (121K diffs/s)
  - 10 files modified: 0.0053 ms (189K diffs/s)
  - 100 files modified: 0.0055 ms (182K diffs/s)
- **Content Deduplication Across Variable Redundancy**:
  - 25% Duplication (Templates): 76 unique blobs (**34.36% bytes saved**)
  - 50% Duplication (Vendored): 51 unique blobs (**61.28% bytes saved**)
  - 75% Duplication (Shared): 26 unique blobs (**82.25% bytes saved**)

---

## 3. Discovered Bottlenecks & Optimization Recommendations

1. **Sequential Replenishment in `pool.ts`**:
   The container replenishment loop currently provisions containers sequentially. Refactoring to parallel creation (`Promise.allSettled`) would reduce pool refill latency during burst checkout.
2. **Tombstone Accumulation in `yjsSyncEngine.service.ts`**:
   Disabling GC (`gc: false`) is necessary for replay history but causes **+283.8% state size inflation** when 75% of text is deleted. Implementing periodic snapshot checkpoints into the Merkle CAS will allow active memory compaction without losing historical auditability.
3. **Cursor Codec 12-Byte Header Migration**:
   The current uint16 user hash presents a 7.28% collision risk for 100 users. Expanding the cursor header from 8 bytes to 12 bytes (`uint32 userHash`) eliminates collisions (0.000% probability) while preserving an 82.35% payload reduction over JSON.

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
