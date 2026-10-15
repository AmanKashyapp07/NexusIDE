# NexusIDE — Implementation Plan (5-Phase Roadmap)
> Derived from `IIITA_Project_Mastery_Guide_NexusIDE_MagnusCI.docx` × current repo state  
> Objective: Systematic execution, metric verification, and defense-ready engineering.

---

## Legend
| Tag | Meaning |
|-----|---------|
| **MUST** | Non-negotiable before any interview |
| **SHOULD** | Strongly recommended |
| **STRETCH** | Do only if time allows |

---

## The 5 Implementation Phases

### **Phase 1: Claim Reconciliation & Baseline Verification**
> *Goal: Audit README/resume claims against reality, run existing suites, and produce reproducible baseline benchmarks.*

#### MUST
- [ ] **Run the full test suite** (`cd testing && npm test`) — record pass count, test duration, and any failing suites.
- [ ] **Baseline benchmark scripts** for every claimed metric (save raw terminal logs):
  - `pool claim <50ms vs cold 800–1500ms`: time N pool claims vs cold `docker run`, report p50 & p95.
  - `4.68 MB → 609 KB bundle`: build with/without `manualChunks` in [`frontend/vite.config.ts`](file:///Users/amankashyap/Documents/nexusIDE/frontend/vite.config.ts), log output sizes.
  - `120ms → 4ms UNNEST scaffolding`: benchmark 100× sequential `INSERT` vs `UNNEST` in database.
  - `95% fewer write IOPS`: record PostgreSQL `UPDATE` query frequency per 1,000 keystrokes with vs without debouncer.
  - `cross-pod propagation sub-5ms`: timestamped WS test client measuring fan-out across 2 backend instances via Redis Pub/Sub (report p95).
- [ ] **Fix README links**: "View Repository", "Report Issue", and "Live Demo" currently point to old repository names; update all links.
- [ ] **Fix GitHub About text**: Replace generic repo descriptions with a crisp one-line systems pitch and appropriate GitHub topic tags.

---

### **Phase 2: Durability, Persistence & Distributed State Correctness**
> *Goal: Eliminate data loss windows, ensure distributed lock safety, and prove storage optimizations.*

#### MUST
- [ ] **Document durability pipeline** in `docs/durability.md`:
  - Stage 1: Adaptive typing-velocity debouncing (300ms idle → 1000ms normal → 2000ms burst).
  - Stage 2: Redis write-behind buffer queue ([`crdtWriteBehind.service.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/services/crdtWriteBehind.service.ts)).
  - Stage 3: Distributed lock acquire → PostgreSQL write commit.
  - Stage 4: Redis persistence configuration (AOF vs RDB trade-offs and crash recovery boundary).
- [ ] **Kill-pod chaos test**: initiate active two-user typing session → abruptly execute `kill -9` on backend pod → measure keystrokes lost and verify resync on remaining pods.
- [ ] **EXPLAIN ANALYZE index proof**:
  - Run `EXPLAIN ANALYZE` on queries targeting `files` and `file_updates` with and without covering B-tree indexes.
  - Verify prepared statements latency improvement across 1,000 runs and capture terminal output/screenshots.
- [ ] **Resolve SHA-1 vs SHA-256 consistency**:
  - CAS engine uses SHA-256 in [`cas.service.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/services/cas.service.ts).
  - Verify `database/schema.sql` uses `VARCHAR(64)` for blob/tree hashes and align all documentation.
- [ ] **Add version check / fencing token to Redis lock** in [`distributedLock.service.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/services/distributedLock.service.ts):
  - Prevent late writers from overwriting newer document states if the lock TTL expires during a slow save.
  - Add monotonic `save_version BIGINT` column to `files`; use optimistic check `WHERE id=? AND save_version=?`.
- [ ] **Record resync demo**: record a short screencast demonstrating client network partition, offline editing, reconnection, and deterministic Yjs CRDT state-vector convergence.

---

### **Phase 3: Container Lifecycle, Sandbox Isolation & Protocol Limits**
> *Goal: Verify kernel-level resource controls, eliminate memory overclaims, and stress test streaming protocols.*

#### MUST
- [ ] **`docker stats` empirical verification**:
  1. Active workspace (1 user) — record baseline memory & CPU.
  2. Hibernated container via `container.pause()` — verify CPU drops to 0.00% while RAM remains allocated in kernel memory (correct any README claim stating pause frees RAM).
  3. Shared workspace container (multi-user) — measure RAM usage of 1 shared container vs N separate per-user containers to prove the ~80% memory reduction.
- [ ] **Instrument pool claim latency**:
  - Instrument `popTerminalContainer()` in [`backend/src/sandbox/pool.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/sandbox/pool.ts) to log latency histograms (p50, p95, p99).
  - Formally document pool sizing heuristic: `pool_size ≈ arrival_rate × provisioning_time + headroom`.
- [ ] **PTY flood stress test**: run high-throughput terminal flood (`cat /dev/urandom | base64`) inside container; measure browser `xterm.js` rendering rate, WebSocket frame drop, and backend event loop lag.

#### SHOULD
- [ ] **Cursor codec edge case & collision review** in [`cursorCodec.service.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/services/cursorCodec.service.ts):
  - Test 16-bit user hash collision probability under scale.
  - Verify line/column bounds behavior up to 65,535 coordinates; add unit test suite.
- [ ] **Timelapse post-compaction validation**:
  - Test [`crdtCompactor.service.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/services/crdtCompactor.service.ts) against [`TimelapseReplayer.tsx`](file:///Users/amankashyap/Documents/nexusIDE/frontend/src/components/Editor/TimelapseReplayer.tsx).
  - Document behavior of historical playback when tombstones are compacted.
- [ ] **Snapshot CAS concurrency test**:
  - Verify safe concurrent execution of snapshot creation and CAS garbage collection in [`casGarbageCollector.service.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/services/casGarbageCollector.service.ts).

---

### **Phase 4: Security Hardening, Observability & CI Automation**
> *Goal: Harden container execution boundaries, secure API surfaces, and establish operational observability.*

#### MUST
- [ ] **Write comprehensive threat model** (`docs/threat-model.md`):
  - Assets: user code, Git credentials, CRDT documents, PTY streams, host Docker daemon.
  - Attack vectors: container breakout, CPU/memory starvation, credential snooping in shared workspaces.
  - Verified mitigations: non-root execution (`User: "1000"`), `no-new-privileges`, seccomp default profile, cgroups v2 resource ceilings (`Memory: 1GB`, `CpuQuota: 150000`, `PidsLimit: 500`).
  - Known gaps & enterprise roadmap: Docker socket risk vs MicroVMs (Firecracker / gVisor), shared filesystem credentials.
- [ ] **Protect metrics endpoint**: verify authentication middleware on `GET /ide/api/metrics` in [`backend/src/routes/metrics.routes.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/routes/metrics.routes.ts).
- [ ] **Add automated test gate to deployment**:
  - Update `.githooks/pre-push` to run test suites prior to triggering build, rsync, and PM2 reload; abort on failure.
- [ ] **Run test suites in MagnusCI**:
  - Execute automated pipeline run for NexusIDE within MagnusCI; verify badge and attach execution log.

#### SHOULD
- [ ] **Run security & escape test suites**:
  - Execute `testing/security/` (`container-escape.test.ts`, `resource-exhaustion.test.ts`, `terminal-injection.test.ts`, `path-traversal.test.ts`).
- [ ] **Observability dashboard & structured logging**:
  - Standardize JSON structured logs in [`logger.service.ts`](file:///Users/amankashyap/Documents/nexusIDE/backend/src/services/logger.service.ts) with fields `timestamp`, `level`, `subsystem`, `traceId`.
  - Expose dashboard metrics for event loop lag, active PTYs, pool health, and Redis Pub/Sub latency.
- [ ] **Enforce HTTPS / TLS**:
  - Provision TLS certificate via Certbot/Nginx; eliminate any HTTP references in live URLs.

---

### **Phase 5: Architecture Documentation, ADRs & Interview Defense**
> *Goal: Structure repository documentation for recruiters, produce 10 ADRs, and master interview grilling.*

#### MUST
- [ ] **Restructure README.md**:
  1. 15-line executive summary + live deployment URL + system topology diagram.
  2. Verified numbers card (all 10 metrics with citations to `benchmarks.md`).
  3. Quickstart local installation guide.
  4. Move detailed reference tables to `docs/`.
- [ ] **Create structured `docs/` library**:
  - `architecture.md`: deep-dive architecture with 3 numbered sequence diagrams:
    1. Multi-pod collaborative edit fan-out via Redis Pub/Sub.
    2. Workspace container acquisition via WarmPoolManager and PTY attachment.
    3. Cluster-wide snapshot restore and stale document eviction.
  - `decisions/`: 10 Architecture Decision Records (ADRs) with Context, Alternatives, Trade-offs:
    1. Yjs CRDTs vs Operational Transformation (OT).
    2. Shared container per workspace vs per-user dedicated containers.
    3. Redis Pub/Sub vs Redis Streams for state broadcast.
    4. Dedicated `worker_threads` pool for SHA-256 Merkle tree hashing.
    5. Adaptive velocity-based debouncing vs fixed-interval persistence.
    6. Linux cgroups v2 `container.pause()` freezer vs process termination.
    7. Sparse keyframe caching ($K=25$) for document timelapse history.
    8. Redis distributed locking with fencing tokens vs PostgreSQL advisory locks.
    9. Pre-warmed container pooling vs just-in-time container provisioning.
    10. Rollup `manualChunks` vendor code-splitting strategy.
  - `benchmarks.md`: table of all measured metrics with test methodology, machine hardware specs, and reproducible command lines.
  - `limitations.md`: honest disclosure of durability window, single-node Redis SPOF, shared filesystem boundaries, and at-most-once delivery.
- [ ] **Finalize resume bullet points**:
  - Use format: `Action + Technical Mechanism + Measured Metric`.
  - Replace all bracketed placeholders with real, measured numbers.
- [ ] **Rehearse verbal presentation**:
  - Practice 2-minute elevator pitch, 5-minute whiteboard walkthrough, and drill the 20 technical grilling questions from the guide.

---

## Definition of Done Checklist

| Deliverable | Target Requirement | Status |
| :--- | :--- | :---: |
| **Claim Integrity** | Every metric in README/resume backed by an empirical benchmark script | [ ] |
| **Chaos & Resilience** | Pod kill, lock expiry, Redis disconnect, and network partition tested | [ ] |
| **Security Architecture** | Threat model written; non-root and cgroups limits verified in code | [ ] |
| **Continuous Integration** | Automated test gate on push; pipeline passing in MagnusCI | [ ] |
| **Documentation Standards**| Restructured README; `docs/` containing architecture, 10 ADRs, benchmarks, limitations | [ ] |
| **Presentation Mastery** | 2-min pitch, 5-min whiteboard walkthrough, and Section 9 question bank mastered | [ ] |

---

## Vocabulary to Fix Before Interviews

| Avoid Using | Replace With Accurate Systems Term | Rationale |
| :--- | :--- | :--- |
| `enterprise-grade` / `production-ready` | `deployed at [URL], tested across [N] suites` | Concrete facts carry more weight than buzzwords. |
| `zero latency` / `instant` / `guaranteed` | `p95 of [X] ms, measured by [script]` | Distributed systems have non-zero tail latency. |
| `mathematically proves consistency` | `property-based tests check convergence` | CRDTs guarantee convergence; your test suite validates implementation. |
| `Netflix / Stripe standard` | Name the exact failure injected (e.g. `SIGKILL mid-write`) | Specificity demonstrates direct engineering ownership. |
| `Redlock` (on a single Redis node) | `Redis lock with TTL and fencing token` | Redlock strictly refers to multi-master consensus across 3+ independent nodes. |
| `backpressure` (for unbound buffers) | `queue-based burst absorption` or `bounded WS drops` | Only use backpressure if explicit rate throttling or socket termination exists. |

---

## STRETCH Items (Post-Milestone)

- [ ] **MicroVM isolation design note** (`docs/decisions/microvm-vs-docker.md`): Architectural comparison of AWS Firecracker / Kata Containers vs Docker socket sandboxing.
- [ ] **Redis Streams evaluation** (`docs/decisions/redis-streams-vs-pubsub.md`): Deep dive into durable consumer groups vs at-most-once Pub/Sub for editor synchronization.
- [ ] **Copy-on-Write per-user workspace filesystem**: Evaluation of `overlayfs` layers for isolated collaborator file scratchpads inside a shared container.
