<!-- PROJECT SHIELDS -->
[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![MIT License][license-shield]][license-url]

<br />
<div align="center">
  <h1 align="center">NexusIDE</h1>

  <p align="center">
    A collaborative cloud IDE with CRDT editing, Docker-isolated execution, live terminals, GitHub import, AI autocomplete, and LSP support.
    <br />
    <br />
    <a href="https://github.com/AmanKashyapp07/sandbox-ide"><strong>Explore the project &raquo;</strong></a>
    <br />
    <br />
    <a href="https://github.com/AmanKashyapp07/sandbox-ide">View Demo</a>
    &middot;
    <a href="https://github.com/AmanKashyapp07/sandbox-ide/issues">Report Bug</a>
    &middot;
    <a href="https://github.com/AmanKashyapp07/sandbox-ide/issues">Request Feature</a>
  </p>
</div>

## Why This Project Matters

NexusIDE is a browser-based development environment inspired by Gitpod and GitHub Codespaces. It is not just an editor shell around an API. The backend owns the hard parts directly: real-time collaboration, sandbox lifecycle management, persistent workspace containers, WebSocket protocol routing, GitHub import, language-server bridging, and resource cleanup.

The project was built as a software engineering college project, but the implementation focuses on production-style engineering tradeoffs:

* Multi-user editing uses **Yjs CRDTs** so concurrent edits converge without a central operation sequencer.
* User code runs inside **single-use Docker execution containers** with CPU, memory, PID, filesystem, network, and timeout limits.
* Interactive terminals run in **persistent workspace containers** so users get a real shell, `npm install`, Git workflows, and file changes that sync back into the IDE.
* Socket.IO access is isolated behind `backend/src/socket.ts`, reducing circular coupling between the server bootstrap and terminal synchronization code.
* Graceful shutdown cleans up both warm execution pools and active workspace containers to avoid leaking Docker resources.

## Interview Snapshot

> I built a collaborative cloud IDE with CRDT-based editing, Docker-isolated execution, persistent workspace terminals, GitHub import, role-based workspace access, Socket.IO presence, WebRTC signaling, Gemini autocomplete, and LSP integration. Toward the end, I focused on reliability work: decoupling Socket.IO access, adding graceful container cleanup, preserving workspace containers across short reconnects, and preventing editor-to-terminal sync from accidentally creating new containers.

## Architecture At A Glance

| Area | Implementation |
| --- | --- |
| Editor collaboration | Monaco Editor + Yjs + raw WebSockets |
| Presence and voice signaling | Socket.IO rooms + WebRTC signaling relay |
| File persistence | PostgreSQL adjacency-list tree + Yjs binary state |
| Code execution | Dockerode warm pools, single-use runner containers |
| Live terminal | xterm.js + Docker PTY stream bridge |
| Workspace filesystem | Persistent per-user workspace containers with reverse sync |
| GitHub import | OAuth + repository zipball import + in-memory extraction |
| AI autocomplete | Gemini FIM prompts, debounce, aborts, client cache |
| Language intelligence | Monaco LSP bridge to Pyright and TypeScript language server |

## Architectural Deep Dives

### 1. Real-Time Collaboration With Yjs

NexusIDE uses Conflict-free Replicated Data Types (CRDTs) to make collaboration resilient under concurrent edits.

* **State-vector sync:** When a client opens a file, Yjs exchanges state vectors and transfers only missing updates instead of resending the whole document.
* **Binary persistence:** The server stores Yjs update state in PostgreSQL as binary data, preserving the CRDT history needed for correct merges.
* **Debounced durability:** Editor updates are persisted after a 400ms debounce, avoiding a database write per keystroke.
* **Awareness data:** Cursors, selections, names, colors, and active-file presence stay in memory because they are high-churn and do not need durable storage.
* **Viewer protection:** Read-only users can receive Yjs state but binary edit updates are dropped at the WebSocket boundary.

### 2. Docker-Isolated Code Execution

