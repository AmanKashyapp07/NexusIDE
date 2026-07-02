<!-- PROJECT SHIELDS -->
[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![MIT License][license-shield]][license-url]

<!-- PROJECT TITLE -->
<br />
<div align="center">
  <h3 align="center">NexusIDE</h3>

  <p align="center">
    A Collaborative Web IDE with Containerized Execution
    <br />
    <a href="https://github.com/AmanKashyapp07/sandbox-ide"><strong>Explore the docs »</strong></a>
    <br />
    <br />
    <a href="https://github.com/AmanKashyapp07/sandbox-ide">View Demo</a>
    &middot;
    <a href="https://github.com/AmanKashyapp07/sandbox-ide/issues">Report Bug</a>
    &middot;
    <a href="https://github.com/AmanKashyapp07/sandbox-ide/issues">Request Feature</a>
  </p>
</div>

<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li><a href="#about-the-project">About The Project</a></li>
    <li>
      <a href="#architectural-deep-dives">Architectural Deep Dives</a>
      <ul>
        <li><a href="#1-real-time-collaboration--conflict-resolution-yjs--websockets">1. Real-Time Collaboration & Conflict Resolution</a></li>
        <li><a href="#2-containerized-sandbox-execution-dockerode--cgroups-v2">2. Containerized Sandbox Execution</a></li>
        <li><a href="#3-interactive-web-pty-terminals-xtermjs--stream-piping">3. Interactive Web PTY Terminals</a></li>
        <li><a href="#4-hierarchical-file-explorer-postgresql-recursive-ctes">4. Hierarchical File Explorer</a></li>
        <li><a href="#5-github-oauth--automated-workspace-sync">5. GitHub OAuth & Automated Workspace Sync</a></li>
        <li><a href="#6-gemini-powered-ai-inline-code-completions">6. Gemini-Powered AI Inline Code Completions</a></li>
        <li><a href="#7-reactive-file-explorer-sync--command-execution">7. Reactive File Explorer Sync & Command Execution</a></li>
      </ul>
    </li>
    <li><a href="#security-design--mitigations">Security Design & Mitigations</a></li>
    <li><a href="#built-with">Built With</a></li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#key-engineering-challenges--lessons-learned">Key Engineering Challenges & Lessons Learned</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

<!-- ABOUT THE PROJECT -->
## About The Project

NexusIDE is a collaborative, web-based cloud Integrated Development Environment (IDE) designed to replicate the core mechanisms of platforms like Gitpod and GitHub Codespaces. 

Built as a software engineering college project, it focuses on high-performance concurrent editing, secure sandbox isolation, and real-time state synchronization. Multiple developers can open a shared workspace, edit code in real-time, communicate via peer-to-peer audio links, and execute their programs in isolated, resource-constrained container environments.

Rather than relying on third-party SaaS integrations, the backend orchestrates the sandbox pool lifecycle, web socket streams, WebRTC signaling mesh, and relational file systems directly from scratch.

---

<!-- ARCHITECTURAL DEEP DIVES -->
## Architectural Deep Dives

### 1. Real-Time Collaboration & Conflict Resolution (Yjs & WebSockets)

The editing synchronization pipeline uses Conflict-free Replicated Data Types (CRDTs) to resolve editing conflicts deterministically without relying on a central sequencing authority.

* **State Vector Synchronization:** When a client opens a file, it exchanges a "state vector" with the server over WebSockets. This vector describes the client's current version history. The server computes the byte diff in-memory and transmits only the missing operations, minimizing network overhead.
* **In-Memory CRDTs:** The collaborative workspace maintains a Y.Doc instance bound to the Monaco Editor. Keystrokes are transformed into logical operation objects with Lamport timestamps.
* **Durability Layer:** To prevent database overload, character changes are not committed instantly. Instead, a debounced auto-save hook serializes the Yjs state vector into a binary array (PostgreSQL BYTEA) and updates the plain text string after 400ms of inactivity.
* **Stateless Awareness Sharing:** User cursor positions, selections, names, and custom highlights are transmitted using the Yjs Awareness protocol. This metadata is volatile and resides strictly in-memory on the websocket server, bypassing database persistence to achieve sub-50ms latency.

### 2. Containerized Sandbox Execution (Dockerode & cgroups v2)

Compiling and running arbitrary user-written programs requires strict resource containment to protect the host server from malicious scripts (e.g., fork bombs, infinite loops, memory exhaustion).

