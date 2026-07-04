# Backend Engineering Chapter: `backend/src/terminal/terminalHandler.ts`

## Why a Terminal Handler Is More Than a WebSocket

An interactive browser terminal looks simple from the UI: the user types characters and sees output. Backend-wise, it is one of the most complex parts of a cloud IDE. The backend must authenticate the socket, authorize workspace access, locate or create the correct container, start a shell, pipe raw bytes in both directions, restrict viewer behavior, inject Git credentials safely, synchronize file changes from editor to container, synchronize terminal-created files back to PostgreSQL and Yjs, and clean up resources when the socket closes.

The first-principles problem is bridging two full-duplex streams. A browser WebSocket is a network stream. A Docker PTY is a process stream. The terminal handler is the adapter between them.

A beginner might implement a terminal as an HTTP endpoint that receives commands and returns output. That fails for interactive shells because terminal programs are conversational: they prompt, redraw, respond to arrow keys, use control characters, and stream output continuously. The production solution is a persistent byte stream connected to a pseudo-terminal.

The mental model is a telephone call. HTTP is sending a letter and waiting for a reply. A terminal is a live call where both sides can speak at any time. This file keeps the call connected between xterm.js in the browser and bash inside Docker.

## Authentication and Workspace Authorization

The handler begins by extracting `workspaceId` from the URL and `token` from the query string. Browser WebSocket APIs cannot reliably attach arbitrary authorization headers, so query tokens are a practical transport choice.

The JWT proves identity, but identity alone is not permission. The file queries PostgreSQL for the workspace owner and public flag, then checks collaborators. This mirrors the REST authorization model. That consistency matters: if REST says a user is a viewer but the terminal gives them editor-level shell access, the security model collapses.

Authorization also controls shell capability. Owners/admins can get Git credentials and a normal shell. Viewers get restricted bash and a reduced `PATH`. This demonstrates resource and capability authorization, not just route access.

The trade-off is that restricted bash is not a complete sandbox by itself. It is a shell-level guard layered on top of container isolation, read-only viewer binaries, and application-level RBAC. In production, viewer terminals might be disabled entirely or backed by a separate read-only filesystem snapshot.

## Git Credentials as Ephemeral Runtime State

For admins, the handler fetches GitHub token, username, and email from the database and injects them as environment variables. It then creates two temporary scripts inside `/tmp`: `git-askpass` and a `git` wrapper.

From first principles, Git operations need credentials, but credentials should not be written permanently into a project filesystem. A naive implementation might write a `.git-credentials` file inside `/app` or bake credentials into the image. That is dangerous because workspace files can be exported, shared, or inspected.

This file uses ephemeral scripts in `/tmp` and prepends `/tmp` to `PATH` so the wrapper shadows the real Git binary. The wrapper allows a limited command set and blocks arbitrary Git subcommands. This is not perfect security, but it is a meaningful guardrail: users can clone, inspect, commit, and push without giving the shell a totally unrestricted credential helper.

The trade-off is that shell users with enough creativity may still find bypasses if the environment allows access to `/usr/bin/git` directly. Stronger production designs would use scoped GitHub tokens, per-command backend-mediated Git operations, credential brokers, or isolated containers without direct token exposure.

## PTY Creation and Byte Piping

The shell is started with:

```text
Cmd: ['/bin/bash'] or ['/bin/bash', '--restricted']
Tty: true
AttachStdin/Stdout/Stderr: true
WorkingDir: /app
```

`Tty: true` is critical. Human terminals are not plain stdout streams. Programs behave differently when attached to a TTY: they draw prompts, handle control codes, support interactive input, and manage terminal modes. Without a PTY, tools such as shells, editors, REPLs, and pagers behave incorrectly.

Once Docker returns the PTY stream:

- Docker stream `data` is sent to the browser WebSocket.
- Browser WebSocket `message` is written to the Docker stream.

No JSON parsing happens here. That is correct. Terminal protocols are byte-oriented. Arrow keys, Ctrl+C, ANSI escape sequences, and terminal redraws are just bytes. Wrapping them in JSON would add latency, encoding issues, and protocol bugs.