Running untrusted code is treated as a containment problem, not just a child-process problem.

* **Warm execution pools:** Language-specific containers are pre-created for Python, JavaScript, C, C++, Java, and Bash so execution avoids the cold Docker startup path.
* **Single-use runners:** After a run finishes, the execution container is removed instead of returned to the pool. The pool refills in the background, preventing state leakage between executions.
* **In-memory hydration:** Workspace files are packed into a tar stream in Node.js memory and streamed into `/app` inside the container. No host bind mount is needed for execution.
* **Resource limits:** Execution containers currently use 100MB memory, 0.5 CPU (`NanoCpus: 500_000_000`), PID limit 50, 10-second timeout, read-only root filesystem, and capped tmpfs mounts for `/app` and `/tmp`.
* **Network isolation:** Execution containers run with `NetworkMode: 'none'`, blocking outbound network access.
* **Telemetry:** Runtime duration, exit code, OOM status, CPU usage, and peak memory are captured from Docker/cgroup data.
* **Output cap:** Execution output is capped at 1MB to protect the Node.js process and browser from unbounded stdout.

### 3. Persistent Workspace Containers And Live Terminals

Execution containers are short-lived, but terminal containers behave like real development environments.

* **Interactive PTY bridge:** xterm.js sends raw keystrokes over a WebSocket, and the backend pipes them into a Docker PTY running `/bin/bash`.
* **Raw terminal streaming:** Terminal bytes are streamed directly from the Docker PTY back to the browser over the WebSocket bridge.
* **Container multiplexing:** Opening the same workspace in multiple browser tabs reuses one underlying workspace container through reference counting.
* **Reconnect grace period:** When the final tab disconnects, the workspace container is kept alive for 5 minutes before removal. Short refreshes or reconnects do not wipe the terminal session immediately.
* **Global `run` helper:** Workspace containers inject a `run <file>` command that detects Python, JavaScript, C, C++, Java, and shell files and runs the right toolchain.
* **Background installs:** If a workspace has `package.json`, `npm install` can start in the background while the user keeps terminal control.

### 4. Bidirectional File Synchronization

The editor database and terminal filesystem are kept in sync in both directions.

* **Editor to terminal:** Saved editor changes are written into the running workspace container if one exists. Sync uses `getRunningContainer`, so editing a file does not accidentally create a terminal container.
* **Terminal to editor:** A lightweight polling watcher snapshots `/app`, detects additions, deletions, and modifications, then updates PostgreSQL and the active Yjs document.
* **Tree refresh events:** When terminal-side changes affect the file tree, the backend emits a Socket.IO event to the workspace presence room.
* **Manual refresh:** The UI also exposes a manual refresh path for users who want to force explorer synchronization.

### 5. Language Server Protocol Bridge

NexusIDE includes a real LSP bridge instead of only syntax highlighting.

* **Supported servers:** Python uses `pyright-langserver`; JavaScript and TypeScript use `typescript-language-server`.
* **Container-local intelligence:** Language servers run inside the same workspace container, so they inspect the same files the terminal sees.
* **JSON-RPC streaming:** The backend forwards Monaco LSP messages over a raw WebSocket to the language server process.
* **Startup buffering:** Early client messages are queued until Docker `exec.start()` finishes, preventing dropped LSP initialize packets.
* **Docker demux parsing:** Because LSP runs with `Tty: false`, Docker's multiplexed stream headers are parsed before JSON-RPC payloads are forwarded.
* **Resource control:** LSP sessions require editor/admin access and close after 15 minutes of idleness.

### 6. GitHub OAuth And Repository Import

GitHub is used as both the login provider and the fastest way to seed a real workspace.

* **OAuth login:** Users authenticate with GitHub, and GitHub profile data is mapped to local user records.
* **Repository picker:** The frontend can list a user's repositories through the GitHub API.
* **Zipball import:** Selected repositories are downloaded as zip archives, extracted in memory with `adm-zip`, and inserted into the PostgreSQL file tree.
* **Import guardrail:** Repository import is capped at 500 files to avoid overloading the database transaction path.
* **Terminal Git support:** Admin users can use a constrained Git wrapper in the terminal with credentials injected ephemerally into `/tmp`.

