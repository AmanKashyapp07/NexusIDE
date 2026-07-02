# Backend Engineering Chapter: `backend/src/sandbox/docker.ts`

## The Engineering Problem: Running Untrusted Code

The moment an IDE lets users run code, the backend stops being a normal application server and becomes a sandbox orchestrator. User code is arbitrary. It can contain infinite loops, huge output, memory bombs, fork bombs, compiler errors, blocking reads from stdin, or attempts to write files forever. The backend must provide a useful programming environment while protecting the host machine.

A beginner often imagines execution as `child_process.exec("python code.py")` on the server. That is dangerous because the code runs with the server's filesystem, network, CPU, memory, and privileges. Even if the command is escaped correctly, the program itself is the untrusted payload. The production pattern is to isolate execution in a constrained environment. This project uses Docker containers with cgroup limits, network isolation, tmpfs workspaces, and per-run teardown.

`docker.ts` is the one-shot execution engine. It is separate from terminal containers because the semantics are different. A terminal is stateful; a run request should be isolated and reproducible. If a previous run leaves files behind, the next run may behave differently. Removing the container after each execution prevents state leakage.

## Runtime Configuration as Policy

The `CONFIGS` map defines language images, commands, and default filenames. This is more than convenience. It is a policy table that separates "what language is being requested" from "how that language runs safely."

The naive alternative is a chain of `if` statements inside the execution function. That works for two languages but becomes hard to audit. A centralized map makes supported runtimes explicit. If an interviewer asks how you would add Rust, the answer is: add a runtime image, command, filename, and ensure the pool layer prewarms the matching language.

The trade-off is that command templates are simple. Real projects may need package managers, multi-file builds, project configuration, environment variables, or custom commands. This file supports custom `.nexusrun` and `nexus.config.json` when workspace context is available, which is the first step toward a production task system.

## Output Truncation and Host Memory Defense

`MAX_OUTPUT_BYTES` caps output at 1 MB. This is a host-protection mechanism. A malicious or accidental program such as `while true: print("x")` can generate unbounded stdout. If the Node process stores that output in a string forever, the sandboxed program can still crash the unsandboxed host by forcing memory allocation in the backend.

The first-principles lesson is that sandboxing the child process is not enough. Every boundary where data returns to the host needs limits. Output, logs, file reads, database writes, and WebSocket messages can all become resource attacks.

The trade-off is user experience. A legitimate program may produce more than 1 MB of useful output. This implementation returns a truncation warning. A production system might stream output incrementally to the client, persist logs in object storage, or provide a paginated execution log.

## Input Normalization

`normalizeInput` turns raw input into a newline-terminated stream. This exists because many beginner programs read with `input()` or `scanf` and block until newline. If the backend writes input without a trailing newline, a program may hang even though input was provided.

The naive solution passes the raw string exactly as received. That preserves input literally but causes surprising hangs. The production solution depends on product semantics. For an online judge, exact input preservation matters. For an IDE helper, normalizing interactive input into a newline-delimited stream is often better UX.

## Inline Cgroup Metrics

The file injects cgroup metric reads into the command wrapper:

```text
cat /sys/fs/cgroup/cpu.stat
run user command
cat /sys/fs/cgroup/cpu.stat /sys/fs/cgroup/memory.peak
```

The first-principles problem is observability. Users and interviewers care not only whether code succeeded, but how much CPU and memory it used. A naive backend would measure wall-clock time only. That misses memory peaks and CPU saturation. Another implementation would call Docker stats before and after execution, but that adds extra Docker API round trips.

This file chooses inline metrics. Since the command already runs inside the container, reading cgroup files inside the same process context is cheap. Boundaries such as `___NEXUS_CGROUP_BOUNDARY___` separate user stderr from metrics stderr.

The trade-off is coupling to Linux cgroups v2 paths and output formats. If the container runtime or cgroup version changes, parsing may need updates. A production platform would standardize runtime environments and export metrics through a more formal telemetry pipeline.

## The Execution Story

When `executeCode` receives code, language, input, and optional workspace context, it first validates language support. Unsupported languages return a controlled result instead of throwing. That is important because invalid user input should not become a server error.

Then `runInDocker` begins:

1. A warm container is claimed from `warmPoolManager`.
2. If workspace context exists, the full workspace tree is packed into a tar stream and extracted into `/app`.
3. Optional project config can run a build command.
4. The final run command is selected.
5. The command is wrapped with cgroup metric probes.
6. Docker stdout and stderr are demultiplexed into bounded strings.
7. Input is written to stdin.
8. A timeout races against stream completion.
9. Metrics are parsed, exit code is inspected, and the result is returned.
10. The container is removed in `finally`.

