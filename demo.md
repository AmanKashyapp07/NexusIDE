# NexusIDE — VISA Internship Interview Playbook

> **Purpose:** A focused guide to presenting NexusIDE clearly, demonstrating the highest-value workflows, and defending the engineering decisions under follow-up questions.
>
> **Project:** [AmanKashyapp07/NexusIDE](https://github.com/AmanKashyapp07/NexusIDE) · [Live deployment](http://129.154.39.198/ide/login) · [Static showcase](https://amankashyapp07.github.io/NexusIDE/)

---

## 1. The story to communicate

**NexusIDE is a browser-based collaborative development environment.** It combines a VS Code-like editor, real-time multi-user editing, interactive terminals, language tooling, and workspace-level permissions in one cloud-hosted application.

The strongest interview story is not the number of features. It is the engineering problem behind making several users edit a shared document while keeping collaboration responsive, persisting changes, running code in a controlled environment, and managing access.

**Three themes to anchor the presentation:**

1. **Correctness:** concurrent edits must converge; permissions must be checked across API and real-time paths.
2. **Responsiveness:** frequent edits and cursor movement should not translate into unnecessarily expensive database writes or oversized network messages.
3. **Operational design:** workspaces need an execution environment, persistent state, observability, and recoverable startup/deployment paths.

> **Interview rule:** Explain what you personally implemented, how it works in the repository, how you tested it, and what trade-offs remain. Never present an unmeasured estimate as a benchmark or a design goal as a proven security guarantee.

---

## 2. The 30-second opening

Use this in your own voice rather than memorising it word for word:

> “I built NexusIDE, a browser-based collaborative IDE. The goal was to make coding together feel closer to editing a shared document, while still providing a real editor and terminal. The most technically interesting parts are synchronising concurrent edits, controlling the persistence path, and managing isolated workspace execution. I’ll first show the collaboration workflow, then explain the architecture and one or two design decisions in depth.”

Then open the prepared demo. Avoid opening with a list of every technology or performance number.

---

## 3. The live demo: 5–7 minutes

**The goal is to show one complete user journey.** Do not attempt to tour every feature. Keep two authenticated sessions ready before the interview, if possible.

| Time | Action | Say |
|---|---|---|
| 0:00–0:30 | Introduce the product and open the workspace | “This is a cloud development workspace rather than just a code editor embedded in a page.” |
| 0:30–1:15 | Show the file tree and Monaco editor | “The editor gives us a familiar coding surface; the application around it handles the workspace and collaboration.” |
| 1:15–2:30 | Open the same workspace in a second browser window; type a short change | “This is the key workflow: two clients edit the same document, and the synchronisation layer reconciles concurrent changes.” |
| 2:30–3:20 | Open the terminal and run a harmless command such as `pwd` or `node -v` | “The terminal is interactive and runs through the workspace's container-backed execution path.” |
| 3:20–4:00 | Show autocomplete/diagnostics only if already verified | “Language tooling is connected through the Language Server Protocol, so the editor can surface language-aware feedback.” |
| 4:00–4:45 | Create or inspect a snapshot only if the flow is reliable | “Snapshots use content-addressed storage so unchanged file content can be reused across revisions.” |
| 4:45–5:30 | Show one architectural boundary or relevant source file | “Here is the code that handles the part I just demonstrated.” |
| 5:30–6:00 | Summarise the trade-off and invite a deep dive | “The main trade-off I focused on was keeping collaboration responsive without treating every transient edit as an immediate database transaction.” |

### Demo discipline

- Let the behaviour prove the feature; explain the internals after the interviewer sees it.
- Demonstrate a feature only if it has passed the pre-flight check below.
- Use one small, obvious edit such as adding `// edited by collaborator` rather than writing a program live.
- Keep the GitHub repository open in another tab, with the relevant files bookmarked.
- If the interviewer interrupts with a question, stop the tour and answer it. Do not force completion of the script.
- Do not claim “zero latency,” “production-grade,” “secure against container escape,” or a specific percentage improvement without a test setup and evidence you can explain.

---

## 4. Pre-flight checklist

### The day before

- [ ] Start the app from a clean terminal using the repository's documented setup.
- [ ] Confirm database and Redis connections from actual startup logs.
- [ ] Log in with two separate sessions and open the same workspace.
- [ ] Edit the same document from both sessions and confirm that changes converge.
- [ ] Open a terminal and run a harmless command; confirm output and session cleanup.
- [ ] Test LSP autocomplete/hover in a supported language.
- [ ] Create and restore/inspect a snapshot if snapshot functionality will be shown.
- [ ] Confirm the live deployment works from the browser/network you will use.
- [ ] Check the exact repository paths for the two internals you intend to show.
- [ ] Prepare a small local fallback and ensure you know the actual start command for the current checkout.
- [ ] Keep a static screenshot or short recording of the primary workflow in case the demo environment fails. Label it honestly as a backup, not a live demo.

### 30 minutes before

- [ ] Start the required services and wait for explicit success logs.
- [ ] Start the application with the command verified from the checked-out repository. Do not rely on memory for script flags.
- [ ] Open the live deployment and the local fallback in separate tabs.
- [ ] Log in and enter the intended workspace before the interview begins.
- [ ] Open a second browser profile/window and prepare the collaborator session.
- [ ] Arrange the two sessions side by side.
- [ ] Mute notifications and close unrelated tabs.
- [ ] Have the repository open to `yjsSyncEngine.service.ts`, `crdtWriteBehind.service.ts`, `cursorCodec.service.ts`, or the exact files you have reviewed.

### Startup and recovery

Use the repository's current README and scripts as the source of truth. The local workflow may change; verify commands before interview day.

| Issue | Calm response | Recovery |
|---|---|---|
| Live deployment unavailable | “The hosted environment is not responding, so I’ll switch to the local instance.” | Move directly to the pre-tested local fallback. |
| Database is unavailable | “The application cannot complete its normal database-backed workflow until the database is available.” | Start/check PostgreSQL and inspect the actual connection error. |
| Redis is unavailable | “I’ll check which Redis-backed paths are affected rather than assume the whole application is healthy.” | Inspect Redis logs and the app’s documented fallback behaviour. |
| Docker is unavailable | “The editor may load, but the container-backed terminal needs Docker.” | Start Docker and verify the Docker Engine is ready. |
| Collaboration looks stale | “I’ll verify the connection and session state first.” | Check both browser consoles and backend WebSocket logs; reconnect only after checking. |
| Terminal does not respond | “I’ll check terminal provisioning and the WebSocket path.” | Check container state and terminal-handler logs; switch to the fallback if unresolved. |
| Frontend is blank | “I’ll check the browser console and server response.” | Hard-refresh once; do not start randomly reinstalling dependencies. |

**Avoid risky recovery commands** such as indiscriminately killing processes or modifying the database during the interview. A prepared fallback is better than improvising destructive fixes.

---

## 5. Architecture: explain the request path

```text
Browser
  ├── React UI + Monaco Editor
  ├── xterm.js terminal
  └── HTTP / WebSocket connections
             │
             ▼
       Nginx reverse proxy
             │
             ▼
    Node.js + Express backend
      ├── Authentication and workspace authorization
      ├── Yjs collaboration / WebSocket handling
      ├── Presence and other socket events
      ├── Terminal and LSP handlers
      └── Snapshot / file services
             │
       ┌─────┴─────────┐
       ▼               ▼
  PostgreSQL          Redis
  durable state       cache, buffers,
  users/workspaces    Pub/Sub and coordination
       │
       ▼
  Content-addressed snapshot records

Backend ── Docker Engine ── workspace container(s) ── PTY sessions
```

This is a **logical architecture**, not a claim that the deployment currently runs multiple backend pods. Distinguish logical components from actual deployment topology when answering.

### A clear verbal walkthrough

1. The browser hosts the editor and terminal UI.
2. HTTP routes handle ordinary application operations; WebSockets carry interactive, low-latency events.
3. The collaboration layer applies Yjs updates so concurrent edits can be reconciled.
4. PostgreSQL stores durable application state and snapshot metadata/content-addressed records.
5. Redis supports selected cache, buffering, presence, or coordination paths.
6. Terminal commands go through the backend's container/PTY integration rather than executing directly on the browser.

### How to answer “Why these technologies?”

| Choice | Reason | Trade-off to acknowledge |
|---|---|---|
| React + Monaco | Familiar editor interface and mature editing capabilities | Monaco is an editor component, not a complete IDE; workspace and runtime behaviours still need to be built. |
| Yjs CRDT | Handles concurrent edits without requiring every client edit to pass through one central transformation sequence | CRDT state and update history need lifecycle management, persistence, and careful testing. |
| WebSockets | Full-duplex channel suited to continuous collaboration and terminal I/O | Connections need authentication, reconnection handling, backpressure, and lifecycle cleanup. |
| PostgreSQL | Transactions and relational constraints for durable application data | Frequent small writes can create overhead; persistence batching introduces a bounded unsaved window. |
| Redis | Useful for cache, messaging, transient state, and coordination | Redis is another operational dependency; fallback behaviour must be explicit and tested. |
| Docker | Provides a practical process/filesystem boundary for running workspace commands | Containers share the host kernel and are not equivalent to a VM or a perfect security boundary. |
| Content-addressed storage | Reuses identical content by hash and helps make snapshots space-efficient | Hashing, tree construction, retention, and garbage collection require careful invariants. |

---

## 6. The two deep dives to prioritise

Do not present all optimisations in the main demo. Pick **one correctness topic** and **one performance topic**, and be able to open the implementation.

### Deep dive A — Concurrent editing with Yjs

**Problem:** Multiple users may change the same document before they receive one another's updates. Naive last-write-wins replacement can lose edits.

**Approach:** Yjs represents edits as CRDT operations/updates. Compatible updates can be integrated by replicas and produce a convergent document state. The application carries those updates through its WebSocket and persistence paths.

```text
Client A edits ─┐
                ├─> collaboration transport ─> Yjs document state
Client B edits ─┘                               │
                                                ▼
                                    broadcast updates to peers
                                                │
                                                ▼
                                    persistence / recovery path
```

**What to explain:**

- **Convergence is not the same as durability.** CRDTs address merging concurrent edits; the application still needs to persist updates and recover state after a restart.
- **Awareness is not document content.** Cursor position and presence are ephemeral collaboration signals and should not be confused with saved file content.
- **Transport and CRDT are separate concerns.** A CRDT does not itself provide network connectivity, authentication, or durable storage.
- **Reconnects matter.** The system needs a way to re-establish a client's document state and apply missing updates safely.
- **Garbage collection is a trade-off.** Keeping deleted-item history may support some historical workflows but costs memory/storage. Do not claim exact keystroke replay merely because `gc: false` is enabled; verify how the timelapse feature actually reconstructs history.

**Likely follow-ups:**

- What happens if two users type at the same position?
- What happens when a client disconnects, edits offline, then reconnects?
- What is persisted: full document snapshots, incremental updates, or both?
- What prevents duplicate update delivery from corrupting state?
- What happens if the process crashes after accepting an update but before it is persisted?
- How would you test convergence without relying on a manual demo?

**A good testing answer:** Describe the actual tests in the repository. If using property-based testing, explain the generated edit streams, the property checked (for example, replicas converge after receiving the same updates), and the failure cases exercised. Do not say “mathematically proven” when the evidence is test coverage.

**Code to review:** `backend/src/services/yjsSyncEngine.service.ts`, `backend/src/services/websocketServer.service.ts`, and relevant collaboration tests.

### Deep dive B — Persistence without writing to PostgreSQL on every edit

**Problem:** Persisting every keystroke as its own database write adds avoidable write and transaction overhead during active typing.

**Approach:** An adaptive debouncer can batch persistence based on observed edit activity. A Redis-backed write-behind path can buffer updates and have a worker flush batches to PostgreSQL.

```text
edit / Yjs update
       │
       ▼
buffer + debounce
       │
       ├── frequent edits are coalesced/batched
       ▼
background flush
       │
       ▼
PostgreSQL durable storage
```

**What to explain:**

- Debouncing reduces write frequency but creates a **crash window** before buffered data is durable.
- Write-behind buffering improves the hot path only if enqueueing, flush/retry, ordering, and duplicate handling are reliable.
- A successful Redis enqueue is not the same as a PostgreSQL commit.
- Flush workers need bounded batches, error handling, observability, and a recovery strategy for pending updates.
- If Redis is unavailable, describe only the fallback that is actually implemented and tested.
- A distributed lock can reduce concurrent flushes, but a lease expiring during a slow flush creates a race to reason about. Explain any version checks or idempotency guarantees that protect writes.

**Likely follow-ups:**

- What is the maximum data-loss window?
- What if Redis accepts an update and then restarts before the worker persists it?
- What if a worker flush succeeds but crashes before acknowledging the buffered item?
- How are duplicate or out-of-order updates handled?
- How do you observe buffer growth and flush failures?
- Why not write every update directly to PostgreSQL?

**Code to review:** `backend/src/services/adaptiveDebouncer.service.ts`, `backend/src/services/crdtWriteBehind.service.ts`, and `backend/src/services/distributedLock.service.ts`.

---

## 7. Other engineering highlights: use selectively

Keep this section for interviewer-led deep dives. Explain the problem, the mechanism, the trade-off, and evidence. A feature name alone is not an explanation.

### Binary cursor codec

**Problem:** Cursor and selection awareness is sent frequently, and JSON adds framing and field-name overhead.

**Mechanism:** The repository contains a compact cursor codec (`cursorCodec.service.ts`) that packs a user identifier/hash and cursor fields into an 8-byte frame.

**Discuss:** Field width limits, coordinate bounds, how user-hash collisions are handled, the wire-format versioning strategy, and the fallback/validation path for malformed frames.

**Performance claim:** An 8-byte payload compared with an assumed 250-byte JSON payload is a **96.8% payload-size reduction** for those assumed sizes. That is not automatically a 96.8% reduction in end-to-end bandwidth: protocol headers, frequency, framing, and actual traffic matter. Call it a measured result only if there is a reproducible benchmark.

### Content-addressed snapshots

**Problem:** Re-copying unchanged files for every snapshot repeats storage.

**Mechanism:** Hash file contents and directory/tree records; link snapshot metadata to a root tree and parent history. Identical content can reuse existing blob records.

**Discuss:** Hash inputs and canonicalisation, transaction boundaries, restore correctness, orphan cleanup, retention, and what happens when a snapshot is interrupted.

**Code to review:** `backend/src/services/cas.service.ts`, `backend/src/services/workspaceSnapshot.service.ts`, and the database schema.

### Container pool and terminal lifecycle

**Problem:** Starting a new execution environment for each request can increase latency and resource use.

**Mechanism:** The sandbox code manages workspace containers and terminal sessions through the Docker Engine API.

**Discuss:** Pool exhaustion, cleanup after abandoned sessions, limits on CPU/memory/processes, per-user PTY isolation, and what a container boundary does *not* protect against. A shared container per workspace shares its filesystem and installed packages across collaborators, even if each collaborator has a separate PTY.

**Important security distinction:** Docker containers share the host kernel. cgroups and PID limits are resource controls; they are not, by themselves, proof of container-escape prevention. Be explicit about the current threat model and what stronger isolation would require.

**Code to review:** `backend/src/sandbox/pool.ts`, `backend/src/sandbox/workspaceContainer.ts`, and `backend/src/terminal/terminalHandler.ts`.

### Language Server Protocol

**Problem:** Syntax highlighting is not the same as language-aware completion and diagnostics.

**Mechanism:** The LSP integration connects language-server processes and translates protocol messages into editor interactions.

**Discuss:** Process startup and cleanup, supported languages, message routing, diagnostics latency, and behaviour when a language server fails.

**Code to review:** `backend/src/terminal/lspHandler.ts` and the relevant frontend editor integration.

---

## 8. Database design: the concepts worth explaining

| Area | Design idea | What the interviewer may ask |
|---|---|---|
| Users and workspaces | Relational entities with stable identifiers | How are ownership and membership represented? |
| Workspace membership | A relationship between workspace and user, including role | How are duplicate memberships prevented? How is role checked? |
| File tree | Parent-child relationships represent folders and files | How do you query a subtree or prevent invalid parent relationships? |
| CRDT state and updates | Binary state plus incremental update/history records, as implemented | Which is the source of truth during recovery? How are updates compacted? |
| Snapshot blobs and trees | Content hashes can deduplicate identical content | How do you make snapshot creation atomic? How does garbage collection avoid deleting live blobs? |
| Authorization queries | Indexes can reduce lookup work | What is the actual query plan? Does `EXPLAIN (ANALYZE, BUFFERS)` show an index-only scan under real conditions? |

### Index-only scan: explain without overselling

A covering index stores the columns needed by a query in the index itself. PostgreSQL can use an index-only scan when the query's columns are available from the index **and** visibility-map conditions allow it to avoid heap access. An `INCLUDE (role)` index makes `role` available from the index; it does not guarantee zero heap reads for every query under every workload.

Show the actual query and index definition if asked. Avoid promising “sub-millisecond” performance without a benchmark.

---

## 9. Security: present the actual boundaries

| Area | What to explain | Avoid claiming |
|---|---|---|
| Authentication | How login establishes identity and how tokens/sessions are validated | “JWT means the app is secure.” |
| Workspace authorisation | Roles are checked for actions on a workspace; routes and socket events both matter | “The frontend hides buttons, so access is protected.” |
| Password storage | Identify the actual hashing library/algorithm from the implementation | Do not name `bcrypt` or `pgcrypto` unless that path is confirmed in the current code. |
| Terminal execution | Commands run through the backend and container/PTY integration | “Docker makes arbitrary code execution completely safe.” |
| Resource limits | CPU, memory, and process caps where configured | “Resource limits prevent container escape.” |
| Redis/database failure | Explain which operations continue, fail, or degrade | “Redis can crash with no data loss” unless the durability and recovery semantics justify it. |

**A strong security answer has four parts:** asset/threat, enforcement point, test/evidence, residual risk. For example: “The asset is workspace code; authorisation is enforced in the backend, including the socket path; I test that a user without membership cannot access workspace events; the remaining concern is ensuring every new endpoint uses the same enforcement path.”

---

## 10. Observability and testing

### Observability

The codebase includes a metrics service and a metrics route. Be prepared to show the actual exported metric names and explain:

- What each metric measures and its unit.
- Whether it is a counter, gauge, or histogram.
- How p50/p99 values are computed and over what time window.
- Which symptoms indicate event-loop pressure, a growing CRDT buffer, too many open connections, or slow database operations.
- What alert or operational action you would take when a threshold is crossed.

Do not call a metrics endpoint proof of production readiness. Explain how the metrics would help diagnose a concrete failure.

### Testing

Use the test commands and names that exist in the current checkout. The README documents specialised testing categories; verify the current `test.sh` before interview day.

Be prepared to separate:

- **Unit tests:** local logic such as codecs or persistence policy.
- **Integration tests:** database, Redis, Docker/PTY or WebSocket interactions.
- **Property-based tests:** invariants across many generated inputs or edit sequences.
- **End-to-end tests:** user-visible workflows across multiple browser sessions.
- **Failure/chaos tests:** behaviour when a dependency or session fails.

**For each test category, know one concrete case, its expected result, and what bug it could catch.** “I have tests” is less persuasive than describing a failure case that a test would detect.

---

## 11. Likely interviewer questions

Use these as prompts, then answer from your actual implementation. Avoid memorising long paragraphs.

### Product and ownership

**“What problem does NexusIDE solve?”**

It reduces the friction of setting up and collaborating in development environments by combining editing, live collaboration, terminal execution, and language tooling in one workspace.

**“What was the hardest part?”**

Choose the hardest problem you personally tackled. A strong candidate is keeping collaborative state responsive while making persistence recoverable. Explain the failure mode first, your design second, and the testing/evidence last.

**“What did you implement personally?”**

Be precise about the modules and decisions you owned, what you adapted from libraries, and what you would still improve. Clear ownership is more credible than claiming every part was built from scratch.

**“What would you improve with another month?”**

Prioritise one reliability/security/operability improvement with a reason—for example, stronger workload isolation, better failure-injection coverage, or a reproducible performance benchmark. Tie it to a limitation you can defend.

### Collaboration and distributed state

**“Why CRDT instead of last-write-wins?”**

Last-write-wins can discard independent concurrent edits. A CRDT provides a merge model designed to converge when replicas receive compatible updates. The transport, authorisation, persistence, and recovery layers still need to be built correctly.

**“Does CRDT mean there can never be a conflict?”**

No. It means concurrent operations are integrated according to the CRDT's rules to obtain a consistent state. Product-level conflicts, semantic code conflicts, permission errors, and persistence failures still exist.

**“What if the server restarts?”**

Explain the actual recovery path: which persisted state is loaded, whether incremental updates are replayed, how Redis cache state is treated, and how clients reconnect. Do not imply that in-memory Yjs state alone survives a restart.

### Performance and persistence

**“Why not write every keystroke to the database?”**

That can add high transaction and write overhead. Batching/debouncing can reduce that overhead, but it increases the time during which recent edits are not yet durable. State the actual bounds and failure behaviour.

**“How do you know the optimisation works?”**

Separate analytical estimates from measured results. A credible benchmark states the baseline, workload, hardware/deployment, measurement window, and repeated results. If you have not measured it yet, say it is the expected benefit and explain how you would measure it.

**“Why Redis and PostgreSQL?”**

They serve different roles: Redis is useful for transient/cache/buffering/messaging paths, while PostgreSQL provides durable relational state and transactions. Then explain exactly which data lives in each and what happens when either system is unavailable.

### Execution and security

**“Why Docker instead of running commands directly on the host?”**

A container provides a separate filesystem/process environment and resource-control mechanisms. Running arbitrary user commands directly on the application host would expose the host's environment and files more directly. Docker still shares the host kernel, so container configuration and a realistic threat model remain important.

**“Are separate terminals separate containers?”**

Distinguish the PTY/session from the container. Multiple collaborators may have separate terminal sessions while sharing a workspace container and filesystem. Explain the isolation that exists and does not exist.

**“How do you prevent unauthorised access?”**

Describe backend authentication, workspace membership/role checks, and coverage across REST and WebSocket/terminal operations. Point to the enforcement code and tests rather than relying on UI behaviour.

### Storage and snapshots

**“Why content-addressed storage?”**

The hash identifies the content, allowing identical content to reuse a blob rather than be stored again for each snapshot. The tree/commit metadata connects blobs to a workspace revision. Correctness depends on consistent hashing, atomic metadata updates, and safe garbage collection.

**“What happens if garbage collection races with a snapshot?”**

Explain the real locking/transaction/reference-checking approach. If a race is not fully covered, acknowledge it as a design risk and propose a safe ordering or transactional marking/sweeping protocol.

---

## 12. Performance numbers: what you may say

The earlier draft contained figures such as 96.8% cursor payload reduction, ~75% fewer database writes, ~95% offloading of SQL writes, sub-100ms container initialisation, and ~90% RAM reduction. **Treat these as claims that need a reproducible basis—not as facts to recite automatically.**

| Claim | Safe explanation | Evidence needed to present it as measured |
|---|---|---|
| 96.8% cursor payload reduction | The codec uses an 8-byte frame; compared with a 250-byte assumed JSON payload, that is a 96.8% payload-size reduction. | Capture actual encoded payloads and account for framing/transport overhead. |
| ~75% fewer DB writes | Adaptive debouncing is intended to coalesce many edits into fewer persistence operations. | Same edit workload with debouncing on/off; count database writes and define the window. |
| ~95% SQL writes offloaded | Write-behind is intended to move persistence work away from the interactive update path. | Define “offloaded” and measure the proportion of writes removed from the synchronous path. |
| Sub-100ms container allocation | A warm pool can make assigning a ready container faster than creating a new one. | Repeated cold-versus-warm timings with p50/p95 and a stated environment. |
| ~90% RAM reduction | Sharing one workspace container can use less memory than one container per collaborator. | Measure memory for equivalent workloads and state the user/container counts. |

**Interview wording:** “The design is intended to reduce X. I’d validate the effect with Y measurement.” If a benchmark is already available, share its setup and raw results. Do not call a calculation a benchmark.

---

## 13. The 60-second closing

> “The central engineering challenge in NexusIDE is balancing a responsive collaborative experience with correctness and recoverability. Yjs addresses concurrent document merging; the persistence path handles batching and durable state; Redis supports selected real-time and coordination paths; and Docker provides the workspace execution boundary. I’d be happy to open any of those implementations and discuss the trade-offs, failure cases, or tests.”

Then stop. Let the interviewer choose the next direction.

---

## 14. Final preparation checklist

Before the VISA interview, make sure you can do each of these without looking at the notes:

- [ ] Explain NexusIDE's user problem and demonstrate the value in 30 seconds.
- [ ] Complete the 5–7 minute demo without setup improvisation.
- [ ] Draw the architecture and trace one edit from browser through collaboration and persistence.
- [ ] Explain why Yjs is useful—and why it does not solve durability by itself.
- [ ] Explain how buffered updates become durable and what the crash window is.
- [ ] Show the actual code for one correctness decision and one performance decision.
- [ ] Explain workspace role enforcement across both REST and WebSocket paths.
- [ ] Distinguish a terminal session, a container, and a workspace.
- [ ] Describe one real test, one real failure case, and one known limitation.
- [ ] Separate measured results from estimates and design goals.
- [ ] Describe your individual contribution accurately.
- [ ] Answer “What would you improve next?” with one specific, defensible priority.

---

*Interview notes for [NexusIDE](https://github.com/AmanKashyapp07/NexusIDE). Keep this guide aligned with the current code and verified demo environment.*
