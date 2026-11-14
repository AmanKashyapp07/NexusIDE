# NexusIDE Benchmark Upgrade & Production Hardening Plan

**Status**: Active / In-Progress  
**Author**: Senior Performance Engineer  
**Date**: November 14, 2026  
**Target Repository**: [NexusIDE](https://github.com/AmanKashyapp07/NexusIDE)  

---

## 1. Executive Summary of Audit Findings

A rigorous technical audit of the initial benchmark suite (`benchmarks/scripts/` v1) revealed critical methodological limitations that must be addressed to produce production-grade, defensible performance data:

| Benchmark Component | Initial v1 Methodology | Classification | Core Deficiency Identified | Upgrade Strategy (v2 Production) |
|---|---|---|---|---|
| **1. Binary Cursor Codec** | Inline JS re-implementation of functions | **Tier B (Microbenchmark)** | Production file not directly imported; collaborator scaling stopped at 100; no heap profiling; limited edge-case fuzzing. | Import `cursorCodec.service.ts` directly via `tsx`. Scale to 250 & 500 collaborators. Measure heap allocation delta, uint16 overflow, collision rates, and invalid frame rejection. |
| **2. Docker Container Pool** | Structural array operations with `docker_available: false` | **Tier C / D (Simulated)** | Modeled cold start (~3.5s) was compared against `Array.shift()` (0.1µs), claiming an artificial 35,000,000× speedup without running Docker. | **Execute against live Docker Engine (v29.5.2)**. Benchmark real cold provisioning (`createContainer` + `start`), real warm allocation from `pool.ts`, replenishment latency, exhaustion under concurrency (1, 5, 10, 20 requests). |
| **3. Terminal Stream Buffer** | Inline JS re-implementation with Mock WebSocket | **Tier C (Mocked)** | Mock WS lacked TCP framing, OS buffer constraints, real network backpressure, and socket drain events. | Import production `TerminalStreamBuffer`. Spin up a real loopback WebSocket server (`ws`). Transmit real byte streams, measure socket backpressure, verify bit-for-bit chunk ordering and zero data loss. |
| **4. Real-Time CRDT Sync** | Pure in-memory Y.Doc instances | **Tier B / C (Local Sim)** | In-memory document mutation was presented as multi-client convergence without network transport or Redis bus. | 4-Level Architecture: Level 1 (Local library baseline), Level 2 (Real multi-client WebSocket collaboration: 2, 5, 10 clients), Level 3 (Redis Pub/Sub cross-instance mesh), Level 4 (Empirical tombstone growth analysis under `gc: false`). |
| **5. Merkle DAG & CAS** | Inline SHA-256 and sorting script | **Tier B (Microbenchmark)** | Re-implemented logic; tested only flat synthetic files without exercising the production `CASService` class or repository layer. | Import production `CASService` directly. Test scaling from 10 to 500 files (1KB to 1MB). Benchmark full snapshot, incremental snapshot (1 file, 10%, 100% modified), deduplication across real workspaces, and distinguish pure CPU hashing from storage IO. |
| **6. Redis Write-Behind & Cache** | Direct ioredis pipeline script | **Tier B (Isolated)** | Bypassed production `crdtWriteBehindService` and `RedisCache` wrapper classes. Extrapolated burst performance from a single batch. | Import production `crdtWriteBehindService` and `redisCache.ts`. Benchmark real multi-threaded write-behind buffering, background timer flushes to PostgreSQL, queue growth, and L1 in-memory vs L2 Redis cache hit/miss behavior. |
| **7. PostgreSQL Persistence** | Temporary table with small sample runs | **Tier B (Synthetic)** | Computed sustained throughput by dividing batch latency by 50 rather than running sustained writes over time. | Run sustained write workloads over meaningful durations (5–10 seconds) on dedicated benchmark schema. Measure single INSERT vs multi-row batch (10, 50, 100), read/fetch reconstruction, and pool connection utilization. |

---

## 2. Infrastructure Prerequisites & Environment Matrix

The host environment has been thoroughly audited and confirmed operational:

```
+-----------------------------------------------------------------------------------+
| Component      | Available | Version / Address            | Method / Driver       |
+-----------------------------------------------------------------------------------+
| Node.js        | YES       | v22.20.0                     | Native /usr/local/bin |
| tsx Runner     | YES       | v4.22.4                      | backend/node_modules  |
| Redis Server   | YES       | v8.8.0 on 127.0.0.1:6379     | ioredis v5.4.2        |
| PostgreSQL     | YES       | PostgreSQL 14+ on port 5432  | pg v8.21.0            |
| Docker Daemon  | YES       | Engine v29.5.2 (Unix Socket) | dockerode v5.0.0      |
| Base Image     | YES       | sandbox-dev-env:latest       | Local Docker Cache    |
+-----------------------------------------------------------------------------------+
```

---

## 3. Architecture of Shared Benchmark Infrastructure

To enforce consistent methodology, prevent code duplication, and guarantee statistical rigor across all seven suites, a shared framework is established in `benchmarks/common/`:

```
benchmarks/
├── config/
│   └── benchmark.config.mjs         # Centralized configuration (timeouts, iterations, ports)
├── common/
│   ├── statistics.mjs               # Monotonic timing, percentiles (p50, p95, p99), mean, stddev
│   ├── environment.mjs              # Auto-detection of Node, Docker, Redis, Postgres, OS specs
│   ├── cleanup.mjs                  # Deterministic cleanup for Docker containers, Redis keys, DB rows
│   ├── assertions.mjs               # Correctness validations & invariant assertions
│   └── logger.mjs                   # Structured benchmark logging and progress output
├── scripts/                         # Seven production-grade benchmark suites
├── results/
│   ├── raw/                         # Raw machine-readable JSON results
│   └── processed/                   # Aggregated summary & comparison tables
├── archive/
│   └── historical-v1/               # Preserved legacy scripts & results (v1)
├── BENCHMARK_REPORT.md              # Master production report
└── RESUME_METRICS.md                # Audit-backed resume bullet documentation
```

---

## 4. Evidence Classification Standard (Resume Grading)

Every metric in the final report will be explicitly categorized according to its empirical rigor:

- **Tier A — Production-Backed**: Direct invocation of production code running against live infrastructure (real Docker containers, real WebSockets over loopback TCP, live Redis, live PostgreSQL). Eligible for primary resume bullets.
- **Tier B — Production-Code Microbenchmark**: Direct invocation of production TypeScript classes in isolation from external services (e.g., pure in-memory cryptographic hashing, binary buffer encoding). Eligible for qualified resume bullets.
- **Tier C — Mock / Simulation**: Uses mock transports or simulated delays. Documented strictly for architectural trade-off analysis; **never** promoted to resume claims.
- **Tier D — Modeled / Theoretical**: Extrapolations or asymptotic bounds. Clearly labeled as theoretical estimates.

---

## 5. Execution Roadmap

1. **Phase 2 — Shared Utilities**: Implement `statistics.mjs`, `environment.mjs`, `cleanup.mjs`, `assertions.mjs`, `logger.mjs`, and `benchmark.config.mjs`.
2. **Phase 3 — Implement Production Benchmarks**:
   - `bench-cursor-codec.ts` (Importing `cursorCodec.service.ts`)
   - `bench-terminal-buffer.ts` (Importing `terminalStreamBuffer.ts` + Real WebSocket server)
   - `bench-merkle-dag.ts` (Importing `cas.service.ts` + synthetic & real workspace trees)
   - `bench-redis-writebehind.ts` (Importing `crdtWriteBehind.service.ts` & `redisCache.ts`)
   - `bench-postgres-persistence.ts` (Direct DB persistence via `pg` connection pool)
   - `bench-yjs-crdt.ts` (Local library microbenchmark + Real multi-client WebSocket collaboration)
   - `bench-container-pool.ts` (Importing `pool.ts` + Real Docker Engine container lifecycle)
3. **Phase 4 — Execution & Verification**: Execute all 7 suites, log raw metrics, verify cleanup.
4. **Phase 5 — Report Synthesis**: Write comprehensive `BENCHMARK_REPORT.md` and `RESUME_METRICS.md`.