This design keeps request handling deterministic: every execution gets a fresh warm container, hydrated workspace, bounded runtime, bounded output, metrics, and cleanup.

## Tar Hydration Instead of Bind Mounts

Workspace execution may require multiple files. A naive solution only writes the active file to the container. That breaks imports, headers, package files, and multi-file projects. Another naive solution bind-mounts a host directory into Docker. That is simple locally but exposes host filesystem paths, behaves differently across macOS and Linux, and creates security concerns.

This implementation builds a tar archive in memory and streams it into the container. The advantages are:

- No host workspace directory is exposed.
- File transfer uses one Docker stream.
- The container receives a realistic directory tree.
- The runner can remain disposable.

The disadvantage is memory usage proportional to workspace size. The route layer limits GitHub imports to 500 files, which helps, but a production system would also enforce byte-size limits and stream large files more carefully.

## Docker Stream Demultiplexing

When Docker exec runs with `Tty: false`, stdout and stderr are multiplexed into one stream with Docker frame headers. If code simply appends raw chunks, output contains binary metadata and becomes corrupted. This file uses Dockerode's `demuxStream` into separate `Writable` streams.

This is a systems-level detail interviewers like because it shows awareness of protocol boundaries. A stream is not always just text. It may be framed. Correct backend code respects the framing rather than hoping chunks align with messages.

The stdout writable also enforces the output cap. This is better than building the entire output and truncating later because it prevents unbounded memory growth during execution.

## Timeout and Cleanup

`Promise.race` enforces a hard execution timeout. The code races stream completion against a timer that rejects with `{ killed: true }`. Timeouts protect availability but can leave resources running if cleanup is not guaranteed. That is why container removal happens in `finally`.

The final removal is fire-and-forget. The response is not delayed waiting for Docker cleanup. That improves perceived latency but means cleanup failures are only logged. Production systems would track cleanup failures, retry them, and have an orphan reaper.

## Interview Discussion: Why Docker?

Interviewer:
"Why not run the code directly with child processes?"

Candidate:
"Because the user's program is untrusted, not just the command string. Running it directly would give it access to the backend host's filesystem, network, CPU, and memory. Docker gives us namespaces, cgroups, filesystem isolation, network isolation, and a disposable lifecycle. This file still adds application-level controls like output caps and timeouts because container isolation does not protect the Node process from unbounded returned data."

Interviewer:
"Is Docker perfectly secure?"

Candidate:
"No. Docker is a strong isolation boundary for a project, but not a perfect sandbox. For stronger multi-tenant isolation, large platforms may use gVisor, Firecracker microVMs, seccomp profiles, AppArmor, rootless containers, or Kubernetes sandbox runtimes. The project demonstrates the right architecture pattern, and production would harden the runtime further."

## Interview Discussion: Metrics

Interviewer:
"Why read cgroup files inside the command wrapper?"

Candidate:
"It avoids extra Docker API calls and measures the same cgroup the process actually runs in. We read CPU and memory before and after the user command and separate those metrics from user stderr with boundaries. It is a low-latency telemetry method, though it assumes Linux cgroups v2 paths and should be abstracted for portability."

## Engineering Lessons

- User code execution requires isolation, resource limits, bounded data return, and cleanup.
- A container sandbox does not remove the need for host-side output limits.
- File hydration should support multi-file projects without exposing host directories.
- Docker streams have protocol framing; backend code must handle it deliberately.
- Observability can be built into execution without many extra API calls.

## Common Mistakes

- Running code directly on the backend host.
- Trusting timeouts as the only safety mechanism.
- Letting stdout grow without a cap.
- Ignoring Docker stdout/stderr multiplexing.
- Reusing containers across executions and leaking state.
- Forgetting to remove containers after failures.

## Production Improvements

- Add seccomp/AppArmor/rootless Docker or switch to microVM isolation.
- Stream output to clients incrementally with backpressure.
- Add workspace byte limits before tar hydration.
- Replace local file logging with structured execution audit events.
- Add cleanup retry queues and orphan container reaping.
- Use signed, versioned runtime images and vulnerability scanning.

## Interview Revision

`docker.ts` is the one-shot sandbox execution engine. It claims a warm language container, hydrates files with an in-memory tar stream, optionally builds project config, wraps commands to collect cgroup metrics, demultiplexes Docker output safely, caps stdout, enforces a timeout, returns execution metrics, logs the request, and removes the container.

The core explanation: safe code execution is not just "run a command." It is resource isolation, bounded I/O, deterministic lifecycle, and careful protocol handling.

