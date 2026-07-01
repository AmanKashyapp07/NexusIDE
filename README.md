# NexusIDE: A Collaborative Web IDE with Containerized Execution

NexusIDE is a web-based integrated development environment (IDE) built as a software engineering college project. It allows multiple users to collaborate on code files in real-time, communicate via peer-to-peer audio streams, and run code securely within isolated Docker containers.

---

## Table of Contents
1. [Project Overview](#project-overview)
2. [Objectives](#objectives)
3. [Features](#features)
4. [Tech Stack](#tech-stack)
5. [Project Structure](#project-structure)
6. [Installation](#installation)
7. [Usage](#usage)
8. [Screenshots](#screenshots)
9. [Project Workflow](#project-workflow)
10. [Challenges Faced](#challenges-faced)
11. [Learning Outcomes](#learning-outcomes)
12. [Future Improvements](#future-improvements)
13. [Contributors](#contributors)
14. [Acknowledgements](#acknowledgements)
15. [License](#license)

---

## Project Overview

NexusIDE is designed to replicate the core experience of cloud-based development environments like Gitpod or GitHub Codespaces, tailored for an academic/college project scope. The system addresses two primary challenges: 
- **Real-Time Collaboration**: Ensuring typing conflicts are resolved automatically across concurrent high-frequency text mutations.
- **Secure Code Execution**: Isolating untrusted compiler execution blocks to prevent security vulnerabilities on the host server.

---

## Objectives
- Implement a decentralized conflict resolution engine to synchronize text editors without single-server sequencing bottlenecks.
- Build a container-based sandbox runtime using system resources limits to safely compile and run user code.
- Learn to multiplex standard terminal shells (PTYs) and stream bidirectional character streams over WebSockets.
- Set up a peer-to-peer audio mesh network for voice coordination without routing voice streams through server bandwidth.

---

## Features

- **Real-Time Code Collaboration**: Multiple users can edit documents simultaneously using Yjs CRDTs and Monaco Editor.
- **Visual Presence Tracking**: Real-time cursor coordinates, highlight blocks, and user color indicators are shared across active workspaces.
- **WebRTC P2P Voice Chat**: Ultra-low latency peer-to-peer voice communications mapped over mesh network signaling rooms.
- **Secure Sandbox Execution**: Single-click compiler execution for multiple runtimes (Python, Node, C++, Java, Bash) isolated with cgroups v2 boundaries (100MB memory cap, 0.25 vCPU cap, 64 process limit) and absolute network isolation (`NetworkMode: 'none'`).
- **Interactive Web Terminal**: An interactive `/bin/bash` terminal emulator (xterm.js) mapped to workspace containers, complete with output rate-limiting buffers to protect client UI performance.
- **Relational Tree Directories**: Explorer file trees represented via PostgreSQL adjacency lists, queried efficiently in a single round-trip using recursive Common Table Expressions (CTEs).

---

## Tech Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend** | React, TypeScript, Tailwind CSS | UI components and application layout |
| **Real-Time Core** | Yjs, `y-websocket`, Socket.io | Text conflict resolution and presence broadcasting |
| **Media** | WebRTC (Native Browser APIs) | Decentralized peer-to-peer voice chat |
| **Terminal View** | Xterm.js | Web terminal shell rendering |
| **Backend** | Node.js, Express, TypeScript | REST APIs, database queries, and socket routing |
| **Database** | PostgreSQL | Relational storage for workspaces, collaborators, and files |
| **Sandbox System** | Docker Engine API (Dockerode) | Dynamic container execution and pool provisioning |

---

## Project Structure

```text
├── backend/                  # REST APIs, WebSockets, and Sandbox Controllers
│   ├── src/
│   │   ├── middleware/       # Token authorization and access controls
│   │   ├── routes/           # Routing gates for authentication and workspace operations
│   │   ├── sandbox/          # Docker execution pipelines and container pool management
│   │   ├── terminal/         # Websocket shell connections and rate limiters
│   │   ├── db.ts             # PostgreSQL client initialization
│   │   └── server.ts         # Main server entrypoint (HTTP/WS server binding)
│   └── tests/                # Automated backend test suites (Auth, Workspace, Sandbox)
├── frontend/                 # Client React interface
│   ├── src/
│   │   ├── components/       # Monaco Editor, explorer, terminal views, audio controls
│   │   ├── hooks/            # Socket lifecycle bindings and WebRTC setup
│   │   └── context/          # Collaborative workspace context stores
├── database/                 # Database schema initialization SQL scripts
└── interview/                # Technical deep-dive documentation for architecture prep
```

---

## Installation

### Prerequisites
- Node.js v20+
- PostgreSQL v15+
- Docker Desktop (Running locally, with Unix socket enabled at `/var/run/docker.sock` or `~/.docker/run/docker.sock`)

### 1. Database Setup
Spin up a local PostgreSQL instance and execute the schema file to initialize the tables:
```bash
psql -U your_username -d your_database -f database/schema.sql
```

### 2. Backend Installation
1. Navigate to the backend directory and install dependencies:
   ```bash
   cd backend
   npm install
   ```
2. Create a `.env` file in the `backend/` directory:
   ```env
   PORT=4000
   DATABASE_URL=postgresql://your_user:your_password@localhost:5432/your_database
   JWT_SECRET=your_system_jwt_secret_key
   ```
3. Initialize the server runtime (will build the dev sandbox image and pre-warm container pools):
   ```bash
   npm run dev
   ```

### 3. Frontend Installation
1. Open a new terminal tab, navigate to the frontend folder, and install dependencies:
   ```bash
   cd frontend
   npm install
   ```
2. Launch the Vite bundler locally:
   ```bash
   npm run dev
   ```
3. Open your browser to the local URL (usually `http://localhost:5173`).

---

## Usage

1. **User Sign Up**: Create a user account via the Auth register dashboard interface.
2. **Create Workspace**: Add a new workspace from the home dashboard. The backend bootstraps default files.
3. **Write Code**: Open multiple files. Real-time changes are synchronized across active editors.
4. **Compile & Run**: Click the "Run" button to execute scripts. Output and runtime performance metrics (CPU, Memory peak) are populated in the logs panel.
5. **Open Terminal**: Interact directly with the workspace via a bash web shell.

---

## Screenshots

*Placeholders for frontend snapshots:*
- `![Dashboard View](https://placehold.co/800x450?text=Dashboard+Workspace+View)`
- `![IDE Editor View](https://placehold.co/800x450?text=IDE+Collaborative+Editor+View)`
- `![Sandbox Diagnostics Log](https://placehold.co/800x450?text=Sandbox+Execution+Diagnostics+Logs)`

---

## Project Workflow

```text
  [IDE Frontend (Browser)]
      │
      ├─(WebSockets)──────→ [y-websocket Server (Y.Doc Sync)] ──→ [PostgreSQL (BYTEA storage)]
      ├─(WebSockets)──────→ [PTY WebSocket Handler] <──────────> [Docker Exec (Bash PTY)]
      └─(WebRTC Media)────→ [P2P WebRTC Audio Mesh] (Peer-to-peer bypass)
```

1. **Collaborative Flow**: Edit changes are parsed by Yjs CRDTs locally and broadcasted as binary updates to the backend WebSockets, which applies them and updates PostgreSQL's `yjs_state` column.
2. **Execution Flow**: When execution is requested, the backend packages current workspace files into an in-memory tarball, streams it to a container popped from the warm pool, runs code, extracts kernel metrics from the container's cgroup filesystem, and cleans up the container.

---

## Challenges Faced

- **Race Conditions in File Extraction**: We resolved a race condition where compilation executed before the container finished tar extraction by tracking the hijacked execution socket stream `end` event before invoking compiler runtimes.
- **OT vs CRDT Integration**: Integrating CRDT statevectors over persistent relational database rows required a debounced write-back cache to prevent database connection pool exhaustion.
- **PTY Frame Corruption**: Passing Tty parameters incorrectly resulted in Docker's multiplexed stream headers leaking into xterm.js character parses. We solved this by passing `Tty: true` to both `exec` creation and `exec.start` socket captures.
- **Root Naming Collisions in SQL**: Standard SQL treats `NULL` values as distinct, which historically broke root directory unique constraints (`parent_id = NULL`). We resolved this using PostgreSQL 15's `UNIQUE NULLS NOT DISTINCT` modifier.

---

## Learning Outcomes

- **Linux Sandboxing Primitives**: Practical application of namespaces (`CLONE_NEWNS`, `CLONE_NEWNET`), cgroup limits (v2 unified structures like `memory.peak`), and Seccomp profiles.
- **Bidirectional Stream Multiplexing**: Piping raw characters and tracking escape sequences between browser socket buffers and container process stdin/stdout file descriptors.
- **Distributed State Convergence**: Mathematical logic of Join-Semilattices and conflict resolution strategies in highly concurrent systems.
- **SQL Optimization**: Structuring parent-child relational entities and querying hierarchical directory systems efficiently using Recursive CTEs.

---

## Future Improvements

- **Resource Limit Customization**: Allow admin-level customization of sandbox boundaries (CPU, RAM quotas) per user runtime.
- **Advanced Git Integration**: Supporting Git cloning, staging, and commits directly from the terminal or visual Explorer panel.
- **Debugger Interface Integration**: Hooking execution loops into `gdb` or `ndb` runtimes to step through program blocks visually in the Monaco interface.

---

## Contributors

- **<Aman Kashyap>** - *Core System Architecture* - [<GitHub User Profile>](https://github.com/AmanKashyapp07)

---

## Acknowledgements

- Project guidance provided by the undergraduate software engineering course coordinators.
- Documentation deep-dives compiled inside the [interview/](file:///Users/amankashyap/Documents/sandbox/interview/) subdirectory.
- Library authors and maintainers of Yjs, Dockerode, and Xterm.js.

---

## License

This project is licensed under the MIT License - see the LICENSE file for details.