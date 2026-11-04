# NexusIDE: Interview Demo Playbook (Enhanced)

**Candidate:** Aman Kashyap
**Target Role:** SDE / Distributed Systems
**Project:** NexusIDE, a real-time collaborative cloud IDE
**Core Demo:** 8 minutes (cut-down 5-minute and extended 12-minute versions at the end)
**URL:** `http://localhost:5173/ide`

---

## 0. The Strategy: Why This Version Is Different

The original script is technically strong but reads as a **tour**. The enhanced version is a **dare**: you invite the interviewer to watch you break the system, then show it survive. Five principles drive every change:

1. **Prove, don't claim.** Every number in your narration (96%, 75%, 50ms, 10ms) should appear on screen from a live Systems HUD, not just come out of your mouth.
2. **Break it on purpose.** Partition the network, run a fork bomb, corrupt the code. Failure that recovers is more memorable than success.
3. **Show the distributed part.** Two backend instances behind Redis Pub/Sub is the actual distributed-systems claim on your resume. The original never shows it.
4. **Hand over the keyboard.** The last 30 seconds should have the interviewer trying to break your system. Confidence is the wow factor.
5. **Name your own weaknesses first.** Raising the write-behind loss window and shared-container tradeoff yourself reads as senior engineering judgment.

---

## 1. Staging (Do This 10 Minutes Before)

### 1.1 Screen Layout

| Region | Content |
|---|---|
| Left 40% | **Window A** (Chrome, user `demo`), connected to **backend instance 1** |
| Right 40% | **Window B** (Chrome Incognito, user `collab`), connected to **backend instance 2** |
| Bottom or far-right 20% | Terminal with **two log panes** (instance 1 and instance 2) plus a third pane running `watch -n1 docker ps` |

If your screen is small, put the log panes in a tmux session and bring it forward only when needed.

### 1.2 Run Two Backend Instances (New)

Start two Node instances on different ports (for example 3001 and 3002), both pointing at the same Redis and PostgreSQL. Point Window A at instance 1 and Window B at instance 2 (via env var, query param, or two Vite proxy configs).

This lets you say, truthfully and visibly: "These two users are on different servers. Redis Pub/Sub is the only thing connecting them."

### 1.3 Build the Systems HUD (New, Highest ROI Addition)

Add a toggleable overlay (`?hud=1` or press `Ctrl+Shift+H`) in the corner of each window. About 2 to 3 hours of work buys the entire "wow" layer. Show:

| HUD Field | Backs Which Claim |
|---|---|
| Server instance ID (`node-1` / `node-2`) | Multi-instance fan-out |
| Round-trip sync latency (ms), last and p95 | "Zero noticeable latency" |
| Cursor bytes/message: `8 B` vs `JSON equiv: ~210 B` | 96% awareness traffic reduction |
| Yjs update size (bytes) and ops/sec | CRDT delta efficiency |
| Redis buffer depth and last flush timestamp | Write-behind debouncer |
| Postgres writes in last 10s vs keystrokes in last 10s (e.g. `1 write / 142 keystrokes`) | 75% IOPS reduction |
| Doc state hash (first 8 hex chars of a hash of the Yjs state) | Convergence proof |
| Warm pool size and last allocation time (ms) | Sub-50ms allocation |
| Restore time (ms) shown in toast after rollback | Sub-10ms rollback |

If you cannot build all of it, prioritize: **doc state hash**, **allocation ms**, **restore ms**, **Postgres writes vs keystrokes**.

### 1.3 Remove Typing Risk

Live typing is the main source of dead air and typos.

- Pre-load snippets into a clipboard manager or text expander (Espanso, Raycast snippets, Alfred) with triggers such as `;;engine`, `;;quorum`, `;;bomb`.
- Pre-create a workspace called `Distributed-Systems-Demo` already containing `engine.py` with the base function, so Phase 1 starts inside a live session rather than at a login form.
- Log in to both windows **before** the interview. Never type a password in front of the interviewer.
- Create a second throwaway workspace, `sandbox-chaos`, for the fork bomb (see Phase 4).

### 1.4 Pre-Flight Checklist

- [ ] Both backend instances running, logs visible
- [ ] Redis and PostgreSQL healthy
- [ ] Warm pool filled (`docker ps` shows N idle containers)
- [ ] HUD toggles on in both windows
- [ ] Window B DevTools already open on the Network tab (so you do not fumble for shortcuts)
- [ ] Browser zoom at 125% or higher for readability over screen share
- [ ] Do Not Disturb on, notifications off, unrelated tabs closed
- [ ] Wi-Fi stable, or use a wired connection if in person
- [ ] A 60-second screen recording of the full flow saved as backup (see section 4)
- [ ] Full dry run completed twice in the last 24 hours