* **Pre-warmed Sandbox Pools:** Spawning containers from scratch introduces a 2 to 3-second latency. NexusIDE maintains a pre-warmed pool of alpine-based runner containers. When a execution request is received, a container is claimed instantly from the pool, cutting startup time to under 150ms.
* **In-Memory Tarball Hydration:** Files in the PostgreSQL relational explorer are grouped, compressed into a tarball in-memory, and streamed directly into the container using the Docker Engine Socket API. No files are saved to the host disk during compilation.
* **Linux cgroups v2 Enforcement:** CPU and memory quotas are clamped at the container level:
  * Memory limit: 100MB (`--memory="100m"`)
  * CPU quota: 0.25 vCPU (`--cpus="0.25"`)
  * PID limit: 64 processes to prevent fork-bombs
* **Telemetry Diagnostics:** After execution terminates, the controller reads kernel metrics directly from the container's pseudo-filesystem (`/sys/fs/cgroup/memory.peak` for peak memory usage) and calculates execution duration using high-resolution timers before returning the container to the warm pool.
* **Network Isolation:** Run containers with `NetworkMode: 'none'` to block outbound traffic, preventing running code from launching outbound attacks or scanning local networks.

### 3. Interactive Web PTY Terminals (xterm.js & Stream Piping)

Each workspace container exposes a live interactive shell, allowing developers to execute shell commands directly inside their isolated environments.

* **PTY Allocation:** The backend uses the Docker API to invoke `/bin/bash` with Tty enabled (`Tty: true`). This allocates a pseudoterminal (PTY) inside the target runner container.
* **Bidirectional Piping:** Keystrokes captured by the frontend xterm.js terminal are piped as raw character codes over WebSockets. The backend receives these messages and writes them to the PTY's write stream, while stdout/stderr from the container is piped back to the client.
* **Rate-limiting Buffers:** High-output command executions (e.g. `cat /dev/urandom` or large file listings) can choke browser UI threads due to rapid DOM paints. The backend enforces a 50ms chunking buffer that batches output data, ensuring smooth rendering performance.

### 4. Hierarchical File Explorer (PostgreSQL Recursive CTEs)

Managing a virtual file directory structure in a relational database presents tree-traversal challenges.

* **Adjacency List Model:** Explorer directories and files are represented using a parent-child adjacency relationship via the `parent_id` column pointing back to `files.id`.
* **Single-Roundtrip Tree Queries:** When loading a workspace, fetching the nested explorer tree using standard queries requires multiple recursive calls. NexusIDE queries the entire hierarchy in a single DB trip using a recursive Common Table Expression (CTE) query:
  ```sql
  WITH RECURSIVE file_path_cte AS (
      SELECT id, parent_id, name, type, language, name::text as path
      FROM files 
      WHERE workspace_id = $1 AND parent_id IS NULL
      UNION ALL
      SELECT f.id, f.parent_id, f.name, f.type, f.language, (cte.path || '/' || f.name)::text as path
      FROM files f
      INNER JOIN file_path_cte cte ON f.parent_id = cte.id
      WHERE f.workspace_id = $1
  )
  SELECT id, parent_id, name, type, language, path FROM file_path_cte;
  ```
* **Constraint Handling:** Directory structure uniqueness is enforced utilizing partial index constraints to prevent duplicate file names in the same parent folder, keeping root elements (`parent_id IS NULL`) and sub-directories separated.

### 5. GitHub OAuth & Automated Workspace Sync

To remove the friction of manually creating file trees, NexusIDE provides direct GitHub synchronization.

* **OAuth Authorization:** Authentication is handled exclusively through GitHub OAuth. Upon successful authorization, the backend maps the GitHub profile metadata to the relational user record, fetches the user's primary email, and updates their active session.
* **Secure Token Persistence:** Access tokens returned by GitHub are stored securely in the database (`github_token`), allowing the IDE to query personal GitHub repositories on behalf of the authenticated user.
* **Live Repository Dropdown:** The workspace creation page fetches the user's latest repositories using the GitHub API (`/user/repos`) sorted by last updated, rendering a dropdown selector with public/private status indicators.
* **Unpacking & Database Seeding:** When a user selects a repository for import:
  1. The backend fetches the repository's zipball archive from `https://api.github.com/repos/{owner}/{repo}/zipball`.
  2. The ZIP is extracted entirely in-memory using `adm-zip`.
  3. The engine parses the flat ZIP paths, strips the root archive folder, and imports files into the PostgreSQL relational hierarchy level-by-level.
  4. The import applies a strict limit of **500 files** to protect the database transaction pool.