The scalability implication is backpressure. The current implementation writes data directly if sockets are open. Under extreme output, browser rendering can lag. A production terminal service would add output buffering, rate limiting, flow control, and possibly terminal output coalescing.

## Forward Synchronization: Editor to Container

`syncFileToTerminal`, `syncFolderToTerminal`, and `syncDeleteToTerminal` push database/editor changes into the running container.

This exists because the editor and terminal are two views over the same logical workspace. Monaco edits first land in Yjs/PostgreSQL. But shell commands operate on `/app` inside Docker. If editor changes are not mirrored into `/app`, `node index.js` runs stale code.

The flow is:

```text
Monaco edit
  |
Yjs document update
  |
PostgreSQL content/yjs_state
  |
syncFileToTerminal
  |
Docker exec writes /app/path
```

The file path is resolved through a recursive CTE because the database stores parent-child relationships, not full paths. This preserves normalized relational structure while still letting the container behave like a filesystem.

Package installation is debounced when `package.json` changes. This is the same write-amplification principle as editor persistence. A user may save `package.json` repeatedly while editing. Running `npm install` on every update would waste CPU, lock files, and create race conditions. Waiting two seconds after the last change is a practical compromise.

## Reverse Synchronization: Container to Database and Yjs

The terminal is not read-only. Users can run `touch`, `mkdir`, `rm`, `vim`, `npm init`, or scripts that generate files. If those changes remain only inside Docker, the file explorer and Monaco editor become stale. The backend therefore polls the container filesystem and reconciles differences back into PostgreSQL and active Yjs docs.

The naive solution is to tell users to click refresh. That is unreliable and creates data loss if containers are destroyed. Another naive solution is to use filesystem watchers such as `inotifywait`. In Docker-on-macOS and virtualized environments, file event semantics can be unreliable. This file chooses polling using `find` and `stat` every 1.5 seconds.

Polling is not elegant, but it is robust. It asks the source of truth for the current state repeatedly and computes deltas. The cost is periodic CPU and Docker exec overhead. The benefit is deterministic behavior across environments.

The reverse-sync flow is:

```text
User edits file in terminal
  |
Container /app filesystem changes
  |
Polling scan with find/stat
  |
Delta detection: add/update/delete
  |
PostgreSQL files table update
  |
Yjs document update for open files
  |
Socket.IO file-tree-update event
  |
Frontend refreshes explorer
```

The Yjs update in `dbUpdateFile` is important. If a file is open in Monaco and the terminal modifies it, updating only PostgreSQL is not enough. Active browser editors are subscribed to the in-memory Yjs document. The handler finds the shared doc in Yjs `docs`, replaces its text transactionally, and lets Yjs propagate the change to clients.

This creates a potential conflict model. If a user edits the same file simultaneously in Monaco and terminal, the polling update can overwrite editor content. Production systems need conflict detection, version checks, file locks, or merge strategies. This project chooses last observed filesystem content for simplicity.

## The Watcher Algorithm

The watcher keeps `lastState`, a map of known paths to mtime, size, and directory flag. On first scan, it initializes from the database to avoid treating already-hydrated files as new terminal-created files.

Each scan:

1. Executes `find` and `stat` inside `/app`.
2. Ignores dotfiles and prunes `node_modules` and `.git`.
3. Builds `currentFiles`.
4. Deletes DB rows for paths that disappeared.
5. Creates DB rows for new paths.
6. Updates DB/Yjs for files whose mtime or size changed.
7. Emits `file-tree-update` through Socket.IO if anything changed.
8. Schedules the next scan only if the WebSocket is still open.

Pruning `node_modules` is a performance and UX decision. Dependency directories can contain thousands of files. Syncing them into the IDE file tree would overwhelm the database, UI, and network. A production system might use ignore rules similar to `.gitignore`.

Ignoring dotfiles avoids syncing `.git` internals and hidden tool state. The downside is that legitimate dotfiles such as `.env.example`, `.prettierrc`, or `.nexusrun` may not sync if created in the terminal. The project already uses `.nexusrun` in execution hydration, so this is a design tension worth mentioning in interviews.