---

## 2. The 8-Minute Timeline

```
0:00 ───── 0:50 ───── 2:30 ───── 4:00 ───── 5:30 ───── 7:00 ───── 8:00
  Phase 1     Phase 2     Phase 3     Phase 4     Phase 5     Phase 6
  Cold Open   Two Servers Partition   Fork Bomb   Time Travel Close +
  (The Dare)  One Doc     Chaos       Survives    (Merkle)    Hand Over
```

---

### Phase 1: The Cold Open (0:00 to 0:50)

**Start already inside the workspace with both windows side by side and the HUD visible. No login screen, no "let me set this up".**

**Actions**
1. Gesture at the screen: two browsers, two servers (point at the log panes), one document.
2. Do not touch anything yet. Deliver the hook.

**Spoken Narration**
> "Most web IDEs are a VM with a text box on top. I wanted to build the hard parts instead, so NexusIDE is built around three problems.
>
> One: two people editing the same file without a server serializing every keystroke.
> Two: running untrusted code in a terminal without waiting five seconds for a container to boot, and without letting a fork bomb take down the host.
> Three: persisting every keystroke without turning Postgres into a bottleneck.
>
> I am going to try to break each one in front of you. Over the next eight minutes you will see a network partition, a fork bomb, and a deliberately corrupted codebase. Tell me if anything looks fake."

**Why it works:** You set an expectation of risk and honesty in 40 seconds, and the interviewer starts watching for failure, which makes the recoveries land harder.

---

### Phase 2: Two Servers, One Document (0:50 to 2:30)

**Actions**
1. In Window A, press `;;engine` (or type) to create the start of `engine.py`:
   ```python
   import os, sys, time

   def compute_cluster_state():
   ```
2. Point at the Window B explorer: `engine.py` appeared via Socket.IO with no refresh.
3. Point at the HUD: Window A shows `node-1`, Window B shows `node-2`. Point at the two log panes: both lit up on the same edit.
4. In Window B, add the return line (`;;return`):
   ```python
       return {"nodes": 3, "status": "HEALTHY"}
   ```
5. Type in both windows at the same moment (rehearse this: A on line 1 comment, B on the return line). Hold up your hands to show you are doing both.
6. Point at the HUD: cursor message is `8 B` against `JSON equiv ~210 B`; Postgres writes `0` while Redis buffer depth climbs. Pause typing for two seconds, then point at the flush: **"1 write / N keystrokes."**

**Spoken Narration**
> "These two users are connected to different backend servers. The only thing linking them is Redis Pub/Sub, which fans out Yjs binary updates.
>
> There is no lock and no central operation log. The document is a Yjs CRDT, so each insertion carries a client ID and a clock value, and any replica can apply any update.
>
> Cursor positions travel as an 8-byte packed binary message: user hash, line, column, selection length. The HUD shows what the same message costs in JSON.
>
> And look at the database counter. I typed a hundred-plus characters and Postgres saw one transaction. A Redis write-behind debouncer batches updates and flushes when typing pauses."

---

### Phase 3: Partition Chaos and Same-Line Merge (2:30 to 4:00)

*The climax. The original used non-overlapping edits, which is the easy case. This version adds the hard case: both sides edit the same line.*

**Actions**
1. In Window B DevTools, set throttling to **Offline**. The amber `Reconnecting...` pill appears. (Mac: `Cmd+Option+I`; Windows/Linux: `Ctrl+Shift+I`. Already open from staging.)
2. Say to the interviewer: *"Window B has just lost the network. Both users keep working."*
3. **Window A (online)** edits the status string on line 4 and adds a function at the bottom:
   ```python
   def verify_quorum():
       return True
   ```
4. **Window B (offline)** edits the *same line 4*, changing the node count and status:
   ```python
       return {"nodes": 5, "status": "QUORUM_REACHED"}
   ```
5. Point to the HUD: the doc state hash on each side is **different** (for example `a91f03c2` vs `7be2d410`).
6. Ask: *"In Git this is a merge conflict. In a lock-based editor, someone loses work. Watch."*
7. Set throttling back to **No throttling**.
8. Both editors reconcile. Point to the HUD: **the state hashes are now identical**, the sync time is shown (for example `38 ms`), and both users' edits survive.

**Spoken Narration**
> "While offline, Window B kept accumulating local operations. On reconnect, the client and server exchange state vectors, a compact summary of what each side has seen, and send only the missing deltas.
>
> Yjs updates are commutative, associative, and idempotent. So it does not matter which side's changes arrive first, or if one arrives twice: both replicas converge to the same document. That is why the two hashes match.
>
> Even on the same line, nothing is dropped. The CRDT resolves the concurrent inserts deterministically using client IDs as tie-breakers. The result is not always what a human would choose, but it is always the same on every machine, which is the guarantee that matters."

