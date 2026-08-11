# NexusIDE Master Test Suite Architecture & Testing Standard

This directory contains the unified, production-grade test suites for NexusIDE. Every test in this suite adheres to the strict **"Only Real Services & Infrastructure"** architectural policy—eliminating synthetic mocks and testing directly against live PostgreSQL 16, Redis 7, Express services, and CRDT engines.

---

## 🎯 Testing Philosophy: Zero Synthetic Mocks Policy

NexusIDE enforces a zero-tolerance policy for synthetic infrastructure mocks (`vi.mock`, `vi.fn()` service overrides, `mockResolvedValue`, etc.).

1. **Live Production Infrastructure**: Tests connect directly to real PostgreSQL 16 databases and Redis 7 memory nodes.
2. **Real Business Code**: API handlers, auth middleware, and CRDT sync logic execute their real implementations without stubbing out underlying services.
3. **Deterministic State Cleanup**: Database tables are cleared via transactional rollbacks or cleanup CLI routines between test runs.
4. **Time Travel Utilities**: The only allowed `vi.*` utilities are Vitest's built-in time-travel helpers (`vi.useFakeTimers()`, `vi.advanceTimersByTime()`) to test debouncers and timeouts deterministically without delaying execution.

---

## 📁 Directory Organization

```
testing/
├── accessibility/                     # WCAG 2.1 AA & UX accessibility suites
│   ├── keyboard-nav.test.ts          # Keyboard navigation & focus ring specs
│   ├── modal-focus-trap.test.ts      # Dialog focus trap & escape key handlers
│   └── wcag-conformance.test.ts      # ARIA roles & screen-reader contrast ratios
│
├── auth/                              # Authentication & security boundaries
│   ├── jwt-boundary.test.ts          # JWT alg: none rejection & signature validation
│   ├── oauth-flow.test.ts            # GitHub OAuth state token & anti-CSRF checks
│   └── session-fixation.test.ts      # Session fixation prevention & token revocation
│
├── chaos/                             # Fault injection & Jepsen resiliency suites
│   ├── chaos-resilience.test.ts      # Netflix-standard Redis disconnect & fallbacks
│   ├── multi-region-wan-jitter.test.ts # 350ms WAN jitter & cross-continent chaos
│   └── remote-chaos-jepsen.test.ts   # Jepsen split-brain SEC & RAM write-behind recovery
│
├── collab/                            # Multi-peer real-time convergence suites
│   ├── awareness-reconnect.test.ts   # Presence & ghost cursor cleanup after disconnect
│   ├── cross-pod-state-sync.test.ts  # Redis Pub/Sub cross-pod event fan-out
│   └── three-peer-convergence.test.ts# 3-way concurrent edit state vector convergence
│
├── contracts/                         # API schema & protocol contracts
│   └── api-contract.test.ts          # Stripe-standard REST & WS schema backwards compatibility
│
├── crdt-stress/                       # High-density document stress & compaction
│   ├── deep-history-compaction.test.ts# Yjs StructStore compaction without data loss
│   └── large-doc-crdt.test.ts        # 100K edit vector convergence & memory bounds
│
├── data-integrity/                    # Tenant isolation & storage boundaries
│   ├── crdt-compactor-scoping.test.ts# Multi-tenant state vector isolation
│   ├── redis-key-scoping.test.ts     # Workspace Redis key namespace partitioning
│   └── snapshot-boundary.test.ts     # Snapshot restore scope isolation
│
├── data-privacy/                      # GDPR data privacy & export compliance
│   ├── right-to-erasure.test.ts      # GDPR Article 17 hard cascade deletion
│   └── workspace-export.test.ts      # GDPR Article 20 ZIP data export SLA
│
├── db/                                # Database & Redis performance & resiliency suites
│   ├── brutal_stress.test.ts          # High-intensity DB stress & thundering herd tests
│   ├── concurrency_locks.test.ts      # 50-session concurrent write & Redlock benchmarks
│   ├── crdt_write_behind.test.ts      # Redis Write-Behind CRDT buffer & IOPS reduction
│   ├── query_performance.test.ts      # Covering index & EXPLAIN ANALYZE scan latencies
│   ├── redis_l2_cache.test.ts         # L2 Redis filesystem tree & RBAC cache
│   ├── redis_presence_session.test.ts # Distributed session & real-time presence mesh
│   └── seed_perf_data.ts              # High-density dataset seeder (10K users, 1K workspaces)
│
├── disaster-recovery/                 # WAL durability & PITR restore verification
│   ├── pitr-restore-validation.test.ts# Point-in-time recovery & WAL log validation
│   └── unpersisted-wal-recovery.test.ts# Crash recovery for unpersisted RAM updates
│
├── e2e/                               # Playwright End-to-End browser test specs
│   ├── collaboration.spec.ts          # Multi-browser live collaborative typing & cursors
│   ├── e2e-api-latency-distribution.spec.ts # REST API latency distribution (p50 < 100ms, p95 < 300ms, p99 < 800ms)
│   ├── e2e-container-pool-stress.spec.ts # Concurrent workspace container boot & terminal PTY allocation SLA
│   ├── e2e-jepsen-chaos.spec.ts       # Hard SLA limits for partition SEC convergence (10s max) & RAM buffer recovery
│   ├── e2e-latency-sla.spec.ts        # Hard SLA limits for WAN Keystroke-to-Render (K2R) & PTY stream throughput
│   ├── e2e-long-task.spec.ts          # Browser UI main thread long task detection (>50ms) during typing
│   ├── e2e-monaco-memory-leak.spec.ts # Sustained editing & multi-tab V8 heap memory leak benchmark
│   ├── e2e-multi-region-jitter.spec.ts# Real browser multi-region 350ms WAN latency & 5% packet jitter sync
│   ├── e2e-offline-reconnect-sync.spec.ts # Offline edit queueing & automatic reconnect sync
│   ├── e2e-security-penetration.spec.ts# Hard SLA & security boundaries for container terminal isolation & RBAC checks
│   ├── e2e-web-vitals.spec.ts         # Core Web Vitals SLA (FCP < 1.5s, LCP < 2.5s, TTI < 4.0s)
│   ├── e2e-workspace-ttr.spec.ts      # Workspace Cold Boot Time-to-Ready (TTR < 8s) & PTY SLA
│   ├── e2e-ws-hydration-sla.spec.ts   # WebSocket Handshake (101) & Yjs state document hydration SLA
│   ├── file-rename.spec.ts            # Atomic file tree mutations & tab state sync
│   ├── live-preview.spec.ts           # Container dev-server reverse proxying & ports
│   ├── terminal-lsp.spec.ts           # Interactive xterm PTY execution & Pyright LSP
│   └── timelapse.spec.ts              # Per-keystroke time-travel history playback
│
├── frontend/                          # React components & Monaco editor UI testing
│   ├── blame-annotations.test.tsx    # Git author blame gutter decorations
│   ├── frontend-collaborative-optimizations.test.tsx # Monaco collaborative cursor rendering
│   ├── monaco-lifecycle.test.tsx     # Monaco model creation & disposal memory leaks
│   ├── network-phase1.test.ts        # AbortController request cancellation
│   ├── network-phase2.test.ts        # Soft resync & network optimization
│   ├── network-phase3.test.ts        # Network waste elimination
│   ├── network-waste-phase1.test.ts  # Request deduplication
│   ├── network-waste-phase2-3.test.ts# SWR snapshot caching & soft state resync
│   ├── rbac-ui.test.tsx              # Role-based UI element visibility
│   ├── render_batching.test.ts      # 60fps requestAnimationFrame render batching
│   ├── timelapse-player.test.tsx     # Interactive timelapse player control UI
│   ├── ui-performance-phase1.test.tsx# UI render micro-benchmarks
│   ├── ui-performance-phase2.test.tsx# Workspace component mount SLA
│   └── ui-performance-phase3.test.tsx# Tab switching & layout rendering
│
├── git/                               # Git integration & merge conflict suites
│   ├── auto-stage-atomicity.test.ts  # Stage changes & commit atomicity
│   ├── concurrent-resolve-race.test.ts# Concurrent 3-way merge conflict resolution
│   └── conflict-parser.test.ts       # Git conflict marker parsing & AST extraction
│
├── idempotency/                       # Idempotency & update replay suites
│   └── idempotency-replay.test.ts    # Replay attack protection & update deduplication
│
├── integration/                       # Full REST API & WebSocket integration suites
│   └── api.test.ts                    # REST API endpoints, DB queries & JWT authentication
│
├── lsp/                               # Language Server Protocol integration
│   ├── crash-recovery.test.ts        # Pyright / TypeScript server crash auto-restart
│   ├── diagnostics-delivery.test.ts  # JSON-RPC 2.0 error diagnostics streaming
│   ├── lifecycle-sequencing.test.ts  # Initialize / initialized / shutdown handshake
│   └── lsp-protocol-fuzzing.test.ts  # JSON-RPC malformed frame fuzzing
│
├── migration/                         # Database schema & rollback safety
│   ├── rollback-safety.test.ts        # Down migration & zero-data-loss rollback
│   └── schema-migration.test.ts      # Schema DDL updates & trigger integrity
│
├── observability/                     # Metrics, logging & audit trail suites
│   ├── audit-trail.test.ts           # Security audit event logging
│   ├── gdpr-data-deletion.test.ts    # GDPR cascade deletion compliance
│   ├── health-contracts.test.ts      # Prometheus /api/metrics health contracts
│   └── structured-logs.test.ts       # JSON structured log layout & context keys
│
├── perf/                              # System performance & memory benchmarks
│   ├── cas-dedup-ratio.test.ts       # Content-addressable storage deduplication
│   ├── crdt-throughput.test.ts       # Yjs CRDT encode (>50K ops/s), decode (>30K ops/s), merge (>20K ops/s)
│   ├── event-loop-lag.test.ts        # Node.js event loop lag monitoring (p99 < 50ms under 50 sockets)
│   ├── k6-concurrent-load-simulation.test.ts # High-concurrency raw load & latency percentile SLA
│   ├── memory-leak-benchmark.test.ts # V8 heap allocation & garbage collection
│   ├── production-scale-load.test.ts # 50 concurrent workspace load benchmark
│   ├── pty-ansi-throughput.test.ts   # PTY stream ANSI parsing throughput
│   ├── redis-pubsub-throughput.test.ts# Pub/Sub broadcast fan-out (>50,000 msg/s) throughput SLA
│   └── workspace-export-sla.test.ts  # Workspace ZIP archiving SLA
│
├── property/                          # Property-based CRDT fuzzing (fast-check)
│   └── crdt-fuzzing.property.test.ts # Invariant proofs for SEC, associativity & commutativity
│
├── pty-stress/                        # Terminal buffer overflow & ANSI parsing
│   ├── ansi-escape-parser.test.ts    # ANSI color code & cursor escape sequence parsing
│   └── pty-buffer-overflow.test.ts   # PTY stdout ring buffer overflow protection
│
├── quotas/                            # Resource limits & isolation caps
│   ├── disk-quota-exhaustion.test.ts # Workspace disk allocation ceilings
│   ├── egress-rate-limiting.test.ts  # Network egress rate limits
│   └── noisy-neighbor-throttling.test.ts# Multi-tenant resource throttling
│
├── rate-limiting/                     # API rate limiting & DDoS protection
│   ├── burst-protection.test.ts      # Token bucket burst protection
│   ├── rate-limiter.test.ts          # Sliding window IP rate limiting
│   └── socket-flood.test.ts          # WebSocket frame flooding protection
│
├── rbac-matrix/                       # Access control permission matrix
│   └── rbac-matrix.test.ts           # 3 Roles x 12 Actions permission enforcement
│
├── resilience/                        # Multi-region & DR failover
│   ├── disaster-recovery.test.ts     # Database failover & state restoration
│   └── region-failover.test.ts       # Multi-region RPO/RTO failover
│
├── secrets-security/                  # Environment variable & secrets safety
│   ├── env-isolation.test.ts         # Multi-tenant secret isolation
│   └── secrets-redaction.test.ts     # Automatic log secret redaction
│
├── security/                          # Security gates & container isolation
│   ├── ci-audit-secrets-gate.test.ts # CI secrets scanner & dependency audit gate
│   ├── container-escape.test.ts      # Docker sandbox container escape prevention
│   ├── idor-tenant-isolation.test.ts # IDOR & multi-tenant workspace isolation
│   ├── path-traversal.test.ts        # Path traversal defense verification
│   ├── resource-exhaustion.test.ts   # Memory/CPU exhaustion protection
│   └── terminal-injection.test.ts    # ANSI/OSC terminal command injection protection
│
├── services/                          # Backend services & algorithmic unit tests
│   ├── adaptive-debouncer.test.ts    # Dynamic velocity-based typing debouncer
│   ├── cas-service.test.ts           # Content-Addressable Storage (CAS) SHA-256 blobs
│   ├── canary-rollout-killswitch.test.ts # Canary rollout routing & feature flag killswitch SLA
│   ├── container-pool-stress.test.ts # Container pool allocation stress
│   ├── container-security.test.ts    # Docker cgroup PID limits & non-root user
│   ├── crdt-compactor.test.ts        # Incremental Yjs delta compactor
│   ├── cursor-codec.test.ts          # Bit-packed binary cursor coordinate codec
│   ├── database-optimizations.test.ts# Query optimizations & prepared statements
│   ├── lsp-service.test.ts           # Pyright/TS language server proxying
│   ├── magnus-ci-engine.test.ts      # Automated build & test execution engine
│   ├── metrics_observability.test.ts # Prometheus event loop lag tracking
│   ├── multi-port-preview.test.ts    # Dev-server port allocation & preview routing
│   ├── network-resilience.test.ts    # Packet loss & network jitter simulation
│   ├── preview-proxy.test.ts         # Reverse proxy security & header rewriting
│   ├── rbac-security.test.ts         # Live DB RBAC permission middleware checks
│   ├── redis-cluster-failures.test.ts# Redis cluster node failover & Redlock
│   ├── redis-cluster.test.ts         # Redis cluster shard routing
│   ├── remote-security-isolation.test.ts # Sandbox isolation & path traversal checks
│   ├── terminal-stream-buffer.test.ts# PTY stream micro-batching buffer
│   ├── timelapse.test.ts             # Time-travel session playback
│   ├── timelapseEngine.test.ts       # Git playback & revision reader
│   ├── websocket_backpressure.test.ts# Socket backpressure soft/hard limits
│   ├── worker_compute.test.ts        # Worker pool offloading for hashing
│   ├── workspace-hibernation.test.ts # Workspace container hibernation SLA
│   └── workspace-shared-container.test.ts # Docker sandbox pool allocation
│
├── snapshot/                          # Merkle tree & CAS snapshot restore
│   ├── eviction-policy.test.ts       # Oldest-first snapshot garbage collection
│   ├── merkle-integrity.test.ts      # SHA-256 Merkle root hash deterministic sorting
│   └── restore-atomicity.test.ts     # Transactional snapshot restore
│
├── version-skew/                      # Protocol versioning & zero-downtime deployments
│   ├── payload-migration.test.ts     # Backward-compatible CRDT update payloads
│   └── protocol-version-skew.test.ts # Version handshake & legacy payload parsing
│
├── ws/                                # Raw WebSocket protocol conformance
│   ├── close-codes.test.ts           # WebSocket close codes (4100, 4000, 1009)
│   ├── frame-conformance.test.ts     # Frame size enforcement & un-fragmented decoding
│   ├── keepalive.test.ts             # TCP ping/pong heartbeats
│   └── ws-cswsh-security.test.ts     # Cross-Site WebSocket Hijacking (CSWSH) protection
│
├── setup.ts                           # Global JSDOM & React Testing Library setup
├── test-utils.ts                      # Shared test helper utilities & login helpers
├── vitest-global-setup.ts             # Process-level test orchestrator setup
├── vitest-worker-setup.ts             # Worker listener limit configuration
└── y-websocket.d.ts                   # Type definitions for WebSocket protocol
```