### 7. Socket And Protocol Design

The backend uses the right transport for each kind of real-time traffic.

* **HTTP and WebSockets on one server:** Express is wrapped in a raw Node HTTP server so upgrade requests can be routed manually.
* **Raw WebSockets:** Yjs, terminal streams, and LSP use standard WebSockets because they need binary stream compatibility.
* **Socket.IO:** Presence, active-file updates, file-tree refresh events, and WebRTC signaling use Socket.IO rooms.
* **Decoupled Socket.IO access:** `backend/src/socket.ts` exposes `setIO(io)` and `getIO()`, so lower-level modules can emit events without importing the server bootstrap.
* **Graceful teardown:** `SIGINT` and `SIGTERM` trigger cleanup of warm pools and active workspace containers.

## Security Design

NexusIDE includes defense-in-depth controls across authentication, authorization, and execution.

* **Workspace authorization:** REST routes and WebSocket handlers check owner/collaborator/public access before serving workspace data.
* **Role-based terminal access:** Viewers receive a restricted shell path, while editors/admins can use the full workspace terminal.
* **Read-only CRDT enforcement:** Viewer write attempts are filtered at the Yjs WebSocket layer.
* **Sandbox limits:** Execution containers enforce no network, read-only root filesystem, tmpfs write areas, PID caps, CPU caps, memory caps, output caps, and hard timeouts.
* **Secret handling:** Database credentials, JWT secrets, GitHub OAuth secrets, and Gemini API keys are loaded from environment variables.
* **Lifecycle cleanup:** Pooled containers, active terminal containers, and reconnect grace timers are cleaned up on shutdown.

## Built With

* **Frontend:** React, TypeScript, Tailwind CSS, Monaco Editor, xterm.js, Socket.IO client
* **Backend:** Node.js, Express, TypeScript, Socket.IO, `ws`, Dockerode, Yjs, adm-zip, Axios
* **Database:** PostgreSQL
* **Infrastructure:** Docker Engine API
* **AI/LSP:** Google Gemini API, Pyright, TypeScript language server

## Getting Started

### Prerequisites

* Node.js v20 or higher
* PostgreSQL v14 or higher
* Docker Engine or Docker Desktop
* GitHub OAuth app credentials
* Gemini API key, if AI autocomplete is enabled

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/AmanKashyapp07/sandbox-ide.git
   cd sandbox-ide
   ```

2. Initialize the database:

   ```bash
   createdb sandbox
   psql -d sandbox -f database/schema.sql
   ```

3. Configure backend environment variables in `backend/.env`:

   ```env
   PORT=4000
   DATABASE_URL=postgresql://your_db_username@localhost:5432/sandbox
   JWT_SECRET=your_jwt_secret_key
   GITHUB_CLIENT_ID=your_github_oauth_client_id
   GITHUB_CLIENT_SECRET=your_github_oauth_client_secret
   GEMINI_API_KEY=your_gemini_api_key
   ```

   For local GitHub OAuth, use:

   * Homepage URL: `http://localhost:5173`
   * Authorization callback URL: `http://localhost:4000/api/auth/github/callback`

4. Start the backend:

   ```bash
   cd backend
   npm install
   npm run dev
   ```

   The backend starts Express, initializes Docker warm pools, builds the terminal image if needed, and verifies database connectivity.

5. Start the frontend:

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

6. Open the app:

   ```text
   http://localhost:5173
   ```

## Demo Path

For an interview or project review, the strongest demo sequence is:

