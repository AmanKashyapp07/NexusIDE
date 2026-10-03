# Project Mastery Guide: NexusIDE & MagnusCI

> **IIITA Placement Roadmap — Companion Document | Version 2**  
> *Systematic guide to verify, harden, measure, and defensibly present your two flagship engineering projects.*  
> *Target Timeline: October 2026 – June 2027 (~100 Total Engineering Hours)*

---
## Table of Contents

- [Executive Summary & Document Context](#executive-summary--document-context)
- [The Rigor Loop](#the-rigor-loop)
- [Section 1: What Your READMEs Already Show — Where You Are Today](#section-1-what-your-readmes-already-show--where-you-are-today)
  - [Architecture & Testing Comparison](#current-state-matrix)
  - [Genuinely Missing Gaps](#what-is-genuinely-missing)
- [Section 2: Claim Reconciliation — Fix These Before Any Interviewer Finds Them](#section-2-claim-reconciliation--fix-these-before-any-interviewer-finds-them)
  - [A. Resume versus README or Reality](#a-resume-versus-readme-or-reality)
  - [B. Inside the READMEs: Inconsistencies and Overclaims](#b-inside-the-readmes-inconsistencies-and-overclaims)
  - [C. Vocabulary Swap](#c-vocabulary-swap)
- [Section 3: Nine-Month Plan — The Plan at a Glance](#section-3-nine-month-plan--the-plan-at-a-glance)
  - [High-Level Schedule](#the-plan-at-a-glance)
  - [Time Budget & Workload Guidance](#weekly-time-allocation)
  - [Detailed Month-by-Month Action Plan](#detailed-month-by-month-execution-plan)
- [Section 4: Project 1 — NexusIDE Deep Dive](#section-4-project-1--nexuside-deep-dive)
  - [Architecture to Draw from Memory](#what-you-must-be-able-to-draw-from-memory-in-5-minutes-nexuside)
  - [Concepts to Master](#concepts-to-master-nexuside)
  - [Refinement Backlog](#refinement-backlog-nexuside)
  - [Failure Modes to Describe](#failure-modes-you-should-be-able-to-describe-nexuside)
  - [README Claims to Reproduce or Remove](#readme-claims-to-reproduce-or-remove-nexuside)
- [Section 5: Project 2 — MagnusCI Deep Dive](#section-5-project-2--magnusci-deep-dive)
  - [Architecture to Draw from Memory](#what-you-must-be-able-to-draw-from-memory-in-5-minutes-magnusci)
  - [Concepts to Master](#concepts-to-master-magnusci)
  - [Refinement Backlog](#refinement-backlog-magnusci)
  - [Failure Modes to Describe](#failure-modes-you-should-be-able-to-describe-magnusci)
  - [README Claims to Reproduce or Remove](#readme-claims-to-reproduce-or-remove-magnusci)
- [Section 6: README and Repository Polish — Make the Repository Easy to Judge](#section-6-readme-and-repository-polish--make-the-repository-easy-to-judge)
  - [The Top of Each README](#the-top-of-each-readme-about-15-lines)
  - [Suggested `docs/` Folder](#suggested-docs-folder)
  - [Quick Wins Checklist](#quick-wins)
- [Section 7: How to Prepare Deeply — Make Each Project Defensible](#section-7-how-to-prepare-deeply--make-each-project-defensible)
  - [Seven Layers of Knowledge](#seven-layers-of-knowledge)
  - [Artifacts to Create](#artifacts-to-create-one-set-per-project)
  - [The Four Practice Phases](#the-four-practice-phases)
  - [Self-Test Checklist](#self-test-can-you-do-these-without-notes)
- [Section 8: Presentation Strategy — How to Present to an Interviewer](#section-8-presentation-strategy--how-to-present-to-an-interviewer)
  - [Four Depths of the Same Project](#four-depths-of-the-same-project)
  - [The Two-Minute Pitch Structure & Scripts](#the-two-minute-pitch-structure)
  - [The Whiteboard Walkthrough Protocol](#the-whiteboard-walkthrough)
  - [How to Answer When Grilled](#how-to-answer-when-you-are-grilled)
  - [Flaw Responses & Mistakes to Avoid](#when-you-find-a-flaw-or-do-not-know)
  - [Interviewer Adaptation & Online Kit](#adapt-to-the-interviewer)
- [Section 9: Question Bank — What Interviewers Like to Grill](#section-9-question-bank--what-interviewers-like-to-grill)
  - [The Six Question Families](#the-six-question-families)
  - [NexusIDE Questions (22 Probes)](#nexuside-questions)
  - [MagnusCI Questions (22 Probes)](#magnusci-questions)
  - [Cross-Project Questions (13 Probes)](#questions-about-both-projects)
- [Section 10: Resume, Checklist, and Tracker — Turn the Work Into Resume Lines](#section-10-resume-checklist-and-tracker--turn-the-work-into-resume-lines)
  - [Quantified Resume Bullets](#turn-the-work-into-resume-lines)
  - [Definition of Done](#definition-of-done-for-each-project)
  - [Monthly Milestone Tracker](#monthly-tracker)

---

## Executive Summary & Document Context

> **What Changed After Reading Your READMEs & Auditing Codebases**
>
> **Your projects are further along than your resume suggests.** Both systems feature extensive test suites, resource limits, role checks or signature verification, live cloud deployments, and clean modular architectures. Consequently, your strategic objective shifts from *"building missing features"* to **"verifying, reconciling, measuring, hardening the genuine architectural gaps, and mastering defense"**.
>
> **The primary risk is overclaiming, not missing functionality.** The current READMEs and resume contain claims that conflict with each other or with underlying engineering realities (e.g., SHA-1 vs SHA-256, single-instance "Redlock", "0 ms cold start", "guaranteed zero host disk pollution"). An experienced interviewer will probe these immediately; one disproven claim instantly casts doubt on your legitimate accomplishments. Section 2 itemizes every reconciliation needed.

> **Codebase Verification & Ground Truth Audit**
>
> All architectural comparisons, hash functions, debounce parameters, lock implementations, role hierarchies, and scheduling algorithms in this document have been verified directly against the active source repositories (`/Users/amankashyap/Documents/nexusIDE` and `/Users/amankashyap/Documents/ci-cd-engine`). Speculative assumptions have been replaced with verified codebase facts and exact file references.

## The Rigor Loop

Apply this systematic engineering loop to every feature, bugfix, and performance claim before putting it on your resume:

| Step | What You Do | What You Can Show in Interviews |
| :---: | :--- | :--- |
| **1. Measure** | Record the baseline, with the method, before changing anything | A number plus how you got it |
| **2. Break** | Kill a process, drop a connection, flood an input, send bad data | A failure test and what happened |
| **3. Fix** | Make the system handle it deliberately | A design decision with a trade-off |
| **4. Test** | Automate it so it cannot regress | A passing test in CI |
| **5. Observe** | Add a log line, metric or health check that would reveal it | A dashboard or log sample |
| **6. Document** | Write the decision and the limit in two or three lines | A decision record in the repository |
| **7. Explain** | Say it aloud in two minutes | A rehearsed, confident answer |


---

## Section 1: What Your READMEs Already Show — Where You Are Today

The following matrix summarizes the claimed state of both repositories based on their documentation. Treat each entry as a claim to verify and defend:

### Current State Matrix

| Architectural Area | NexusIDE (Claimed State) | MagnusCI (Claimed State) |
| :---: | :--- | :--- |
| **Architecture** | Express and raw WebSocket gateway; Yjs CRDT sync; Redis Pub/Sub between pods; Redis lock before database saves; PostgreSQL BYTEA for CRDT state; Docker pool; LSP bridge | Webhook receiver; BullMQ queue; worker daemon; custom DAG scheduler; Docker sandboxes; MinIO cache; PostgreSQL; Socket.IO log stream; K3s deployment |
| **Testing** | Large multi-tier suite: unit, property-based CRDT, replay and idempotency, chaos, contract, memory, RBAC matrix, DB performance, Playwright E2E | Unit, integration, Kubernetes and Playwright E2E suites; chaos, load and stress, and sandbox security tests |
| **Security** | Docker limits (memory, CPU, PIDs); role checks at REST and socket layers; JWT and OAuth tests; path traversal defense | Docker socket kept from build containers; memory, CPU and PID limits; path traversal defense; secret redaction; HMAC signature check |
| **Observability** | Prometheus-format metrics endpoint: event loop lag, heap, sockets, queue depth | Health route; no metrics or dashboards described |
| **Operations** | PM2 on a VM; a pre-push hook that deploys; cleanup cron | K3s manifests; deploy script; cleanup script; Oracle Cloud VM |
| **Documentation** | Very detailed README; no limitations or trade-offs section | Very detailed README; no limitations or trade-offs section |
| **Numbers** | Many percentages, no stated method | Mostly qualitative claims, few numbers |


### What is Genuinely Missing

Rather than building new surface features, focus strictly on resolving these core architectural gaps:

#### NexusIDE Gaps
- **Measurement Methodology:** Document the benchmark method and raw output behind every claimed percentage.
- **Durability Window Specification:** Establish a written, quantified durability window: what edits are lost if a pod dies mid-edit.
- **Claim Consistency:** Reconcile conflicting claims across documentation and code (hash functions, debounce timings, lock naming).
- **Automated CI Gating:** Configure test suites to run automatically in CI with public, reproducible results shown.
- **Production Observability:** Deploy a monitoring dashboard and alerting rules on top of the existing Prometheus metrics endpoint.
- **Safe Deployment Pipeline:** Implement automated test gating and a rollback mechanism on the deployment hook.

#### MagnusCI Gaps
- **Webhook Idempotency:** Enforce delivery-ID deduplication with database unique constraints and TTL storage.
- **Backpressure & Saturation Bounds:** Implement explicit bounds for backpressure: worker concurrency caps, queue depth bounds, and documented shedding behavior.
- **Execution Guardrails:** Configure hard build timeouts, container network egress rules, and per-user build quotas.
- **Origin Isolation:** Enforce strict isolation of preview server outputs away from the primary dashboard origin.
- **HTTPS Realignment:** Provision valid TLS certificates to align live deployment URLs with README claims.
- **Reproducible Benchmarks:** Publish end-to-end benchmark numbers with documented test methodology and scripts.

> **Good News & Strategic Advantage**
>
> Many critical engineering capabilities that typical student projects lack already exist in your repositories: multi-tier test suites, container resource boundaries, Prometheus metrics endpoints, security role checks, chaos tests, automated cleanup scripts, and K3s manifests. Furthermore, your `nexusIDE` repository includes a root `magnus-ci.json` configuration file defining 24 parallel test stages (setup, unit, property, chaos, contracts, perf, typecheck, security, resilience, timelapse, integration, auth, etc.), enabling MagnusCI to build and test NexusIDE directly. Demonstrating this live dogfooding pipeline in an interview is an exceptionally compelling proof of real-world systems capability.

---

## Section 2: Claim Reconciliation — Fix These Before Any Interviewer Finds Them

Precision is your greatest competitive advantage. Inconsistencies between your resume and README destroy interviewer trust faster than missing features.

### A. Resume versus README or Reality

Resolve all conflicts between what is written on your resume and what the implementation actually does:

| Claimed Item | Resume Statement | README / Reality State | Verified Codebase Ground Truth & Prescribed Fix |
| :--- | :--- | :--- | :--- |
| **Hash function (NexusIDE)** | Resume: SHA-256 deduplication | README says SHA-1 blob and tree hashes in two places, and SHA-256 in the worker and tests | **Verified Code Truth:** 100% `SHA-256` is implemented across `cas.service.ts:89`, `casWorker.ts:33,43`, `snapshot.repository.ts:125`, and `merkle-integrity.test.ts:19-24`. SHA-1 does not exist anywhere in code; README mentions were documentation typos. **Fix:** Update README to state SHA-256 throughout. Resume statement of SHA-256 is already accurate. |
| **DAG scheduling algorithm (MagnusCI)** | Resume: Kahn's topological sort plus DFS | README describes DFS cycle detection and dependency-resolved scheduling; Kahn's is never named | **Verified Code Truth:** `ci-cd-engine/backend/src/utils/dag.js` uses recursive DFS with a recursion stack (`hasCycle`) for cycle rejection, and a dynamic parallel readiness frontier (`executeDAG` via `Promise.race`) for execution. Kahn's indegree queue is not used. **Fix:** Reword resume to: *'DAG pipeline scheduler with DFS cycle detection and dynamic parallel readiness frontier dispatch via Promise.race'*. |
| **Disk pollution (MagnusCI)** | Resume: 'guaranteed zero host disk pollution' | README: tmpfs workspaces with a fallback to /tmp, previews written to /tmp, images kept on the host, and a cleanup script for disk reclamation | **Verified Code Truth:** Containers run on tmpfs under `/dev/shm`, but cached Docker images and preview folders persist on host disk until purged. **Fix:** Reword resume to: *'ephemeral tmpfs workspaces, purged after every build, with scheduled automated host cleanup'*. |
| **Backpressure (MagnusCI)** | Resume: 'backpressure engine' | README describes queue decoupling, stalled-job reclaim and heartbeats; no queue bound, concurrency cap or load shedding | **Verified Code Truth:** BullMQ absorbs request bursts asynchronously, but true backpressure requires bounded queues and concurrency caps. **Fix:** Add concurrency caps and queue limits, or reword to: *'queue-based burst absorption with BullMQ retry backoff'*. |
| **Cloud provider** | Resume skills: Azure VM | README: Oracle Cloud VM | **Verified Code Truth:** System is deployed on Oracle Cloud Infrastructure (OCI) Ampere A1 VM. **Fix:** Align resume skills section to explicitly state Oracle Cloud VM. |
| **cgroups v2 (NexusIDE)** | Resume: Linux cgroups v2 | README: Docker memory, CPU and PID limits, plus pause and unpause | **Verified Code Truth:** Docker daemon enforces cgroup v2 limits (`cpu.cfs_quota_us`, `memory.limit_in_bytes`, `pids.max`). **Fix:** State accurately: *'cgroup v2 resource quotas enforced via Docker container runtime limits'*. |
| **'Predictive' pre-warming** | Resume: predictive daemon | README: a pool of idle containers, plus pre-warming when a user logs in to the dashboard | **Verified Code Truth:** The pre-warming trigger is a deterministic user login HTTP event combined with an idle pool target heuristic, not ML. **Fix:** State plainly: *'pre-warming container pool triggered by user authentication heuristics'*. |
| **Skills list** | GraphQL, MongoDB, Firebase, Stripe, Meilisearch, WebRTC | None of these appear in the READMEs; WebRTC is only a roadmap item | **Verified Code Truth:** Active stacks are TypeScript, Node.js, Express, Docker, PostgreSQL, Redis, Yjs, BullMQ, MinIO, K3s. **Fix:** Prune extraneous keywords from resume skills; retain only technologies present in the codebases. |


### B. Inside the READMEs: Inconsistencies and Overclaims

Correct internal contradictions, marketing exaggerations, and unverifiable statistics within the project READMEs:

| Location / Feature | Identified Inconsistency or Overclaim | Verified Codebase Ground Truth & Prescribed Fix |
| :--- | :--- | :--- |
| **NexusIDE: save debounce** | Three different values: write after 2 seconds of silence, cache invalidation at 800 ms, and an adaptive 300 to 2,500 ms window with a 5,000 ms ceiling | **Verified Code Truth:** `backend/src/services/adaptiveDebouncer.service.ts` implements `AdaptivePersistenceDebouncer`: `minDelayMs: 300` (idle pause), `baseDelayMs: 800` (standard delay), scaling dynamically up to `maxBurstDelayMs: 2500` during typing bursts (>5 edits/sec), with a hard ceiling `maxDeferralMs: 5000` (forced flush). The '2s' was a legacy prototype. **Fix:** Document these exact four parameters in the README. |
| **NexusIDE: 'Redlock'** | A single Redis instance with SET NX PX and a Lua release is the simple lock pattern, not the multi-node Redlock algorithm. 'Exactly one pod at any instant' overclaims, and your own learnings note that expiry can allow a second writer | **Verified Code Truth:** `backend/src/services/distributedLock.service.ts` uses single-instance Redis `SET lockKey POD_ID PX ttlMs NX` with an atomic Lua unlock script and an in-memory `Set<string>` fallback. It is not multi-node Redlock. **Fix:** Rename to *'Redis mutex with atomic Lua release and in-memory fallback'*. Document the requirement for optimistic database versioning (`WHERE version = :v`) or fencing tokens to protect against TTL expiry during slow database writes. |
| **NexusIDE: hibernation '90% RAM reduction'** | docker pause freezes processes using the cgroup freezer but does not release memory. The 10 GB to 1 GB saving in the README comes from sharing one container per workspace, not from pausing | **Verified Code Truth:** `docker pause` freezes process execution via the cgroup freezer, freeing CPU cycles but keeping allocated RAM resident in memory. The 90% RAM saving stems from sharing a single container across multiple workspace collaborators rather than spawning 1 container per user. **Fix:** Disentangle CPU pausing from container sharing in the README and benchmark with `docker stats`. |
| **NexusIDE: '0 ms', 'under 50 ms'** | '0 ms cold start' cannot be true; 'under 50 ms' needs a measured p95 | **Verified Code Truth:** Container attachment from the pre-warmed pool requires Docker network attach and PTY exec, which is physically non-zero. **Fix:** Report empirical pool claim latency (p50 and p95) compared against the ~1,200 ms cold-start baseline. |
| **NexusIDE: cursor codec** | '97.6 percent from 250 B to 8 B' is actually 96.8 percent (97.6 percent applies to 6 bytes). A 16-bit user hash collides as users grow (about a 2 percent chance at 50 users), and 16-bit line and column values cap at 65,535 | **Verified Code Truth:** `backend/src/services/cursorCodec.service.ts` bit-packs coordinates into an exact 8-byte frame (`[uint16 userHash, uint16 line, uint16 col, uint16 selectionLength]`). Bandwidth reduction from ~250 B JSON to 8 B is exactly 96.8% (`(250 - 8) / 250`). Coordinates clamp at 65,535; user hash collision probability is ~1.88% at 50 users (birthday paradox). **Fix:** Update README to 96.8% and document the 65,535 clamp and collision trade-off. |
| **NexusIDE: roles** | README says Admin, Editor, Viewer; the test suite says Owner, Editor, Viewer | **Verified Code Truth:** `backend/src/middleware/workspaceAuth.ts:5` defines `export type CollaboratorRole = 'viewer' | 'editor' | 'admin'` with hierarchy `{ viewer: 1, editor: 2, admin: 3 }`. Workspace `owner_id === userId` is the database resource owner, automatically granted `'admin'` privileges by the middleware. **Fix:** Standardize role definitions on `viewer`, `editor`, `admin`. Clarify that `owner` is a database entity relationship foreign key, not a separate role string. |
| **NexusIDE: 'mathematically proving' consistency** | Property-based tests give strong evidence, not a proof; the convergence guarantee comes from Yjs itself | **Verified Code Truth:** Convergence is guaranteed by the YATA CRDT mathematical model inside Yjs. NexusIDE's tests verify that application wrappers and Redis transport preserve convergence. **Fix:** Reword to: *'property-based tests empirically verify convergence, commutativity, and idempotency across N randomized concurrent edit sequences'*. |
| **NexusIDE: 'Netflix, Stripe, Google standard'** | Reads as marketing and invites a challenge you cannot win | **Verified Code Truth:** The test suite injects real network partitions, Redis reconnects, PTY crashes, and concurrent edits. **Fix:** Replace marketing labels with concrete test assertions (e.g., *'tested against Redis disconnects, PTY crashes, and out-of-order WebSocket packet drops'*). |
| **NexusIDE: alias-based command restriction** | Aliases are not a security control; a user can run the full binary path | **Verified Code Truth:** Shell aliases can be bypassed via `\command`, `/bin/command`, or shell builtins. **Fix:** Remove alias claims from security docs; highlight non-root container user, dropped capabilities (`--cap-drop=ALL`), seccomp filtering, and cgroup resource limits. |
| **NexusIDE: network isolation** | 'Strict egress controls' sits beside terminals running npm install, which needs outbound access | **Verified Code Truth:** Developer workspaces require internet egress for package installations (`npm`, `pip`, `cargo`). **Fix:** State honestly that outbound DNS/HTTPS is permitted for package registries while internal cloud metadata services (`169.254.169.254`) and RFC1918 private subnets are blocked. |
| **NexusIDE: timelapse vs compaction** | 'Per-keystroke attribution without data loss' conflicts with merging update rows into one state and deleting them | **Verified Code Truth:** Merging update deltas into a single binary state vector eliminates intermediate keystroke timestamps. **Fix:** Document that keystroke timelapse is available during active sessions, while database compaction consolidates deltas into point-in-time document snapshots. |
| **NexusIDE: pre-push deploy hook** | Deploys from your laptop before tests gate it, with no stated rollback | **Verified Code Truth:** Local pre-push hook deploys directly via SSH without gating on CI test completion. **Fix:** Transition deployment gating to MagnusCI pipeline triggered on merge to `main`. |
| **MagnusCI: 'SSL termination'** | The live URL is http, not https | **Verified Code Truth:** Deployment currently serves over HTTP port 80. **Fix:** Provision Let's Encrypt TLS certificate via cert-manager on K3s, or remove SSL termination claims until provisioned. |
| **MagnusCI: 'sub-millisecond delivery', 'zero-latency', 'instant', 'zero starvation or deadlocks'** | Unmeasurable or impossible as stated across a network and Redis adapter | **Verified Code Truth:** Redis adapter Pub/Sub and network serialization introduce measurable millisecond-tier latency. **Fix:** Replace absolute superlatives with measured p95 latencies from benchmark runs. |
| **MagnusCI: 'virtualized' terminal** | content-visibility skips rendering of offscreen content but the DOM nodes still exist; that is not virtualization | **Verified Code Truth:** CSS `content-visibility: auto` skips rendering work for offscreen DOM elements, but nodes remain allocated in the DOM tree. **Fix:** Accurately describe as *'offscreen rendering optimization via CSS content-visibility'*. |
| **Both: stale links** | View Repository, Report Issue and Live Demo point to the old repository names (ci-cd-engine, sandbox-ide); NexusIDE's 'Live Demo' points to the repository, not the demo | **Verified Code Truth:** Repository URLs and live demo links contain legacy names. **Fix:** Update all links across both READMEs to point to their active GitHub repositories and deployed IP/domain endpoints. |
| **Both: GitHub 'About' text** | Descriptions read only 'NexusIDE' and 'CI-CD Pipeline' | **Verified Code Truth:** Repository headers lack architectural summaries. **Fix:** Update repository descriptions with concise, descriptive summaries and relevant topics (e.g., `crdt`, `yjs`, `ci-cd`, `dag-scheduler`, `docker-sandboxing`). |


### C. Vocabulary Swap

Replace vague buzzwords with precise, defensible engineering terminology:

| Avoid (Vague Buzzwords) | Use Instead (Defensible Technical Language) |
| :--- | :--- |
| **enterprise-grade, production-ready** | 'deployed at [URL], tested with [suite names]' |
| **zero, 0 ms, instant, sub-millisecond, guaranteed** | 'p95 of [X] ms, measured by [method]' |
| **proves, mathematically** | 'property-based tests check' |
| **Netflix, Stripe or Google standard** | the specific failure the test injects |
| **backpressure (when it means buffering)** | 'queue-based burst absorption' unless limits exist |
| **Redlock (single instance)** | 'Redis lock with a TTL' |


> **Why Precision Matters More Than Another Feature**
>
> An interviewer who catches a single exaggerated claim will quietly discount every other bullet on your resume. Conversely, an engineer who explicitly documents system boundaries, failure points, and measured trade-offs earns immediate respect. Precision proves maturity.

---

## Section 3: Nine-Month Plan — The Plan at a Glance

This plan integrates with your IIITA placement preparation roadmap, utilizing ~3 hours per week from the STRETCH allocation. Month 9 serves as a dedicated buffer for interview season.

### The Plan at a Glance

| Month | Roadmap Alignment | Core Engineering Focus | Key Milestone Deliverable |
| :---: | :--- | :--- | :--- |
| **Oct** | Month 1: OOP, SOLID | Claim reconciliation sprint; run all test suites; baseline numbers with method | Corrected resume and README claims; baseline report |
| **Nov** | Month 2: DBMS | Data layer and durability: crash window, indexes, schema constraints | Durability note; EXPLAIN evidence; schema fixes |
| **Dec** | Month 3: OS | Reliability and load: idempotency, bounds, hibernation measurement | Chaos test log; load numbers; corrected RAM claim |
| **Jan** | Month 4: OS II; Mock 1 | Real-time correctness: resync demo, lock versioning, log stitching | Demo recording; lock fix; log offsets |
| **Feb** | Month 5: CN I | Protocols and algorithms: PTY flood, cursor codec limits, scheduler, auto-revert safety | Flood test; codec limits; algorithm note |
| **Mar** | Month 6: CN II; Mock 2 | Security: sandbox egress and timeouts, preview isolation, cache scope, credentials | Threat models for both projects |
| **Apr** | Month 7: HLD blocks | Operations: dashboards, probes, HTTPS, tests in CI (light month) | Dashboard; CI badge; capacity note |
| **May** | Month 8: HLD cases; Mock 3 | README restructure, decision records, limitations, mock grilling | Docs folder; recorded walkthrough |
| **Jun** | Month 9: mocks | Freeze, final numbers, resume, rehearsal | Numbers card; final resume |


### Weekly Time Allocation

> **Target: ~3 Hours Per Week**
>
> - **Fix or Build (90 mins):** Code repairs, idempotency fixes, and schema constraints.
>
> - **Measure or Test (60 mins):** Benchmarking, failure injection, and automated test writing.
>
> - **Defend (30 mins):** Answer 3 to 5 questions aloud from Section 9 without notes.
>
> *Note: Weekly commitment drops to 2 hours in April and 1–2 hours in June.*

> **Check Your Total Workload**
>
> Core roadmap (12 hrs) + DSA & communication (~2 hrs) + Systems hardening (~3 hrs). If your total academic and prep load becomes unsustainable, shrink the optional AI elective lane first; **never drop claim reconciliation, baseline metrics, or failure drills**.


### Detailed Month-by-Month Execution Plan

#### Month 1: October (Oct) — Claim Reconciliation & Baseline Benchmarks

- **Roadmap Alignment:** `OOP & SOLID Principles`  
- **Weekly Allocation:** `3 hrs/week`  
- **NexusIDE Tasks:**
  - Work through every row of Section 2 against the code
  - Run the full test suite; record pass counts and duration
  - Fix README links and the About text
  - Baseline benchmark scripts with written method
- **MagnusCI Tasks:**
  - Work through every row of Section 2 against the code
  - Run the full test suite; record results
  - Verify dag.js execution: confirm DFS recursion-stack cycle detection (hasCycle) and dynamic parallel readiness frontier dispatch (executeDAG); remove Kahn's from resume; check HTTPS status
  - Baseline load script; host disk before and after 20 builds
- **Tangible Evidence to Produce:** *Corrected resume lines; baseline report with method for each project*

---

#### Month 2: November (Nov) — Data Layer, Schemas & Durability

- **Roadmap Alignment:** `DBMS & Query Optimization`  
- **Weekly Allocation:** `3 hrs/week`  
- **NexusIDE Tasks:**
  - Document the durability window: AdaptivePersistenceDebouncer (300ms idle, 800ms base, 2500ms burst, 5000ms ceiling), Redis write-behind queue, and Redis persistence settings
  - Kill a pod mid-edit and measure what is lost
  - Reproduce the index claims with EXPLAIN ANALYZE before and after
  - Standardize on verified SHA-256 across all documentation (cas.service.ts, casWorker.ts, snapshot.repository.ts); eliminate legacy SHA-1 typos from README
- **MagnusCI Tasks:**
  - Model builds and stages as a state machine with allowed transitions
  - Unique constraint on webhook delivery ID
  - Verify the indexes the README names; cursor pagination for builds and logs
- **Tangible Evidence to Produce:** *Durability note with test result; EXPLAIN screenshots; state diagram*

---

#### Month 3: December (Dec) — Reliability, Bounds & Resource Measurement

- **Roadmap Alignment:** `Operating Systems I`  
- **Weekly Allocation:** `3 hrs/week`  
- **NexusIDE Tasks:**
  - Measure docker stats: normal, paused, shared container
  - Measure pool claim latency p50 and p95 against cold start
  - Document the pool sizing rule
- **MagnusCI Tasks:**
  - Idempotency by delivery ID plus a stable job ID; replay test
  - Concurrency cap and queue limit with defined behavior at the limit
  - Run existing load and stress tests; save the numbers
  - Kill -9 a worker mid-build
- **Tangible Evidence to Produce:** *Corrected RAM claim; pool numbers; zero duplicate builds across N redeliveries*

---

#### Month 4: January (Jan) — Real-Time Synchronization & Distributed Correctness

- **Roadmap Alignment:** `Operating Systems II & Mock 1`  
- **Weekly Allocation:** `3 hrs/week`  
- **NexusIDE Tasks:**
  - Record a demo: reconnect and state-vector resync
  - Add optimistic version check (WHERE version = :v) or fencing token to PostgreSQL save path to prevent late writes upon Redis lock TTL expiration
  - Document Redis Pub/Sub loss behavior
- **MagnusCI Tasks:**
  - Log stitching: sequence offsets so history plus live stream has no gaps or duplicates
  - Graceful SIGTERM shutdown test
- **Tangible Evidence to Produce:** *Resync demo; lock test; log offset test. Mock 1 this month*

---

#### Month 5: February (Feb) — Protocols, Codecs & Execution Algorithms

- **Roadmap Alignment:** `Computer Networks I`  
- **Weekly Allocation:** `3 hrs/week`  
- **NexusIDE Tasks:**
  - PTY flood benchmark
  - Cursor codec: document verified 96.8% reduction (250 B JSON to 8 B binary frame), 65,535 coordinate clamp, and 16-bit user hash collision handling
  - Test timelapse after compaction
- **MagnusCI Tasks:**
  - Scheduler: test dynamic parallel readiness frontier (executeDAG) under failure, cancellation, and concurrency caps
  - Auto-revert safety review: flaky tests, races, permissions, opt-in per repository
- **Tangible Evidence to Produce:** *Flood result; codec limits note; scheduler and revert notes*

---

#### Month 6: March (Mar) — Security Hardening, Egress & Threat Modeling

- **Roadmap Alignment:** `Computer Networks II & Mock 2`  
- **Weekly Allocation:** `3 hrs/week`  
- **NexusIDE Tasks:**
  - Sandbox review: non-root, capabilities, seccomp, egress rules
  - Git credentials inside a shared container: who can read them
  - Protect the metrics endpoint
- **MagnusCI Tasks:**
  - Build timeouts; network egress policy; per-user quotas
  - Preview isolation: separate origin, CSP, no session cookies
  - Cache scope: no sharing across repositories or fork pull requests
  - docker.sock threat model for the worker
- **Tangible Evidence to Produce:** *Two threat-model pages and a list of attacks tried. Mock 2 this month*

---

#### Month 7: April (Apr) — Observability, Dashboards & Production Operations

- **Roadmap Alignment:** `High-Level Design Blocks`  
- **Weekly Allocation:** `2 hrs/week`  
- **NexusIDE Tasks:**
  - Dashboard and alerts on the metrics endpoint
  - Add a test gate and rollback to the deploy flow
  - Structured logs
- **MagnusCI Tasks:**
  - Expose metrics; dashboard
  - Probes, resource limits, graceful termination on K3s
  - HTTPS
  - Run the test suites inside MagnusCI itself
- **Tangible Evidence to Produce:** *Dashboard screenshots; CI badge; capacity note. Light month for the MCQ sprint*

---

#### Month 8: May (May) — Documentation Restructure & Interview Defense

- **Roadmap Alignment:** `High-Level Design Cases & Mock 3`  
- **Weekly Allocation:** `3 hrs/week`  
- **NexusIDE Tasks:**
  - Restructure the README: summary, architecture, decisions, measured results, limitations
  - Ten decision records and three sequence diagrams
  - Rehearse the four versions
- **MagnusCI Tasks:**
  - Same for MagnusCI
  - Mock grilling session with a senior
  - Optional: LLM-based build-failure explainer if the AI gate was passed
- **Tangible Evidence to Produce:** *Docs folder in each repository; recorded 5-minute walkthrough. Mock 3 this month*

---

#### Month 9: June (Jun) — Freeze, Metrics Card & Final Rehearsals

- **Roadmap Alignment:** `Placement Mocks & Freeze`  
- **Weekly Allocation:** `1 to 2 hrs/week`  
- **NexusIDE Tasks:**
  - Freeze features; re-run benchmarks once
- **MagnusCI Tasks:**
  - Final README, 2-minute demo video, numbers card
- **Tangible Evidence to Produce:** *Final resume bullets; rehearsed answers; no new features*


---

## Section 4: Project 1 — NexusIDE Deep Dive

**Core Architecture:** Collaborative web-based IDE powered by Yjs CRDTs, multi-pod synchronization via Redis Pub/Sub, isolated Docker execution sandboxes, and a Language Server Protocol (LSP) bridge.

### What You Must Be Able to Draw from Memory in 5 Minutes (NexusIDE)

In a technical interview, be prepared to whiteboard the following component hierarchy immediately:

- **Client Tier:** Browser client with Monaco Editor, xterm.js terminal emulator, and Yjs CRDT synchronization provider.

- **Gateway Tier:** Express HTTP server and raw WebSocket gateway managing connection lifecycles and authentication.

- **Pub/Sub Fabric:** Redis Pub/Sub mesh broadcasting document updates and cursor presence vectors across stateless pod instances.

- **Persistence Tier:** PostgreSQL database storing document snapshots with `BYTEA` binary state vectors and debounced write-behind queues.

- **Compute Tier:** Pre-warmed Docker container pool with cgroup limits (CPU, memory, PIDs) and per-user pseudo-terminals (PTYs).


### Concepts to Master (NexusIDE)

| Core System Concept | Expected Depth of Understanding | Typical Interview Probe |
| :--- | :--- | :--- |
| **Yjs CRDT sync** | Updates merge in any order and are idempotent, so duplicate delivery is harmless; state vectors give diffs; awareness (cursors) is a separate channel; deleted content is garbage-collected by default, which conflicts with history, so timelapse needs gc turned off | Why CRDT and not OT? What about tombstones? |
| **Pods hold documents in memory** | Pods are 'stateless' only in the sense that no sticky session is needed; each pod keeps live documents in memory and relies on Redis fan-out plus persistence. Know exactly what is lost if a pod dies | What is the data loss window? |
| **Redis Pub/Sub** | At-most-once delivery with no persistence; origin tagging prevents rebroadcast loops; recovery of missed updates comes from state-vector resync on reconnect; Redis Streams is the durable alternative | What if a pod misses a message? |
| **Redis lock before saves** | Single-instance Redis mutex (`SET NX PX ttl`) with `POD_ID` lease and atomic Lua release, with in-memory fallback (`distributedLock.service.ts`). If the lock expires during slow database I/O, a second writer can proceed; database-level optimistic versioning (`WHERE version = :v`) or fencing tokens are required for absolute write safety | Is it really Redlock? What if the TTL expires? |
| **Persistence pipeline** | `AdaptivePersistenceDebouncer` (300ms idle, 800ms base, 2500ms burst, 5000ms ceiling), Redis write-behind queue, delta compaction into single state vector, and disk archival; know each stage and its failure mode | What do you lose on a crash? |
| **Warm pool and sharing** | One container per workspace shared by collaborators; separate exec PTYs per user; pool of pre-created containers; pool size roughly arrival rate times provisioning time plus headroom | How did you size the pool? |
| **Hibernation** | docker pause uses the cgroup freezer: processes stop, memory stays allocated. It saves CPU, not RAM | Where does the RAM saving really come from? |
| **Sandboxing** | Docker memory, CPU and PID limits; non-root; network policy; containers share the host kernel, so a micro-VM is the stronger boundary; shared containers mean collaborators share files and credentials | Can code escape? Can one editor harm another? |
| **Merkle DAG and CAS** | Content-addressed blobs, trees and snapshots using SHA-256 (`cas.service.ts`); unchanged subtrees skipped via hash comparison; snapshots capped at 10; mark-and-sweep garbage collection for orphaned objects | Why SHA-256 over Git's SHA-1? How is GC made safe? |
| **Performance engineering** | Worker threads for CPU work; covering indexes and prepared statements; UNNEST bulk insert; WebSocket buffer limits; micro-batching; code splitting | How did you measure each claim? |


### Refinement Backlog (NexusIDE)

| Feature Area | README Status | Required Task | Verifiable Evidence | Priority |
| :--- | :---: | :--- | :--- | :---: |
| **Claims** | `Inconsistent` | Resolve every NexusIDE row of Section 2 | Clean README and resume | `MUST` |
| **Numbers** | `No Method` | Reproduce each percentage with a script; keep raw output | Reproduce-or-remove table below | `MUST` |
| **Durability** | `Partial` | Document debounce, write-behind and Redis persistence; kill a pod mid-edit | Test result and one-page note | `MUST` |
| **Lock safety** | `Exists` | Add version check or fencing token; rename to Redis lock | Test of a late writer | `MUST` |
| **Resync** | `Exists (Tests)` | Record a demo of reconnect and state-vector resync | Short video | `MUST` |
| **Hibernation** | `Exists` | Measure memory before and after pause and sharing; correct the claim | docker stats table | `MUST` |
| **Tests in CI** | `Exists Locally` | Run the suites in MagnusCI; show results; drop 'X-standard' labels | CI badge and run log | `MUST` |
| **Sandbox** | `Partial` | Verify non-root, capabilities, seccomp, egress rules; remove alias claim; shared-credential review | Threat-model page | `MUST` |
| **Timelapse** | `Unclear` | Test history after compaction; document what survives | Test and note | `SHOULD` |
| **Cursor codec** | `Exists` | Correct arithmetic to 96.8% (250B to 8B frame); document 65,535 clamp and 16-bit user hash collision handling | Unit test of limits | `SHOULD` |
| **Observability** | `Metrics Exist` | Dashboard and alerts; protect the endpoint; structured logs | Screenshots | `SHOULD` |
| **CAS garbage collection** | `Exists` | Test safety against in-flight snapshot creation | Concurrency test | `SHOULD` |
| **Deploy** | `Pre-Push Hook` | Add test gate and rollback; or deploy through MagnusCI | Pipeline run | `SHOULD` |
| **microVM isolation** | `Roadmap` | Write a design note comparing Firecracker or gVisor with Docker | Comparison note | `STRETCH` |
| **Durable relay** | `Not Present` | Evaluate Redis Streams for update delivery | Comparison note | `STRETCH` |


### Failure Modes You Should Be Able to Describe (NexusIDE)

| Failure Scenario | Desired System Behavior | Verification & Testing Method |
| :--- | :--- | :--- |
| **A pod is killed during editing** | Clients reconnect to another pod and resync; loss limited to the documented window | Kill pod; compare documents |
| **Redis disconnects or drops messages** | Pods converge on next sync; fallback behavior as documented | Restart Redis during edits |
| **A client disconnects and returns** | Receives only the missing updates | Throttle then restore the network |
| **A lock expires mid-save** | A late writer cannot overwrite newer data | Pause the saver beyond the TTL |
| **Database unavailable** | Editing continues in memory; writes retried; clear message | Stop Postgres briefly |
| **A container crashes or hangs** | User told; new container attached; orphans reaped | Kill the container |
| **Fork bomb, memory hog or CPU spin** | Limited by Docker limits; neighbors unaffected | Stress script in a container |
| **A command floods the terminal** | Buffering and backpressure keep the browser responsive | Run a command printing endlessly |
| **Snapshot restore while users are editing** | All pods evict stale documents; no stale overwrite | Restore during active typing |


### README Claims to Reproduce or Remove (NexusIDE)

| Documented Metric / Claim | Source Location in README | How to Empirically Benchmark / Verify |
| :--- | :--- | :--- |
| **Pool claim 'under 50 ms' vs cold 800 to 1,500 ms** | Warm pool section | Time N claims and N cold starts; report p50 and p95 |
| **Main bundle 4.68 MB to 609 KB** | Optimizations table | Build with and without manual chunks; save the output |
| **Scaffolding 120 ms to 4 ms** | UNNEST inserts | Loop 100 times with sequential INSERT vs UNNEST on one machine |
| **Query 12 ms to under 1 ms; 40 to 60 percent less overhead** | Indexes and prepared statements | EXPLAIN ANALYZE before and after; repeat 1,000 times |
| **About 75 percent fewer write IOPS** | Adaptive debouncer | Count UPDATEs per 1,000 keystrokes with and without it |
| **Over 80 percent smaller table after compaction** | CRDT compactor | pg_total_relation_size before and after |
| **Cursor frame 250 B to 8 B** | Binary codec | Byte-count real JSON and binary payloads (96.8% reduction) |
| **Up to 90 percent fewer frames** | Coalescing and batching | Count frames with and without |
| **90 percent RAM reduction** | Hibernation and sharing | docker stats for each case |
| **Cross-pod propagation 'sub-5 ms'** | Redis mesh | Two pods, timestamped test client, report p95 |


---

## Section 5: Project 2 — MagnusCI Deep Dive

**Core Architecture:** Container-native CI/CD pipeline engine utilizing HMAC-signed GitHub webhooks, BullMQ job queues, custom DAG scheduler with cycle detection, tmpfs Docker execution sandboxes, MinIO build caching, and real-time Socket.IO log streaming deployed on K3s.

### What You Must Be Able to Draw from Memory in 5 Minutes (MagnusCI)

Whiteboard this end-to-end event and execution pipeline seamlessly:

- **Ingress & Authentication:** API Gateway with constant-time HMAC-SHA256 signature verification over raw request bytes.

- **Queue & Orchestration:** BullMQ queue on Redis providing burst absorption, retry backoff, and stalled-job recovery.

- **Scheduler Engine:** Worker daemon executing DFS recursion-stack cycle detection (`hasCycle`) and dynamic parallel readiness frontier dispatch via `Promise.race` (`executeDAG`).

- **Sandbox Execution:** Ephemeral Docker containers mounting `tmpfs` workspaces with strict CPU, RAM, and PID cgroup constraints.

- **Caching & Artifacts:** S3-compatible MinIO object storage storing zstd-compressed dependency caches keyed by lockfile hash.

- **Log Streaming:** Socket.IO rooms over Redis adapter streaming live PTY output with sequence-offset history stitching.


### Concepts to Master (MagnusCI)

| Core System Concept | Expected Depth of Understanding | Typical Interview Probe |
| :--- | :--- | :--- |
| **Webhook ingestion** | Acknowledge fast and process later; the signature covers the raw body, so verify before parsing; constant-time comparison; the signature does not stop replays, so use the delivery ID header and check GitHub's current docs | Can an attacker replay a valid webhook? |
| **BullMQ semantics** | At-least-once delivery; stalled jobs are reclaimed and retried; custom job IDs can act as a dedupe key (check behavior after completion); concurrency and rate limits are settings you choose | A worker dies mid-build. Duplicate builds? |
| **Backpressure** | A queue absorbs bursts; backpressure means limiting intake or work when the system is saturated: bounded queue, concurrency cap, 429 or 503, coalescing superseded builds | What limits you at 10x? |
| **DAG scheduling** | Cycle rejection via recursive DFS with recursion stack tracking (`hasCycle`). Stage dispatch uses a dynamic parallel readiness frontier (`executeDAG`): pending stages with satisfied dependencies run concurrently via `Promise.race`, avoiding static topological queue stalls ($O(V+E)$) | Why dynamic readiness frontier instead of static Kahn's topological sort? |
| **tmpfs workspaces** | Builds live in RAM under /dev/shm, with fallback to /tmp; large builds compete for memory; atomic purge afterward | What if a build needs more RAM than the host has? |
| **Sandboxing** | Sandboxes never receive the Docker socket; the worker does, which makes the worker root-equivalent on the node; limits on memory, CPU and PIDs; no timeouts or egress rules are described | What protects the host from a malicious build? |
| **CI-specific security** | Fork pull requests are untrusted; caches keyed only by lockfile hash can be poisoned; preview output served from the app's own origin can run scripts with the app's privileges; auto-revert has write access to main | Can a pull request attack your system? |
| **Caching and speed** | Lockfile fingerprint keys; zstd with multi-threading; image presence check on the host; shallow clones | How much faster, and measured how? |
| **Log streaming** | Socket.IO rooms through the Redis adapter (Pub/Sub, at-most-once); debounced persistence to Postgres; stitching history with the live stream needs sequence offsets | Joining mid-build: gaps or duplicates? |
| **Auto-revert and loop guard** | Commit signatures break infinite triggers; reverting on a failed main build can revert a good commit if the test is flaky or if newer commits landed | When is auto-revert dangerous? |


### Refinement Backlog (MagnusCI)

| Feature Area | README Status | Required Task | Verifiable Evidence | Priority |
| :--- | :---: | :--- | :--- | :---: |
| **Claims** | `Inconsistent` | Resolve every MagnusCI row of Section 2 | Clean README and resume | `MUST` |
| **Numbers** | `Few Numbers` | Run existing load tests; publish webhooks per second, queue depth, drain time, start latency | Graphs with method | `MUST` |
| **Idempotency** | `Not Described` | Dedupe by delivery ID; stable job ID; unique constraint; replay test | Zero duplicates across N redeliveries | `MUST` |
| **Backpressure bounds** | `Not Described` | Concurrency cap, queue limit, defined behavior at the limit, coalesce superseded builds | Load test at the limit | `MUST` |
| **Sandbox limits** | `Partial` | Build timeouts, egress policy, per-user quotas, non-root user | Attack test list | `MUST` |
| **Preview isolation** | `Security Risk` | Serve previews from a separate origin with a strict CSP and no session cookies | Header check and test | `MUST` |
| **Tests in CI** | `Exists Locally` | Run suites in MagnusCI itself and show a pipeline run | CI badge and log | `MUST` |
| **Scheduler** | `Exists` | Verify dynamic readiness frontier; test stage failure, cancellation, and concurrency caps | Test suite | `SHOULD` |
| **Cache scope** | `Unclear` | Key caches by repository and trust level; never share with fork PRs | Test | `SHOULD` |
| **docker.sock risk** | `Acknowledged` | Threat model; compare rootless, Sysbox or Kaniko options | Design note | `SHOULD` |
| **Auto-revert safety** | `Exists` | Opt-in per repository, main branch only, retry before reverting, handle newer commits | Design note and test | `SHOULD` |
| **Log offsets** | `Not Described` | Sequence offsets; resume after disconnect | Reconnect test | `SHOULD` |
| **Data model** | `Indexes Exist` | State machine; delivery ID uniqueness; cursor pagination | Schema doc | `SHOULD` |
| **Kubernetes** | `Manifests Exist` | Probes, limits, graceful termination for workers | Manifest and test | `SHOULD` |
| **HTTPS** | `Claimed (Live HTTP)` | Add a domain and TLS, or remove the claim | Browser check | `SHOULD` |
| **Kubernetes Jobs** | `Roadmap` | Design note for one ephemeral Job per build | Design note | `STRETCH` |


### Failure Modes You Should Be Able to Describe (MagnusCI)

| Failure Scenario | Desired System Behavior | Verification & Testing Method |
| :--- | :--- | :--- |
| **A worker is killed mid-build** | Job reclaimed or failed cleanly; container removed; status correct | kill -9 during a build |
| **The same webhook arrives twice** | One build only | Redeliver or replay locally |
| **Invalid or missing signature** | Rejected before parsing or queuing | Send tampered payloads |
| **A burst of webhooks** | Fast acknowledgment; bounded queue and workers; defined drain time | Load script |
| **Redis is down** | Receiver returns an error so GitHub can redeliver; reconciliation from the database | Stop Redis |
| **Postgres is down** | Clear failure; no silent state loss | Stop the database briefly |
| **Malicious or runaway build** | Timeout, limits, no host access, restricted network | Infinite loop, disk fill, network scan |
| **Cyclic pipeline definition** | Rejected before any container starts | Submit a cycle |
| **A failing test on main** | Revert only under the documented conditions | Flaky test scenario |
| **Log client disconnects** | Resumes from last offset; build unaffected | Drop the connection |


### README Claims to Reproduce or Remove (MagnusCI)

| Documented Metric / Claim | Source Location in README | How to Empirically Benchmark / Verify |
| :--- | :--- | :--- |
| **Absorbs bursts; zero pool exhaustion** | Backpressure and pool rows | Load script: rate, ack latency, queue depth, drain time |
| **Instant stage execution (image check vs pull)** | Cache bypass | Time docker pull vs a local image inspect on the same host |
| **Faster tests on tmpfs** | Workspace allocator | Same repository on tmpfs vs disk; report medians |
| **Faster cache with zstd -T0 vs gzip** | Zstd cache | Compress and decompress the same dependency folder; time and size |
| **Shallow clone saves I/O** | Git ingestion | Bytes and time for shallow vs full clone |
| **Parallel DAG execution** | Scheduler | Same DAG run in parallel vs sequential |
| **Sub-millisecond log delivery** | WebSocket streaming | Timestamps from container to browser; report p95 |
| **No host disk pollution** | Resume claim | du before and after N builds, and after cleanup |


---

## Section 6: README and Repository Polish — Make the Repository Easy to Judge

Recruiters and hiring managers spend an average of 45 seconds scanning a repository. Replace walls of unstructured feature tables with high-impact architectural clarity.

### The Top of Each README (~15 Lines)

| README Block | Recommended Content |
| :---: | :--- |
| **One-line description** | What it is and the hardest problem it solves |
| **Live link and demo** | Working HTTPS URL and a 30-second GIF or video |
| **Architecture picture** | One clean diagram |
| **Three key decisions** | Each with the alternative you rejected and why |
| **Measured results** | Five numbers, each linking to a benchmark page with method and hardware |
| **Known limitations** | Honest list: what it does not do and where it would break |
| **How to run tests** | One command and the expected summary |


### Suggested `docs/` Folder

Move secondary tables, deep dives, and benchmarks into dedicated markdown documents:

- **`architecture.md`:** components, flows, sequence diagrams.
- **`decisions/`:** ten short decision records (context, choice, alternatives, trade-off).
- **`benchmarks.md`:** method, hardware, raw output and results.
- **`threat-model.md`:** assets, attackers, mitigations, and known gaps.
- **`limitations.md`:** durability window, scaling limits, unsupported cases.

### Quick Wins

- Fix stale links, and make the live links HTTPS.
- Write a real GitHub 'About' description and add topics. Pin both repositories on your profile.
- Add a license to NexusIDE if it has none, and show a CI badge.
- Move the long feature tables below the summary, or into docs.
- Keep the tone professional and specific: drop adjectives that cannot be measured.

---

## Section 7: How to Prepare Deeply — Make Each Project Defensible

Preparation requires mastering multiple levels of technical abstraction, from high-level trade-offs down to byte-level failure semantics.

### Seven Layers of Knowledge

| Knowledge Layer | The Critical Question You Must Answer |
| :---: | :--- |
| **What** | What does this component do, in one sentence? |
| **Why** | Why does it exist, and what problem does it solve? |
| **How** | How does it work internally, step by step? |
| **Failure** | What happens when it breaks, and how do you know? |
| **Scale** | What breaks first at 10x and 100x load? |
| **Security** | How could it be abused, and what stops that? |
| **Alternatives** | What else could you have used, and why not? |


### Artifacts to Create (One Set per Project)

- **One-pager:** problem, architecture picture, three decisions, key numbers.
- **Three sequence diagrams** for the key flows.
- **Ten decision records** and a **failure table** with the tests that prove each row.
- **Numbers card:** ten metrics you can quote, each with its method.
- **Limitations list** and a **'what I would change'** list of three items.
- **FAQ:** your own answers to the question bank in Section 9.

### The Four Practice Phases

| Practice Phase | Focus & Content | Recommended Cadence |
| :---: | :--- | :---: |
| **Understand** | Trace three flows line by line in code; explain every dependency and why you chose it | Month 1, then before each mock |
| **Break it** | Run the failure table: inject each failure and watch | Monthly, as each topic is built |
| **Defend it** | Answer 3 to 5 questions aloud in two minutes each; record and score with the communication scorecard | Weekly |
| **Present it** | Give the 5-minute walkthrough to a friend or senior; get one note | Fortnightly from April |


### Self-Test: Can You Do These Without Notes?

- [ ] Redraw both architectures in five minutes and narrate the numbered flows.
- [ ] Explain each major technology choice and one alternative you rejected.
- [ ] Quote your ten key numbers and how each was measured.
- [ ] Describe what happens when each major component fails, and show the test.
- [ ] Write the Merkle tree node structure and the dependency-resolving scheduler on a whiteboard.
- [ ] Answer 20 questions from Section 9 for each project without freezing.

---

## Section 8: Presentation Strategy — How to Present to an Interviewer

Tailor your presentation depth dynamically based on the interviewer's role, available time, and technical cues.

### Four Depths of the Same Project

| Depth Level | Duration | When to Deploy |
| :---: | :---: | :--- |
| **Headline** | 30 sec | Introduction; first mention on the resume |
| **Pitch** | 2 min | 'Tell me about this project' |
| **Walkthrough** | 5 min | Interviewer says 'draw the architecture' |
| **Deep dive** | 20 min | The interviewer chooses to grill; a project-focused round |


### The Two-Minute Pitch Structure

| Pitch Part | Content Guidelines |
| :---: | :--- |
| **Problem** | One sentence: what it solves and for whom |
| **What I built** | One sentence on the system and its main parts |
| **The hardest problem** | Two sentences on one real challenge and how you solved it |
| **Result** | One sentence with a measured number and the method |
| **What I would change** | One honest improvement or limitation |

#### Rehearsed Pitch Scripts

**NexusIDE Script (Fill brackets with measured numbers):**  

> *"NexusIDE is a browser-based collaborative IDE I deployed on a cloud VM. Collaborators edit the same files concurrently through Yjs CRDTs, each workspace runs inside an isolated container with per-user terminals, and multiple server pods stay synchronized via a Redis mesh. The hardest engineering problem was ensuring zero edit loss across network disconnections and pod crashes: I implemented debounced PostgreSQL persistence, a Redis write-behind queue, and vector-clock resync, verifying durability by killing pods mid-edit. Additionally, a warm container pool reduced workspace provisioning latency from [X] ms to [Y] ms at p95. If I redesigned it today, I would explore microVM isolation using Firecracker for stronger multi-tenant security."*

**MagnusCI Script (Fill brackets with measured numbers):**  

> *"MagnusCI is a container-based CI system I deployed on K3s. Inbound GitHub webhooks are verified via HMAC signatures, acknowledged immediately, and queued in BullMQ. A worker daemon resolves pipeline stage dependencies via a topological sort DAG and executes builds inside ephemeral Docker sandboxes while streaming logs via Socket.IO. The hardest engineering challenge was safely isolating untrusted builds while handling bursty webhook traffic: I built delivery-ID idempotency, concurrency caps, and tmpfs workspaces, stress-testing with [N] duplicate deliveries and [M] webhooks per second. I also dogfood MagnusCI to build and test NexusIDE. If I rebuilt it today, I would execute each stage as an ephemeral Kubernetes Job with strict network egress policies."*

### The Whiteboard Walkthrough

- **Draw the boxes first,** then number the flow and narrate it.
- **Finish with a handover:** 'Which part would you like to go deeper into?'
- **Plant hooks deliberately.** Mention one interesting trade-off and one failure case per project that you know deeply; interviewers tend to follow the thread you offer.
- **Say what is yours and what is a library.** Yjs, BullMQ, Docker, Redis and Socket.IO are tools; the sync layer, pool manager, Merkle store, scheduler and cache layer are your work.
- **State your limits first.** 'The known weakness is X' earns more trust than hearing it from the interviewer.

### How to Answer When You Are Grilled

When an interviewer digs deep into a specific component, adhere strictly to this 4-step framework:

| Framework Step | Response Pattern |
| :---: | :--- |
| **Answer** | Give the direct answer first, in one sentence |
| **Because** | The reason, in one or two sentences |
| **Trade-off** | 'The cost is X; an alternative is Y, which I did not choose because Z' |
| **Next step** | 'With more time I would...' |


### When You Find a Flaw or Do Not Know

When an interviewer uncovers an edge case or asks about an unmeasured metric, use these professional response patterns:

- *"Good catch. In that scenario the system does X, which is an architectural gap. The deliberate fix would be Y."*
- *"The README says X; the more precise statement based on the code implementation is Y."*
- *"I have measured X directly, but I haven't benchmarked Y yet, so I cannot give a precise number for Y."*
- **Core Rule:** Never defend an inaccurate or unverified claim. Acknowledging a system limit immediately establishes senior-level engineering maturity.

### Interview Mistakes to Avoid

- **Unsubstantiated Buzzwords:** Repeating README marketing adjectives you cannot back up with code or data.
- **Vague Scalability:** Saying *"it is scalable"* without quoting a measured throughput number or bottleneck limit.
- **Absolutes:** Using absolute words like *guaranteed*, *zero-latency*, or *always*.
- **Passing the Blame:** Blaming external libraries (e.g., Yjs, BullMQ, Redis) for architectural design choices.
- **Runaway Monologues:** Delivering a five-minute monologue without checking in; pause and verify interest every 90 seconds.
- **Defensiveness:** Getting defensive or arguing when challenged on an architectural trade-off.

### Adapt to the Interviewer

| Interviewer Profile | Recommended Presentation Strategy |
| :--- | :--- |
| **Senior backend engineer** | Go deep: failure modes, trade-offs, numbers. Let them pick the thread. |
| **Hiring manager or HR** | Use the 60-second version: problem, impact, what you learned. |
| **Interviewer short on time** | Headline plus the pitch; offer to go deeper on one area. |
| **Security-minded interviewer** | Lead with your threat model and known gaps. |


### Online Interview Kit

- Architecture diagram open in a tab, ready to share; README and docs one click away.
- A 2-minute demo video as a fallback; live demo only if stable, with seeded data. Check the live URL works before every interview.
- Numbers card on paper beside you. Show these only when asked.

---

## Section 9: Question Bank — What Interviewers Like to Grill

System design and backend interviewers repeatedly test six distinct questioning angles. Master each category for both projects:

### The Six Question Families

| Question Family | Example Question | Underlying Engineering Competency Tested |
| :---: | :--- | :--- |
| **What if it fails** | A worker dies mid-build. What happens? | Failure reasoning |
| **What if it grows** | Ten times the traffic? | Scaling intuition |
| **Why not X** | Why Redis Pub/Sub and not Streams? | Trade-off thinking |
| **How do you know** | Your README says 90 percent. How did you measure it? | Evidence, honesty |
| **How could it be abused** | Can a pull request attack your CI? | Security mindset |
| **What would you change** | What is the weakest part of this design? | Maturity |


### NexusIDE Questions (22 Probes)

| # | Question | Tests | A Strong Answer Includes |
| :-: | :--- | :---: | :--- |
| 1 | **Two users type in one file on different pods. Walk me through it.** | `Sync path` | Update, WebSocket, Redis relay, other pod applies; converges regardless of order |
| 2 | **Why CRDT and not operational transformation?** | `Trade-offs` | No central ordering for multi-pod; cost is metadata and tombstones |
| 3 | **Pub/Sub drops a message. What happens to edits?** | `Failure` | At-most-once; state-vector resync on reconnect; duplicates harmless; Streams if durability needed |
| 4 | **Your pods are 'stateless'. Where does state live?** | `Claim defense` | Pods hold documents in memory; no sticky session needed; persistence plus Redis; the crash window |
| 5 | **What exactly is lost if a pod dies mid-edit?** | `Durability` | `AdaptivePersistenceDebouncer` window (300ms idle to 2500ms burst, max 5000ms), uncommitted Redis write-behind queue updates, Redis persistence settings (AOF/RDB), measured loss under pod kill test |
| 6 | **Is your lock really Redlock? What if it expires mid-save?** | `Distributed locking` | Single-instance Redis mutex (`SET NX PX ttl`) with `POD_ID` lease and atomic Lua release (`inMemoryLocks` fallback); not multi-node Redlock. If TTL expires during a slow save, a second writer could proceed; database-level optimistic versioning (`WHERE version = :v`) or fencing tokens prevent stale overwrites |
| 7 | **Is the hash SHA-1 or SHA-256, and why?** | `Consistency` | Verified SHA-256 implemented across `cas.service.ts`, `casWorker.ts`, and `snapshot.repository.ts`. Mentions of SHA-1 in README were documentation typos. SHA-256 provides 256-bit collision resistance against chosen-prefix attacks, unlike Git's legacy SHA-1 |
| 8 | **Where does the 90 percent RAM saving come from?** | `Honest measurement` | Sharing containers across workspace collaborators, not pause; pause freezes CPU but keeps memory resident; measured via `docker stats` |
| 9 | **How does 'predictive' pre-warming predict?** | `Honesty` | User authentication trigger and pool target heuristic, hit rate, idle cost; heuristic, not ML |
| 10 | **How do you size the warm pool?** | `Quantitative` | Arrival rate times provisioning time plus headroom; cost cap |
| 11 | **Can code escape the container? Can one editor harm another?** | `Security` | Non-root, limits, network policy; shared kernel; shared files and credentials in a shared container |
| 12 | **Where are Git credentials, and who can read them?** | `Security` | Token location, scope, rotation, who has terminal access |
| 13 | **Your README says commands are restricted by aliases. Is that secure?** | `Security maturity` | No; aliases are bypassable; real controls are non-root, capabilities (`--cap-drop=ALL`), seccomp filtering, and cgroup limits |
| 14 | **How do you keep timelapse history if you compact updates?** | `Reconciling features` | What history survives; gc setting; point-in-time snapshots vs active session keystroke replay |
| 15 | **Explain the Merkle DAG. How is it different from Git?** | `Data structure` | Hash-addressed blobs, trees, commits using SHA-256; structural sharing; simplified snapshot capping at 10 |
| 16 | **How do you garbage collect objects while a snapshot is being created?** | `Concurrency` | Mark and sweep with a grace period or reference counts; tested race condition |
| 17 | **Your cursor codec uses a 16-bit user hash. Problems?** | `Edge cases` | 8-byte frame (`[uint16 userHash, line, col, len]`) cuts bandwidth by 96.8% vs ~250 B JSON. Trade-offs: 16-bit hash collides at ~1.88% probability for 50 users (birthday paradox); line/col capped at 65,535; fallback to JSON awareness if exceeded |
| 18 | **Property-based tests 'prove' consistency?** | `Precision` | They give strong evidence; the guarantee comes from Yjs YATA model; tests check convergence, commutativity, and idempotency over N random operations |
| 19 | **Browser cannot render as fast as terminal output arrives.** | `Backpressure` | Buffer thresholds, pause and resume, micro-batching, measured result |
| 20 | **Why does your deploy happen in a pre-push hook?** | `Engineering practice` | Honest reasons; the lack of a test gate and rollback; what you would change (migrate to MagnusCI) |
| 21 | **How would you serve 100,000 concurrent workspaces?** | `Scaling` | Connections per pod, fan-out cost, pool and scheduler, cost of idle containers |
| 22 | **What is the weakest part of this design?** | `Maturity` | An honest gap with a concrete plan |


### MagnusCI Questions (22 Probes)

| # | Question | Tests | A Strong Answer Includes |
| :-: | :--- | :---: | :--- |
| 1 | **Walk me through a push to a finished build.** | `End-to-end flow` | Webhook, verify, ack, enqueue, worker, scheduler, sandbox, logs, status |
| 2 | **How do you verify the signature? Why the raw body?** | `Security detail` | HMAC over raw bytes, constant-time compare (`crypto.timingSafeEqual`), reject before parsing |
| 3 | **Can an attacker replay a valid webhook?** | `Replay` | Delivery ID header (`x-github-delivery`) store with TTL in Redis; database unique constraint; idempotent processing |
| 4 | **BullMQ is at-least-once. How do you avoid duplicate builds?** | `Idempotency` | Stable job ID, unique constraint on delivery ID / commit hash, state transitions that ignore repeats |
| 5 | **A worker dies mid-build.** | `Failure` | Stalled-job reclaim, retry or fail, container cleanup, correct final status |
| 6 | **Your resume says 'backpressure'. What exactly is it?** | `Precision` | Bounded concurrency and queue, 429 or 503, coalescing, what happens at the limit |
| 7 | **What happens at 10x webhook rate?** | `Scaling` | Fast ack, queue depth and drain from your test, shedding policy |
| 8 | **How does the scheduler work? Do you use Kahn's algorithm?** | `Algorithm` | Implemented in `dag.js`: recursive DFS with recursion stack tracking (`hasCycle`) for $O(V+E)$ cycle rejection; `executeDAG` uses a dynamic parallel readiness frontier with `Promise.race` rather than Kahn's static indegree queue, dispatching newly unblocked stages immediately without waiting for static layers |
| 9 | **Define 'deadlock-free'.** | `Precision` | Acyclic graph prevents circular wait between stages; starvation still possible |
| 10 | **A middle stage fails. What happens?** | `Semantics` | Dependents held, independent branches finish, retry policy, cancellation |
| 11 | **A malicious build runs a miner or scans your network. What stops it?** | `Sandbox` | Timeouts, egress policy, quotas, limits; honest about what is missing |
| 12 | **The worker mounts docker.sock. Why is that dangerous, and what are alternatives?** | `Threat modeling` | Root-equivalent on the node; rootless, Sysbox, Kaniko, Kubernetes Jobs; your plan |
| 13 | **Can a pull request from a fork poison your dependency cache?** | `CI security` | Cache keyed only by lockfile is shared; scope by repository and trust level |
| 14 | **Previews are served under the same origin as the dashboard. Risk?** | `Web security` | Untrusted JavaScript with the app's privileges; separate origin, CSP, no cookies |
| 15 | **When is auto-revert dangerous?** | `Product judgment` | Flaky tests, newer commits, permissions; opt-in, retries, branch protection |
| 16 | **How do you guarantee no host disk pollution?** | `Claim defense` | You do not; tmpfs, purge, scheduled cleanup, image cache; measured du |
| 17 | **What if a build needs more RAM than the tmpfs workspace allows?** | `Resource limits` | Headroom check, fallback to disk, limits, failure mode |
| 18 | **Joining a build mid-way: how do history and live logs fit together?** | `Streaming` | Sequence offsets; no gaps or duplicates; resume after disconnect |
| 19 | **Why Redis and BullMQ and not Kafka, RabbitMQ or SQS?** | `Alternatives` | Built-in retries and delays; where it stops fitting; when you would switch |
| 20 | **What if Redis loses data?** | `Dependency` | Postgres as source of truth, reconciliation, GitHub redelivery |
| 21 | **Your README says SSL termination, but the live URL is http.** | `Honesty` | State of HTTPS today, and the plan |
| 22 | **How do you know your tests are meaningful?** | `Quality` | What each suite checks; CI results; known gaps |


### Questions About Both Projects (12 Probes)

| # | Question | Tests | A Strong Answer Includes |
| :-: | :--- | :---: | :--- |
| 1 | **Why microservices here? Would a monolith be better?** | `Judgment` | Honest reasons (isolation, scaling parts separately); costs; when a monolith is right |
| 2 | **Why p99 and not the average?** | `Metrics` | Tail latency affects real users; averages hide it |
| 3 | **What is the single point of failure?** | `Reliability` | Name it honestly and say how you would remove it |
| 4 | **How do you do zero-downtime deploys and migrations?** | `Operations` | Rolling updates, draining connections, backward-compatible migrations |
| 5 | **Logs, metrics, traces: when do you use each?** | `Observability` | Logs for events, metrics for trends and alerts, traces for cross-service latency |
| 6 | **How does authentication work, and where are tokens stored?** | `Security` | OAuth flow, JWT, storage location, expiry, revocation |
| 7 | **What was the hardest bug and how did you find it?** | `Debugging` | A real story: symptom, hypothesis, tool, fix, prevention (for example the Buffer byteOffset bug) |
| 8 | **What would it cost to run for 1,000 users?** | `Cost sense` | Rough compute, memory, Redis and storage estimate with assumptions |
| 9 | **You say you use MagnusCI on NexusIDE. Show me.** | `Credibility` | Root `magnus-ci.json` in nexusIDE defining 24 parallel test stages (property, chaos, contracts, perf, security, etc.); pipeline execution log; stage execution on tmpfs containers |
| 10 | **How do you know any number in your README is true?** | `Evidence` | Method, hardware, raw output, repeatability |
| 11 | **What is your biggest trade-off?** | `Maturity` | A real decision and what you gave up |
| 12 | **Which parts did you write yourself and which come from libraries?** | `Honesty` | A precise boundary between your code and tools |


---

## Section 10: Resume, Checklist, and Tracker — Turn the Work Into Resume Lines

Formulate every bullet with the **Action + What + How + Measured Result** structure. Only insert numbers once you have measured and documented them.

### Turn the Work Into Resume Lines

| Project | Recommended Resume Bullet Shape |
| :---: | :--- |
| **NexusIDE** | Built a collaborative cloud IDE: Yjs CRDT sync across [N] pods via Redis, per-workspace Docker containers with per-user PTYs, deployed on a cloud VM; [N] test suites including property-based CRDT and chaos tests. |
| **NexusIDE** | Cut workspace claim time from [X] ms to [Y] ms (p95) with a warm container pool, and reduced container memory per workspace by [Z] percent through shared workspace containers (docker stats, [N] users). |
| **NexusIDE** | Designed a Git-style Merkle DAG store with SHA-256 content addressing and garbage collection; deduplication saved [X] percent on [workload]. |
| **MagnusCI** | Built a container-based CI/CD system on K3s: signed GitHub webhooks, BullMQ queue, DAG-scheduled Docker stages, MinIO dependency cache; sustained [N] webhooks per second with [0] duplicate builds across [M] redeliveries. |
| **MagnusCI** | Scheduled multi-stage pipelines with dynamic parallel readiness frontier dispatch and DFS cycle detection, running independent stages in parallel ([k]x faster than sequential on [benchmark]). |
| **MagnusCI** | Isolated untrusted builds with non-root containers, memory, CPU and PID limits, timeouts and a restricted network; verified by [N] sandbox tests. |


> **Resume Polish Notes**
>
> Correct references to Azure VM to the specific cloud provider you actually deployed on (e.g. Oracle Cloud). Remove skills you cannot defend in a 10-minute deep dive (e.g. GraphQL, MongoDB, WebRTC if not implemented). Keep every bullet defensible against the standard probe: *"How did you measure that?"*

### Definition of Done for Each Project

- [ ] **Every row of Section 2 resolved in code, README and resume**
- [ ] **Baseline and final numbers recorded with method and raw output**
- [ ] **Reliability tests: kill, restart, duplicate, flood, expiry**
- [ ] **Threat-model page written and attacks tested**
- [ ] **Tests running in CI; metrics, logs and health probes in place**
- [ ] **README restructured; docs folder with decisions and limitations**
- [ ] **2-minute pitch and 5-minute walkthrough rehearsed; mock grilling done**
- [ ] **20 questions from Section 9 answered aloud without freezing**
- [ ] **Resume bullets rewritten with real numbers**

### Monthly Tracker

| Month | Target Engineering Milestone | Status / Verification Date |
| :---: | :--- | :---: |
| **Oct** | Claims reconciled; test runs recorded; baseline report | [ ]  ____ / ____ |
| **Nov** | Durability note; EXPLAIN evidence; schema constraints | [ ]  ____ / ____ |
| **Dec** | Idempotency and bounds; hibernation measurement; load numbers | [ ]  ____ / ____ |
| **Jan** | Resync demo; lock versioning; log offsets | [ ]  ____ / ____ |
| **Feb** | Flood test; codec limits; scheduler and revert notes | [ ]  ____ / ____ |
| **Mar** | Two threat models; egress, preview and cache fixes | [ ]  ____ / ____ |
| **Apr** | Dashboards; HTTPS; tests in CI; capacity note | [ ]  ____ / ____ |
| **May** | README restructured; docs folder; recorded walkthrough | [ ]  ____ / ____ |
| **Jun** | Numbers card; final resume; rehearsal | [ ]  ____ / ____ |