**Why it works:** The matching hash is visual, objective proof of convergence. It is the single best moment in the demo, so slow down here and let it land. Pause for two full seconds after the hashes match.

**Rehearsal note:** Same-line concurrent edits can produce interleaved text that looks odd. Rehearse the exact strings so the merged result looks intentional, and be ready to say "this is the expected deterministic merge, not a bug."

---

### Phase 4: The Sandbox Survives a Fork Bomb (4:00 to 5:30)

*The original described the fork bomb in narration. This version runs it.*

**Actions**
1. Switch Window A to the throwaway `sandbox-chaos` workspace (so Phase 5 state is safe).
2. Open the terminal. Show it is a real PTY, not a pipe:
   ```bash
   whoami && uname -a && ls -l /dev/pts && tty
   ```
3. Show the limits:
   ```bash
   cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/pids.max
   ```
   (Expected: `268435456` and `64`. Keep the cgroup v1 fallback command in your snippets.)
4. Point at the allocation time on the HUD (for example `31 ms`) and at `watch docker ps`: the pool replenishes a new warm container in the background.
5. Say: "Let me do something I am not supposed to." Run the fork bomb:
   ```bash
   :(){ :|:& };:
   ```
6. Show the terminal complaining (`Resource temporarily unavailable`) while the host machine and the other workspace stay responsive. If you have a monitor pane, show `docker stats` with the container pinned at 64 PIDs and host CPU calm.
7. Run a memory hog:
   ```bash
   python3 -c "b = bytearray(512*1024*1024)"
   ```
   The process is killed (`Killed`) while the container and the terminal survive.
8. Clean up: run `pkill -f` or restart the terminal session, then confirm the shell is healthy.

**Spoken Narration**
> "The terminal is a true pseudo-terminal: Dockerode allocates a `/dev/pts` device, so it handles VT100 sequences and signals like SIGINT, which a plain stdout pipe cannot.
>
> Boot time is solved by a warm pool: containers are pre-started with a half CPU core, 256 megabytes of RAM and a 64-process ceiling. Allocation took 31 milliseconds just now, versus several seconds for a cold start. And the pool refills in the background.
>
> Now the fork bomb. It hits the cgroup PID limit at 64 and the kernel refuses to create more processes. The host never notices. The memory hog is killed by the OOM killer inside the container's own cgroup. Isolation is layered: cgroup limits, non-root user, dropped capabilities."

**Safety note:** Run the fork bomb only inside the throwaway workspace and only after you have confirmed the limits during rehearsal. If `pids.max` is not actually enforced on the demo machine, you will freeze your laptop in front of the interviewer. Test it three times beforehand.

---

### Phase 5: Merkle DAG Time Travel (5:30 to 7:00)

**Actions**
1. Return to `Distributed-Systems-Demo`. Open **History**, click **Create Snapshot**, label it `Stable-v1`. Show the 64-character root hash.
2. Make a tiny edit to one file only. Create snapshot `v2`. Show the HUD or panel text: **"Reused 14 of 15 blobs"** (or similar). Highlight that the root hash changed completely, but the unchanged file hashes are identical.
3. **Vandalize:** delete half of `engine.py` and type `# Corrupted state by accidental deletion`. Show Window B also corrupted.
4. Open History, select `Stable-v1`, click **Restore Snapshot**.
5. Both windows snap back. Point at the toast: **"Restored in 8 ms"**, and the matching state hash on both sides.
6. (If implemented) Drag the history scrubber back and forth to show historical playback of the project.

**Spoken Narration**
> "History is a Merkle DAG backed by content-addressable storage in Postgres. Files are SHA-256 blobs, and inserts use `ON CONFLICT DO NOTHING`, so identical content is stored once across every snapshot. Directory nodes sort their entries canonically, which makes tree hashes deterministic.
>
> That has two consequences. First, a snapshot that changes one file reuses everything else, which is why this second snapshot cost one new blob. Second, change a single byte anywhere and the root hash changes, so history is tamper-evident, the same idea Git uses.
>
> I just corrupted the code on both screens. Restore swaps the root atomically in Postgres and pushes the restored state into the live Yjs rooms, so every collaborator rolls back together."

---

### Phase 6: Close and Hand Over the Keyboard (7:00 to 8:00)

