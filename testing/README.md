# NexusIDE Test Suite Architecture & Organization

This directory contains the unified test suites for NexusIDE, organized into modular directories categorized by execution target and layer.

---

## Directory Organization

```
testing/
├── db/                                # Database & Redis performance & resiliency suites
│   ├── brutal_stress.test.ts          # 6 high-intensity DB stress & thundering herd tests
│   ├── concurrency_locks.test.ts      # 50-session concurrent write & read lock benchmarks
│   ├── crdt_write_behind.test.ts      # Redis Write-Behind CRDT buffer & 95% IOPS reduction
│   ├── query_performance.test.ts      # Covering index & EXPLAIN ANALYZE scan latencies
│   ├── redis_l2_cache.test.ts         # L2 Redis tree & RBAC role authorization cache
│   ├── redis_presence_session.test.ts # Distributed session & real-time presence mesh
│   └── seed_perf_data.ts              # High-density dataset seeder (10K users, 1K workspaces)
│
├── services/                          # Backend services & algorithmic unit tests
│   ├── adaptive-debouncer.test.ts     # Dynamic velocity-based typing debouncer
│   ├── cas-service.test.ts            # Content-Addressable Storage (CAS) SHA-256 blobs
│   ├── crdt-compactor.test.ts         # Historical CRDT delta state compaction
│   ├── cursor-codec.test.ts           # Binary cursor coordinate compression
│   ├── database-optimizations.test.ts # In-memory database query optimizations
│   ├── lsp-service.test.ts            # Language Server Protocol (LSP) proxying
│   ├── preview-proxy.test.ts          # Container sandbox preview reverse proxy
│   ├── redis-cluster.test.ts          # Redis Pub/Sub cluster replication & Redlock
│   ├── terminal-stream-buffer.test.ts # PTY terminal output streaming & ring buffer
│   ├── timelapse.test.ts              # Git commit playback and snapshot history
│   ├── workspace-hibernation.test.ts  # Inactive workspace auto-sleep & state freeze
│   └── workspace-shared-container.test.ts # Docker sandbox container allocation
│
├── integration/                       # Full API & server integration suites
│   ├── api.test.ts                    # REST API routes & JWT authentication
│   └── backend.test.ts                # Full Yjs WebSocket sync + REST persistence
│
├── frontend/                          # React components & UI testing
│   ├── frontend.test.tsx              # Component rendering & editor bindings
│   └── frontend-collaborative-optimizations.test.tsx # Monaco collaborative cursor rendering
│
├── e2e/                               # Playwright End-to-End browser test specs
│   ├── collaboration.spec.ts          # Multi-browser live collaborative typing
│   ├── terminal-lsp.spec.ts           # Interactive terminal execution & diagnostics
│   └── timelapse.spec.ts              # Visual history time-travel playback
│
├── setup.ts                           # Global JSDOM & React Testing Library setup
├── test-utils.ts                      # Shared test mocks, WebSocket factories & helpers
├── vitest-global-setup.ts             # Process-level test orchestrator setup
├── vitest-worker-setup.ts             # Worker listener limit configuration
└── y-websocket.d.ts                   # Type definitions for WebSocket protocol
```

---

## Test Execution Commands

### 1. Database & Redis Suites (Fastest / Production Verified)
```bash
# Run complete 38-benchmark database orchestrator on remote VM
bash test-db.sh

# Run individual test layers
bash test-db.sh --cache       # Phase 1: L2 Virtual Filesystem Tree & RBAC
bash test-db.sh --buffer      # Phase 2: Redis Write-Behind CRDT Buffer
bash test-db.sh --presence    # Phase 3: Distributed Session & Presence Mesh
bash test-db.sh --brutal      # Brutal High-Load Stress Suite
bash test-db.sh --perf        # Query Performance & EXPLAIN ANALYZE
bash test-db.sh --locks       # 50-Session Concurrency & Deadlocks
```

### 2. Unit & Service Tests
```bash
cd testing
npm run test:services         # Runs all unit tests in testing/services/
npm run test:integration      # Runs REST & WebSocket tests in testing/integration/
npm run test:frontend         # Runs React/Monaco tests in testing/frontend/
```

### 3. Playwright End-to-End Specs
```bash
cd testing
npm run test:e2e              # Runs all browser journeys in testing/e2e/
```
