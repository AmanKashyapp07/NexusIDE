# NexusIDE Production-Grade Performance Benchmark Suite

This directory contains the production-grade, evidence-backed benchmark suite for **NexusIDE**.

The suite combines direct production component integration, live distributed infrastructure measurements, component harnesses, and experimental microbenchmarks to evaluate the architecture.

---

## Benchmark Directory Layout

```text
benchmarks/
├── BENCHMARK_REPORT.md              # Master production performance audit report
├── IMPROVEMENT_PLAN.md              # Architectural audit & methodology roadmap
├── RESUME_METRICS.md                # 5 vetted resume-ready engineering bullets with evidence records
├── README.md                        # Documentation & reproduction guide
│
├── config/
│   └── benchmark.config.mjs         # Centralized configuration parameters
│
├── common/                          # Reusable statistical & harness utilities
│   ├── statistics.mjs               # Monotonic timing, percentiles (p50/p95/p99), mean, stddev, sample warnings
│   ├── environment.mjs              # Dynamic detection of OS, Node, Docker, Redis, Postgres
│   ├── cleanup.mjs                  # Run-scoped cleanup for Docker containers & Redis keys
│   ├── assertions.mjs               # Correctness invariants and fuzzing assertions
│   └── logger.mjs                   # Structured benchmark console output
│
├── scripts/                         # Production TypeScript benchmark suites
│   ├── bench-container-pool.ts      # Real Docker Engine warm container pool allocation (Tier A / B)
│   ├── bench-terminal-buffer.ts     # Terminal PTY stream buffer over real WebSockets (Tier A / C)
│   ├── bench-redis-writebehind.ts   # Redis write-behind buffer and write coalescing (Tier A)
│   ├── bench-postgres-persistence.ts# PostgreSQL single & batch write persistence (Tier B)
│   ├── bench-yjs-crdt.ts            # 4-Level Yjs CRDT synchronization & real WS collaboration (Tier B / D)
│   ├── bench-merkle-dag.ts          # Merkle DAG content-addressable snapshot storage (Tier B)
│   └── bench-cursor-codec.ts        # Binary cursor codec vs JSON serialization (Tier D Experimental)
│
├── results/
│   └── raw/                         # Raw machine-readable JSON results
│       ├── container-pool-production.json
│       ├── terminal-buffer-production.json
│       ├── redis-writebehind-production.json
│       ├── postgres-persistence-production.json
│       ├── yjs-crdt-production.json
│       ├── merkle-dag-production.json
│       └── cursor-codec-production.json
│
└── archive/
    └── historical-v1/               # Preserved legacy v1 scripts and historical results
```

---

## Prerequisites

1. **Node.js**: v20+ (tested on v26.5.0 on macOS ARM64).
2. **Redis**: Running on `127.0.0.1:6379` (Redis v8.8.0).
3. **PostgreSQL**: Running on `localhost:5432/sandbox` (PostgreSQL 14+).
4. **Docker Engine**: Docker daemon active (Docker Desktop v29.5.2 or Linux dockerd socket).
5. **Node Modules**: Installed in `backend/` (`npm install`).

---

## How to Execute the Benchmarks

All benchmark scripts are executed using `tsx` (bundled in `backend/node_modules/tsx`):

```bash
export PATH="/opt/homebrew/bin:$PATH"

# 1. Docker Warm Container Pool (Live Docker Engine Daemon)
node backend/node_modules/tsx/dist/cli.mjs benchmarks/scripts/bench-container-pool.ts

# 2. Terminal PTY Stream Buffer (Real Loopback WebSockets)
node backend/node_modules/tsx/dist/cli.mjs benchmarks/scripts/bench-terminal-buffer.ts

# 3. Redis Write-Behind & Write Coalescing (Live Redis 8.8 + PostgreSQL)
node backend/node_modules/tsx/dist/cli.mjs benchmarks/scripts/bench-redis-writebehind.ts

# 4. PostgreSQL Persistence Engine (Dedicated Pool matching Production Config)
node backend/node_modules/tsx/dist/cli.mjs benchmarks/scripts/bench-postgres-persistence.ts

# 5. Yjs CRDT Synchronization (Real Multi-Client WS & Redis Mesh)
node backend/node_modules/tsx/dist/cli.mjs benchmarks/scripts/bench-yjs-crdt.ts

# 6. Merkle DAG & CAS Snapshots (Production CASService)
node backend/node_modules/tsx/dist/cli.mjs benchmarks/scripts/bench-merkle-dag.ts

# 7. Binary Cursor Codec (Experimental 8-Byte vs 12-Byte vs JSON)
node backend/node_modules/tsx/dist/cli.mjs benchmarks/scripts/bench-cursor-codec.ts
```

---

## Multi-Tiered Evidence Classification Standard

- **Tier A (Production Component Integration)**: Direct invocation of production code running against live infrastructure (Real Docker daemon warm checkout and fallback, real WebSocket frame coalescing, live Redis write-behind buffering and PostgreSQL persistence flush).
- **Tier B (Production Infrastructure & Algorithms)**: Infrastructure capability measurements and component harnesses (Direct-SQL PostgreSQL writes with dedicated pool matching production configuration, `WSSharedDoc` multi-client WebSocket collaboration, `cas.service.ts` Merkle tree generation and deduplication).
- **Tier C (Emulated Interface Tests)**: Hardware or driver boundary validations evaluated against transport interfaces (Socket `bufferedAmount` threshold throttling and drain delivery).
- **Tier D (Experimental Prototypes & Microbenchmarks)**: Non-production algorithmic evaluations (The 8-byte cursor codec evaluated with 16-bit hash collision disclosure, and in-memory Yjs tombstone growth under `gc: false`).
- **Historical v1 Archive**: Initial exploratory scripts and simulated measurements are preserved under `benchmarks/archive/historical-v1/`.