1. Sign in with GitHub and create or import a workspace.
2. Open the same workspace in two browser windows and edit one file from both windows to show CRDT convergence.
3. Use the terminal to create or modify a file, then show it appear in the explorer.
4. Run `run <file>` from the terminal for Python, JavaScript, C++, or Java.
5. Show autocomplete or language intelligence in Monaco.
6. Explain how execution containers are single-use while workspace terminal containers persist across short reconnects.
7. Stop the backend and mention graceful Docker cleanup.

## Roadmap

Completed:

* GitHub OAuth authentication
* GitHub repository import with in-memory zip extraction
* Collaborative Monaco editing with Yjs persistence
* Workspace presence and active-file indicators
* WebRTC signaling for peer-to-peer voice rooms
* Docker warm pools for language execution
* Persistent workspace containers with live terminal access
* Terminal-to-explorer synchronization
* Global `run <file>` utility
* Gemini-powered inline autocomplete
* Pyright and TypeScript LSP bridge
* Socket.IO modularization via `socket.ts`
* Graceful cleanup for warm pools and active workspace containers

Next improvements should stay focused on polish:

* Add focused integration tests for workspace container lifecycle and WebSocket authorization.
* Add a short demo video or GIF to the README.
* Add deployment notes for Docker socket access, environment variables, and PostgreSQL provisioning.
* Replace global log suppression with structured logging levels.

## Engineering Lessons

* **CRDTs fit collaborative editors well:** They avoid the central operation-ordering burden of Operational Transform while still guaranteeing convergence.
* **Execution and terminal containers need different lifecycles:** Code execution should be isolated and disposable; terminals need persistence and reconnect tolerance.
* **Docker streams require protocol awareness:** PTY streams and non-PTY exec streams behave differently. Terminal output can be raw, but LSP/stdout demuxing must handle Docker frame headers.
* **Database trees need explicit root constraints:** SQL `NULL` semantics require partial indexes to prevent duplicate root-level filenames.
* **Protocol separation matters:** Socket.IO rooms are excellent for presence and signaling; raw WebSockets are better for Yjs, xterm.js, and LSP binary streams.
* **Lifecycle cleanup is a feature:** Container cleanup, reconnect grace periods, and shutdown hooks are what make the system feel engineered rather than merely functional.

## Contributing

1. Fork the project.
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m "Add your feature"`
4. Push the branch: `git push origin feature/your-feature`
5. Open a pull request.

## License

Distributed under the MIT License. See `LICENSE` for more information.

## Contact

Aman Kashyap - [@AmanKashyapp07](https://github.com/AmanKashyapp07) - iit2024140@iiita.ac.in

Project Link: [https://github.com/AmanKashyapp07/sandbox-ide](https://github.com/AmanKashyapp07/sandbox-ide)

## Acknowledgments

* Course coordinators for the software engineering project guidance.
* Maintainers of Yjs, Monaco Editor, xterm.js, Dockerode, Pyright, and TypeScript language server.
* Full developer interview deep dives are cataloged in the `interview/` directory.

<!-- MARKDOWN LINKS & IMAGES -->
[contributors-shield]: https://img.shields.io/github/contributors/AmanKashyapp07/sandbox-ide.svg?style=for-the-badge
[contributors-url]: https://github.com/AmanKashyapp07/sandbox-ide/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/AmanKashyapp07/sandbox-ide.svg?style=for-the-badge
[forks-url]: https://github.com/AmanKashyapp07/sandbox-ide/network/members
[stars-shield]: https://img.shields.io/github/stars/AmanKashyapp07/sandbox-ide.svg?style=for-the-badge
[stars-url]: https://github.com/AmanKashyapp07/sandbox-ide/stargazers
[issues-shield]: https://img.shields.io/github/issues/AmanKashyapp07/sandbox-ide.svg?style=for-the-badge
[issues-url]: https://github.com/AmanKashyapp07/sandbox-ide/issues
[license-shield]: https://img.shields.io/github/license/AmanKashyapp07/sandbox-ide.svg?style=for-the-badge
[license-url]: https://github.com/AmanKashyapp07/sandbox-ide/blob/main/LICENSE