### 6. Gemini-Powered AI Inline Code Completions (FIM Prompts & Client Caching)

To increase coding velocity, NexusIDE integrates a real-time, context-aware code autocomplete provider.

* **Fill-in-the-Middle (FIM) Prompts**: The backend constructs an explicit prefix-suffix completion prompt (`<PREFIX>...<CURSOR>...<SUFFIX>`) and sends it to the Gemini 2.5 Flash model via the official Google GenAI SDK.
* **Deterministic Configuration**: Employs `temperature: 0.1` and customized `stopSequences` to prevent generation overflow or the injection of boilerplate formatting.
* **Client-Side Caching**: A module-level Least Recently Used (LRU) cache (`ghostTextCache`) holds up to 50 prefix/suffix context variations to avoid duplicate API calls for identical states.
* **Typing Debounce & Abort Controllers**: The Monaco provider features a 350ms debounce and links inline suggest signals directly to an `AbortController`. Mid-flight requests are immediately aborted if typing resumes.

### 7. Reactive File Explorer Sync & Command Execution

* **Terminal filesystem changes**: Rather than forcing a static file structure, the container filesystem is writable. A file watcher scans the terminal's workspace directories and automatically propagates changes (touch, mkdir, rm) back to the PostgreSQL database.
* **Manual Refresh Override**: A dedicated refresh UI button in the sidebar explorer allows manual workspace synchronization to ensure the interface is always aligned with the container.
* **Language Run CLI**: A global `run <file>` utility is injected into `/usr/local/bin/run` on container hydration. It automatically detects the file's programming language (Python, Node.js, or C++) and compiles/executes it using the appropriate environment configuration.

---

<!-- SECURITY DESIGN & MITIGATIONS -->
## Security Design & Mitigations

* **Broken Object-Level Authorization (BOLA):** Route parameters are checked using custom database authorization middleware (`requireWorkspaceRole`). Swapping workspace UUIDs in REST calls yields a `403 Forbidden` if the authenticated user is not explicitly enrolled as a collaborator.
* **Malicious Code Isolation:** Sandbox containers are decoupled from host networking and limited dynamically in execution duration (maximum 10-second timeout).
* **Environment Variable Safeguards:** The database credentials, GitHub Client Secrets, and JWT secrets are injected strictly via system environment variables, ensuring zero credential leak vulnerabilities in the code repository.

---

<!-- BUILT WITH -->
## Built With

The project uses a modern web stack designed for real-time streaming operations:
* **Frontend:** React, TypeScript, Tailwind CSS, Monaco Editor, Xterm.js, Socket.io-client
* **Backend:** Node.js, Express, TypeScript, Socket.io, ws, Dockerode, adm-zip, axios
* **Database:** PostgreSQL (relational directory models and CRDT binary storage)
* **Infrastructure:** Docker Engine API (development sandbox runners)

---

<!-- GETTING STARTED -->
## Getting Started

Follow these steps to set up your local development environment.

### Prerequisites

* **Node.js**: v20 or higher
* **PostgreSQL**: v14 or higher (running locally on port 5432)
* **Docker Engine**: Running locally (Docker Desktop or Docker Daemon with access to the Unix socket `/var/run/docker.sock`)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/AmanKashyapp07/sandbox-ide.git
   cd sandbox-ide
   ```

2. Initialize the Database Schema:
   Ensure your local PostgreSQL server is running, create a database named `sandbox`, and run the schema script:
   ```bash
   psql -d sandbox -f database/schema.sql
   ```

3. Configure Backend Environment:
   Create a `.env` file in the `backend/` directory:
   ```env
   PORT=4000
   DATABASE_URL=postgresql://your_db_username@localhost:5432/sandbox
   JWT_SECRET=your_jwt_secret_key
   GITHUB_CLIENT_ID=your_github_oauth_client_id
   GITHUB_CLIENT_SECRET=your_github_oauth_client_secret
   ```
   *(Note: You can register a GitHub OAuth app in Settings -> Developer Settings -> OAuth Apps. Set Homepage to `http://localhost:5173` and Authorization Callback URL to `http://localhost:4000/api/auth/github/callback`)*