**Spoken Narration**
> "Every one of these is a tradeoff, and I will name the costs.
>
> CRDTs cost me tombstone memory in exchange for offline resilience and convergence without a central transformer.
>
> The Redis write-behind buys a 75 percent drop in database writes, but it creates a small window where a Redis crash could lose recent keystrokes. The mitigation is Redis persistence plus replaying from the update log, and a shorter flush interval for critical files.
>
> The warm pool costs idle RAM to buy sub-50-millisecond allocation.
>
> I built a second project, MagnusCI, with a DAG scheduler using Kahn's algorithm, and a lot of the same thinking carried over: decoupling with queues, isolating execution in containers, and verifying webhook signatures with HMAC.
>
> Now I would like you to try to break it. Type something in Window B, kill the network, or tell me what to corrupt."

**Action:** Physically slide the keyboard or share control. Let the interviewer do the damage. Narrate what is happening while they do it.

---

## 3. Numbers You Must Be Able to Defend

Interviewers will probe every figure. For each one, know the method.

| Claim | How to Justify |
|---|---|
| 96% less cursor traffic | 8-byte packed frame vs the JSON payload for the same fields; show both sizes (HUD) |
| 75% fewer DB IOPS | Writes with vs without debouncer under the same typing workload; know the flush interval |
| Sub-50 ms allocation | Time from request to attached shell; show pool allocation timestamp |
| Sub-10 ms rollback | Server time from restore request to Yjs broadcast; say "server-side" explicitly, since browser render adds more |
| ~50 ms reconcile | Reconnect to matching doc hash; if your measured number differs, quote yours, not the script |
| 90% memory saving, shared container | Compute from N users x per-container baseline vs one container |

**Rule:** Use only numbers you have measured on your own machine. If a figure came from estimation, say "roughly" or "in my local benchmarks". An honest "about 40 to 60 ms" beats a precise claim that collapses under one follow-up.

---

## 4. If Something Breaks (Contingency Table)

| Failure | Recovery Line and Action |
|---|---|
| WebSocket will not reconnect after Offline toggle | "This is exactly why I added the reconnect indicator." Refresh Window B; state-vector sync still restores from the server. |
| Docker pool empty | Run the pre-written `bash warm.sh`; narrate: "Cold start is the baseline the pool exists to avoid." |
| Fork bomb freezes the terminal | Close the PTY tab and open a new one; say "The container is saturated, the host is fine, and a new session attaches via exec." |
| Snapshot restore fails | Switch to the screen recording from the checklist and say "Let me show the recorded run while I debug." Never freeze in silence. |
| Interviewer asks about something not built | "I have not built that. Here is how I would approach it..." |
| Screen share lags | Reduce HUD refresh rate; pause typing and talk through the architecture diagram you keep open in a spare tab. |

**Always keep a one-page architecture diagram open in a separate tab:** clients, two Node instances, Redis Pub/Sub, Postgres CAS, Docker pool. If anything fails, switch to it and walk through the design.

---

## 5. Alternate Cuts

### 5-Minute Cut
1. Phase 1 (30 s)
2. Phase 2 with two servers (60 s)
3. Phase 3 partition merge (75 s)
4. Phase 4 fork bomb only (60 s)
5. Phase 6 close (45 s)

Drop snapshots unless asked.

### 12-Minute Extended Cut
Add after Phase 5:
- **Failover (3 min, risky, only if rehearsed):** kill backend instance 1 during a live edit; show Window A reconnecting to instance 2 and the document remaining consistent.
- **Deep dive (1 min):** open the 8-byte cursor codec source and show the bit layout.

---

## 6. Delivery Notes

- **Pause after every proof moment.** Matching hashes, `Killed`, `Restored in 8 ms`: stop talking for two seconds.
- **Narrate while you act, not after.** Silence while typing kills energy.
- **Use the interviewer's name and ask one question.** After Phase 3: "In your experience, how do systems at your company handle offline edits?" It turns the demo into a conversation.
- **Keep the story simple:** correctness (CRDT), safety (cgroups), speed (warm pool and write-behind), history (Merkle DAG).
- **Do not over-explain terminology.** Say "state vector, a compact summary of what each side has seen" once; do not stack jargon.
- **Rehearse out loud against a timer at least three times.** Cut anything that runs long rather than speeding up.

---

## 7. Build Checklist (Priority Order for the Next Few Days)

| Priority | Item | Effort |
|---|---|---|
| 1 | Doc state hash display on both clients | 30 min |
| 2 | HUD: Postgres writes vs keystrokes, cursor bytes vs JSON | 1 to 2 hr |
| 3 | Instance ID label + running two backend instances | 1 hr |
| 4 | Allocation ms and restore ms toasts | 30 min |
| 5 | Snapshot dedup stat ("reused X of Y blobs") | 1 hr |
| 6 | Snippet triggers and 60-second backup recording | 30 min |
| 7 | History scrubber playback (if not already working) | 2 to 4 hr |