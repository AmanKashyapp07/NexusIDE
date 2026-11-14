# NexusIDE Production-Grade Performance Benchmark Suite

This directory contains the production-grade, evidence-backed benchmark suite for **NexusIDE**.

Every benchmark directly exercises the **actual TypeScript production code** in `backend/src/` and interfaces with **real infrastructure services** (Live Docker Engine daemon, Redis 8.8, and PostgreSQL 14+).

---

## Benchmark Directory Layout

```text
benchmarks/
├── BENCHMARK_REPORT.md              # Master production performance audit report
├── IMPROVEMENT_PLAN.md              # Architectural audit & methodology roadmap
├── RESUME_METRICS.md                # 5 resume-ready engineering bullets with evidence records
├── README.md                        # Documentation & reproduction guide
│
├── config/
│   └── benchmark.config.mjs         # Centralized configuration parameters
│
├── common/                          # Reusable statistical & harness utilities
│   ├── statistics.mjs               # Monotonic timing, percentiles (p50/p95/p99), mean, stddev
│   ├── environment.mjs              # Dynamic detection of OS, Node, Docker, Redis, Postgres
│   ├── cleanup.mjs                  # Deterministic cleanup for Docker containers & Redis keys
│   ├── assertions.mjs               # Correctness invariants and fuzzing assertions
│   └── logger.mjs                   # Structured benchmark console output
│
├── scripts/                         # Production TypeScript benchmark suites
│   ├── bench-cursor-codec.ts        # Binary cursor codec vs JSON serialization
│   ├── bench-container-pool.ts      # Real Docker Engine warm container pool allocation
│   ├── bench-terminal-buffer.ts     # Terminal PTY stream buffer over real WebSockets
│   ├── bench-redis-writebehind.ts   # Redis write-behind buffer and multi-tier cache
│   ├── bench-postgres-persistence.ts# PostgreSQL single & batch write persistence
│   ├── bench-yjs-crdt.ts            # 4-Level Yjs CRDT synchronization & real WS collaboration
│   └── bench-merkle-dag.ts          # Merkle DAG content-addressable snapshot storage
│
├── results/
│   └── raw/                         # Raw machine-readable JSON results
│       ├── cursor-codec-production.json
│       ├── container-pool-production.json
│       ├── terminal-buffer-production.json
│       ├── redis-writebehind-production.json
│       ├── postgres-persistence-production.json
│       ├── yjs-crdt-production.json
│       └── merkle-dag-production.json
│
└── archive/
    └── historical-v1/               # Preserved legacy v1 scripts and historical results
```

---

## Prerequisites

1. **Node.js**: v20+ (tested on v22.20.0).
2. **Redis**: Running on `127.0.0.1:6379`.
3. **PostgreSQL**: Running on `localhost:5432/sandbox`.
4. **Docker Engine**: Docker daemon active (Docker Desktop or Linux dockerd socket).
5. **Node Modules**: Installed in `backend/` (`npm install`).

---

## How to Execute the Benchmarks

All benchmark scripts are executed using `tsx` (bundled in `backend/node_modules/tsx`):

```bash
# 1. Binary Cursor Codec (Production Codec vs JSON)
node backend/node_modules/tsx/dist/cli.mjs benchmarks/scripts/bench-cursor-codec.ts

# 2. Redis Write-Behind & Multi-Tier Caching (Live Redis 8.8)
node backend/node_modules/tsx/dist/cli.mjs benchmarks/scripts/bench-redis-writebehind.ts

# 3. Merkle DAG & CAS Snapshots (Production CASService)
node backend/node_modules/tsx/dist/cli.mjs benchmarks/scripts/bench-merkle-dag.ts

# 4. Terminal PTY Stream Buffer (Real Loopback WebSockets)
node backend/node_modules/tsx/dist/cli.mjs benchmarks/scripts/bench-terminal-buffer.ts

# 5. PostgreSQL Persistence Engine (Live PostgreSQL Database)
node backend/node_modules/tsx/dist/cli.mjs benchmarks/scripts/bench-postgres-persistence.ts

# 6. Yjs CRDT Synchronization (Real Multi-Client WS & Redis Mesh)
node backend/node_modules/tsx/dist/cli.mjs benchmarks/scripts/bench-yjs-crdt.ts

# 7. Docker Warm Container Pool (Live Docker Engine Daemon)
node backend/node_modules/tsx/dist/cli.mjs benchmarks/scripts/bench-container-pool.ts
```

---

## Evidence Classification Standard

- **Tier A (Production-Backed)**: Live external infrastructure services tested against production code (Real Docker daemon, Real WebSockets, Live Redis, Live PostgreSQL).
- **Tier B (Production Implementation Microbenchmark)**: Actual production TypeScript classes tested in-memory with mathematical or cryptographic rigor (CAS hashing, Binary codec).
- **Historical v1 Archive**: Initial exploratory scripts and simulated measurements are preserved under `benchmarks/archive/historical-v1/`.