## Cleanup on Socket Close

When the WebSocket closes, the handler clears the watcher timeout, ends the PTY stream, destroys it defensively, and releases the workspace container reference.

This is resource lifecycle hygiene. A terminal connection owns:

- a WebSocket,
- a Docker exec stream,
- a polling loop,
- and a reference count on a container.

All four must be cleaned up. If the watcher timeout remains, the server keeps scanning a container nobody is using. If the stream remains, Docker keeps shell processes alive. If the container is not released, memory leaks.

The close handler is also where production systems often need idempotency. Network close and error events can race. This handler is mostly defensive, though the workspace-container registry provides the main reference-count behavior.

## Interview Discussion: Terminal as a Stream

Interviewer:
"Why not expose a `/run-command` HTTP endpoint for terminal commands?"

Candidate:
"A terminal is not a sequence of independent commands. It is an interactive process with state, prompts, control characters, job control, and continuous output. HTTP request-response would break programs that expect a TTY. This handler creates a Docker PTY and pipes raw bytes between xterm.js and bash, preserving terminal semantics."

Interviewer:
"Why is `Tty: true` important here but not in the LSP handler?"

Candidate:
"Terminal sessions are human protocols, so they need PTY behavior. LSP is a machine protocol using JSON-RPC over stdio, so a PTY would corrupt framing. The backend chooses stream mode based on protocol semantics."

## Interview Discussion: File Sync

Interviewer:
"Why do you poll the filesystem instead of using inotify?"

Candidate:
"Inotify is efficient on native Linux filesystems, but this project runs inside Docker and may run on macOS or virtualized hosts where filesystem event behavior is less reliable. Polling with `find` and `stat` is less elegant but more deterministic. Since we prune heavy directories and scan every 1.5 seconds, it is acceptable for a project-scale IDE."

Interviewer:
"What are the race conditions?"

Candidate:
"A terminal edit and Monaco edit can race on the same file. The polling layer may overwrite an active Yjs document with filesystem content. A production system would add version checks, conflict prompts, locks, or merge logic. Also, reference release must be balanced; missed socket close cleanup can leak containers."

## Engineering Lessons

- Interactive terminals are byte streams, not command APIs.
- PTY versus non-PTY is a protocol decision.
- Runtime filesystems and persistent databases need synchronization in both directions.
- Polling can be the right reliability trade-off when filesystem events are unreliable.
- Long-lived streams require explicit cleanup of timers, processes, sockets, and resource references.
- Security can degrade capability by role, but shell access always deserves defense in depth.

## Common Mistakes

- Treating terminal commands as stateless HTTP requests.
- Forgetting to mirror editor changes into the container before execution.
- Forgetting to mirror terminal-created files back into the database.
- Syncing `node_modules` and overwhelming the database/UI.
- Exposing GitHub tokens in persistent workspace files.
- Assuming restricted bash is a complete security boundary.
- Failing to clear polling timers on socket close.

## Production Improvements

- Add backpressure and output rate limiting for high-volume terminal output.
- Replace polling with a hybrid watcher where reliable, falling back to polling elsewhere.
- Add ignore-file support and explicit handling for important dotfiles.
- Add conflict detection between terminal writes and active Monaco edits.
- Use scoped short-lived Git credentials through a broker rather than environment variables.
- Add per-user terminal session quotas and idle shutdown.
- Emit metrics for watcher scans, sync latency, file counts, and container release behavior.

## Interview Revision

`terminalHandler.ts` is the bridge between browser terminals, Docker PTYs, PostgreSQL files, Yjs documents, and Socket.IO file-tree notifications. It authenticates and authorizes a terminal WebSocket, opens a role-appropriate shell in the user's workspace container, injects ephemeral Git helpers for admins, pipes raw bytes, pushes editor changes into the container, polls terminal filesystem changes back into PostgreSQL/Yjs, emits explorer refresh events, debounces dependency installs, and releases resources on close.

The strongest one-line explanation: this file keeps the browser editor, database file tree, and live Docker filesystem behaving like one coherent workspace.