---

## ⚡ Master Test Suite CLI Commands (`test.sh`)

```bash
# Target system environment configuration (Default: Deployed Oracle Cloud VM)
export NEXUS_BASE_URL="http://129.154.39.198/ide"

# 1. Running standard test suites via master orchestrator:
bash test.sh              # Fast mode: Runs all unit, service, DB & integration suites cleanly
bash test.sh --e2e        # E2E mode: Runs Playwright browser specs against VM
bash test.sh --all        # Full mode: Runs all 47 master test suites end-to-end

# 2. Individual Category Flags:
bash test.sh --property       # Fast-check property-based CRDT fuzzing
bash test.sh --idempotency    # Stripe-standard update replay & idempotency
bash test.sh --chaos          # Fault injection & infrastructure recovery
bash test.sh --contracts      # REST & WebSocket API schema contracts
bash test.sh --memory         # Heap memory leak & allocation benchmarks
bash test.sh --auth           # OAuth 2.0 & JWT security boundaries
bash test.sh --ws             # Raw WebSocket framing & close codes
bash test.sh --snapshot       # Merkle DAG integrity & snapshot restore
bash test.sh --migration      # Database schema & rollback safety
bash test.sh --rate-limiting  # API rate limiting & DDoS protection
bash test.sh --crdt-stress    # Large document CRDT stress
bash test.sh --pty-stress     # Terminal PTY buffer overflow & ANSI parser
bash test.sh --rbac-matrix    # Exhaustive 3x12 RBAC permissions matrix
bash test.sh --db             # PostgreSQL & Redis performance benchmarks (test-db.sh)
bash test.sh --security       # Container security & cgroup limits
bash test.sh --resilience     # Network flakiness & Redis failover
bash test.sh --timelapse      # Timelapse CRDT engine unit & E2E
bash test.sh --services       # Backend services unit tests
bash test.sh --integration    # REST API & Yjs WebSocket integration
bash test.sh --frontend       # React component unit tests
bash test.sh --latency        # Keystroke-to-Render (K2R) SLA & PTY stream throughput
bash test.sh --jepsen         # Jepsen split-brain SEC & RAM write-behind crash recovery
bash test.sh --pen-test       # Container terminal isolation, WS fuzzing & storage RBAC
```