4. Launch the Backend Server:
   ```bash
   cd backend
   npm install
   npm run dev
   ```
   *(This starts the Express server, pre-warms the Docker sandbox pool, and verifies database connectivity)*

5. Launch the Frontend Client:
   Open a new terminal tab, navigate to the frontend directory:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Open `http://localhost:5173` in your browser.

---

<!-- USAGE -->
## Usage

1. **Secure Login:** Click the "Continue with GitHub" button to authenticate.
2. **Dashboard Management:** Click "New Workspace" to create a fresh coding workspace, or use the "Import GitHub" widget. Select one of your repositories from the dropdown list (or paste any public GitHub repository URL) to pull the files and build the workspace.
3. **Write & Edit Code:** Open the workspace, select files in the tree view, and edit them. Open the same URL in a separate window to watch real-time synchronizations.
4. **Command-Line Code Execution:** Run Python, Node.js, and C++ scripts directly inside the terminal panel using the global `run <file_name>` tool which automatically compiles and executes the file.
5. **Interactive Bash Shell:** Interface directly with your sandbox environment via terminal commands, edit/create files, and watch changes instantly reflect in the Explorer tree (or use the Refresh icon to force sync).

---

<!-- ROADMAP -->
## Roadmap

- [x] Exclusive GitHub OAuth Integration
- [x] GitHub Workspace Import Engine (Plan A)
  - [x] Fetch zipball via API
  - [x] Memory unpacking & Adjacency lists insertion (500 file cap)
  - [x] Live dropdown listing of user repositories
- [x] Gemini-powered AI inline code completions with client-side caching & FIM prompts
- [x] Terminal file structure reactive syncing with manual refresh UI override
- [x] Global terminal run utility with multi-language detection
- [x] Terminal-based Git integration (Plan B)
- [x] Workspace collaborator invite UI
- [x] Sandbox pre-warm pool optimization (Static pool selected for efficiency)

---

<!-- KEY ENGINEERING CHALLENGES & LESSONS LEARNED -->
## Key Engineering Challenges & Lessons Learned

* **Express Route Overlap Conflict:** Dynamic Express routes like `router.get('/:id')` conflict with static paths like `router.get('/github-repos')` if the static route is registered below the parameterized path. We resolved this routing collision by ordering all static routes above parameterized paths.
* **ES Module Hoisting with Dotenv:** ES6 `import` statements are hoisted and executed before any regular code blocks run. This caused database connections to be initialized before `dotenv.config()` could execute, resulting in undefined credentials. We resolved this by loading environment variables lazily within the handlers.
* **Root Folder Null Constraints:** Standard SQL treats `NULL` values as distinct, which allowed duplicate files at the root directory level since `parent_id` is null. We resolved this by creating partial indices filtering on `WHERE parent_id IS NULL` to enforce unique constraints at the root tree level.
* **PTY Stream Multiplexing:** Docker multiplexes stdout and stderr streams using a custom 8-byte header structure. Piping this directly into xterm.js caused corrupt characters. We resolved this by enabling Tty options on container execution to strip multiplex headers and return raw clean ANSI strings.

---

<!-- CONTRIBUTING -->
## Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

<!-- LICENSE -->
## License

Distributed under the MIT License. See `LICENSE` for more information.

---

<!-- CONTACT -->
## Contact

Aman Kashyap - [@AmanKashyapp07](https://github.com/AmanKashyapp07) - iit2024140@iiita.ac.in

Project Link: [https://github.com/AmanKashyapp07/sandbox-ide](https://github.com/AmanKashyapp07/sandbox-ide)

---

<!-- ACKNOWLEDGMENTS -->
## Acknowledgments

* Course coordinators for the software engineering project guidance.
* Maintainers of Yjs, Monaco Editor, Xterm.js, and Dockerode.
* Full developer interview deep dives are cataloged in the [interview/](file:///Users/amankashyap/Documents/sandbox/interview/) directory.

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
[React.js]: https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB
[React-url]: https://reactjs.org/
[Tailwind.css]: https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white
[Tailwind-url]: https://tailwindcss.com/
[Express.js]: https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white
[Express-url]: https://expressjs.com/
[Node.js]: https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white
[Node-url]: https://nodejs.org/
[Postgres.sql]: https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white
[Postgres-url]: https://www.postgresql.org/
[Docker.com]: https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white
[Docker-url]: https://www.docker.com/
[TypeScript.svg]: https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white
[TypeScript-url]: https://www.typescriptlang.org/