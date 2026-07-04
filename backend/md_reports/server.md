# Backend Engineering Chapter: `backend/src/server.ts`

## The Problem This File Exists to Solve

A collaborative cloud IDE is not a normal CRUD web application. A normal Express app can receive an HTTP request, run a database query, send JSON, and forget the client exists. NexusIDE has to do more than that. It must serve ordinary REST APIs, real-time collaborative editing, terminal streams, language-server streams, WebRTC signaling, and presence updates from the same backend process.

The first-principles problem is protocol coordination. Browsers do not interact with a cloud IDE through one kind of connection. A dashboard request is short-lived HTTP. A Monaco editor session is a long-lived CRDT synchronization channel. A terminal is a byte stream connected to a Docker pseudo-terminal. Voice chat needs signaling messages but should not send audio through the backend. If these concerns are scattered randomly across route files, the system becomes impossible to reason about. `server.ts` is the composition root: the place where environment configuration, Express routing, HTTP upgrade handling, raw WebSocket routing, Socket.IO presence, CRDT persistence, server boot, and shutdown policy are assembled into one process.

A beginner might create separate servers for every feature: one Express server, one WebSocket server for Yjs, another WebSocket server for terminals, and a Socket.IO server for presence. That works locally, but it creates port sprawl, CORS confusion, authentication inconsistencies, and deployment complexity. In production, platforms often terminate traffic through one load balancer, one public service, and one process entrypoint per deployable unit. This file follows that idea: one Node HTTP server owns the port, and different protocols are multiplexed behind it.

The mental model is an airport terminal. HTTP requests, Socket.IO connections, Yjs sockets, LSP sockets, and terminal sockets all arrive at the same airport. `server.ts` is air traffic control. It does not fly every plane itself, but it decides which runway each connection belongs to, verifies identity, and delegates to specialized handlers.

## The Startup Story

The first important operation is loading environment variables:

```ts
import dotenv from 'dotenv';
dotenv.config();
```

Environment variables are not just configuration convenience. They are the boundary between code and deployment. GitHub OAuth secrets, JWT signing keys, database URLs, and port numbers are operational facts, not source-code facts. A naive backend hardcodes these values. That fails immediately when staging, production, and local development need different values. The production solution is to inject environment-specific configuration at process startup.

The file then suppresses global console methods. Architecturally, this is an observability decision, although an aggressive one. Logging can become a hidden cost center in real-time systems because every keystroke, WebSocket event, container lifecycle event, and dependency warning can flood stdout. The code disables logging globally to keep noisy libraries quiet. The production alternative would be structured logging with severity levels, sampling, request IDs, and log sinks such as Pino, Winston, OpenTelemetry, or a cloud logging agent. If an interviewer asks about this line, the strongest answer is: it demonstrates awareness of logging cost and noise, but a production system should replace global suppression with structured, configurable logging because suppressing `console.error` also hides failures.

Express is created next:

```ts
const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/workspace', requireAuth, workspaceRoutes);
```

The separation here matters. Authentication routes are public because `/api/auth/github` must start the login flow and `/api/auth/github/callback` must receive GitHub's callback before the user owns a local JWT. Workspace routes are protected by `requireAuth` because they operate on user-owned workspaces, files, collaborators, containers, and AI completions. If the route-level middleware were removed, every workspace route would need to remember to authenticate itself. That is how authorization bugs happen in real systems: not because engineers do not know security matters, but because security is repeated manually across many handlers.

The Express app is wrapped in a raw Node HTTP server:

```ts
const server = http.createServer(app);
```

This is one of the most important architecture decisions in the file. Express understands HTTP routing, but WebSockets begin as HTTP upgrade requests. If the backend only called `app.listen`, it would lose direct control over the `upgrade` event. By creating the HTTP server explicitly, the backend can attach Express for REST and also intercept WebSocket upgrades for terminal, LSP, and Yjs traffic.

In production terms, this is protocol demultiplexing. GitHub Codespaces, browser-based terminals, collaborative editors, and multiplayer systems often use this pattern: one server socket receives traffic, and the application routes by URL path and protocol.

## CRDT Persistence as a Durability Layer

Collaborative editing is difficult because users can type concurrently. The naive solution is to save the entire file contents after every keystroke. That fails in three ways. First, it overloads the database under real typing rates. Second, it loses concurrency metadata, so conflict resolution becomes a last-write-wins race. Third, it makes multi-user edits non-deterministic when network latency reorders messages.

The production solution is to use a CRDT. A `Y.Doc` is like a shared notebook where each participant keeps a local copy. Instead of shipping the whole notebook after every edit, participants exchange operations. Those operations contain enough logical history for every replica to converge even if updates arrive in different orders.

`setPersistence` binds Yjs document lifecycle to PostgreSQL:

```ts
setPersistence({
  bindState: async (docName, ydoc) => { ... },
  writeState: async (docName, ydoc) => { ... }
});
```

`bindState` is invoked when a Yjs document room becomes active. The room name is expected to encode `workspaceId-fileId`. The UUID regex is not cosmetic; it prevents arbitrary WebSocket room names from being treated as database-backed file documents. After parsing the file ID, the code loads `content` and `yjs_state` from PostgreSQL. If `yjs_state` exists, it applies the binary CRDT update. If not, it falls back to plain text content.

That fallback is an important migration pattern. Production systems often evolve storage formats. A file may have existed before CRDT persistence was introduced. Rather than requiring a migration that instantly rewrites every row, the server can lazily initialize a CRDT document from legacy text.

The debounced save inside `ydoc.on('update')` solves the database pressure problem. A keystroke stream can emit many updates per second. Saving every update directly to PostgreSQL would produce write amplification: one human typing becomes dozens of database writes. The 400 ms debounce turns a burst of edits into one durable snapshot. It also updates plain text `content`, which helps non-CRDT consumers such as exports, execution hydration, and terminal synchronization.

The trade-off is durability latency. If the process crashes within the debounce window, the latest few hundred milliseconds of edits may not be flushed. That is a reasonable trade-off for an IDE project, but a Google-scale collaborative editor might use an append-only operation log, replicated storage, periodic snapshots, and durable queues.

The call to `syncFileToTerminal(workspaceId, fileId, content)` connects collaborative editing to the terminal filesystem. Without it, the browser editor and terminal would drift: typing in Monaco would update PostgreSQL but not the running container's `/app` directory. The backend treats PostgreSQL/Yjs as the source of truth and mirrors changes into Docker as an operational cache.

## Protocol Multiplexing: One Port, Many Behaviors

Every WebSocket starts as an HTTP upgrade request. `server.on('upgrade')` is where the backend chooses which WebSocket subsystem receives the connection:

```ts
if (url.pathname.startsWith('/socket.io/')) return;
wss.handleUpgrade(request, socket, head, ...);
```

Socket.IO manages its own upgrade path, so this file intentionally yields those requests. All other WebSocket upgrades are sent to a raw `ws` server. The distinction matters because Yjs, terminal streams, and language servers expect raw binary WebSocket semantics, while Socket.IO adds its own framing, reconnection, rooms, and event protocol.

A beginner might use Socket.IO for every real-time feature. That is tempting because Socket.IO makes events easy. It fails for terminal and Yjs because those systems do not want named events; they want byte streams and protocol-specific binary frames. The production solution is to use the right transport abstraction for each traffic pattern.

## Raw WebSocket Routing and Authorization

The `wss.on('connection')` block is the security gate for non-Socket.IO WebSockets. It first delegates terminal and LSP paths:

```ts
if (url.pathname.startsWith('/terminal/')) return await handleTerminalConnection(ws, req);
if (url.pathname.startsWith('/ws/lsp/')) return await handleLspConnection(ws, req);
```

This keeps stream-specific logic out of `server.ts`. The entrypoint decides the destination; specialized files own protocol details.

For Yjs collaborative editing, the file verifies a JWT from the query string. Query-token authentication is common for browser WebSockets because setting custom headers from the browser WebSocket API is limited. The trade-off is that query tokens can leak through logs if infrastructure logs full URLs. A production version would reduce token lifetime, avoid logging upgrade URLs, or use a short-lived WebSocket ticket minted by an authenticated HTTP endpoint.

The authorization query checks workspace ownership, collaborator role, and public visibility. This is a Broken Object Level Authorization defense. It is not enough for a client to know a workspace UUID; the server must prove the user has rights to that workspace at connection time.

The viewer-role interception is a clever but fragile security layer:

```ts
ws.on = (event, listener) => { ... drop Yjs edit messages ... };
```

The first-principles problem is read-only collaboration. A viewer should receive document state but not mutate it. A naive solution disables the frontend editor. That fails because clients are untrusted; a user can modify JavaScript or send WebSocket messages manually. The production solution enforces read-only permissions server-side.

This project intercepts Yjs binary sync messages and allows only the initial state-vector request while dropping edit updates. The advantage is that it avoids modifying Yjs internals. The disadvantage is coupling to Yjs protocol byte layout. If Yjs changes framing, this enforcement could break. In a production system, one might use provider-level authorization hooks, separate read-only replication channels, or a server-side CRDT gateway that validates updates explicitly.

## Socket.IO Presence and WebRTC Signaling

Socket.IO is used for data that is naturally event-shaped: presence updates, active-file announcements, and WebRTC signaling. Presence is stored in memory:

```ts
const workspacePresence = new Map<string, Map<string, any>>();
```

Presence is ephemeral. If the server crashes, nobody needs yesterday's cursor presence. Storing it in PostgreSQL would add latency and contention for data that is only meaningful while sockets are connected. This is the same principle used in chat typing indicators, game lobbies, and collaborative cursor systems.

The trade-off is horizontal scaling. In one Node process, an in-memory map is simple and fast. With many backend instances behind a load balancer, users in the same workspace may land on different processes. Then each process has an incomplete presence map. Production Socket.IO deployments solve this with a Redis adapter, sticky sessions, or a separate presence service.

WebRTC signaling is another important design choice. Audio data does not flow through the backend. The server only relays offers, answers, and ICE candidates. Once peers establish a WebRTC connection, audio flows peer-to-peer. The naive alternative is to send all audio through the Node server. That is simpler to reason about, but it scales poorly because media bandwidth is expensive. Real systems use SFUs or peer-to-peer depending on group size and reliability requirements.

## Server Boot and Graceful Shutdown

The boot block starts listening only outside tests:

```ts
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    warmPoolManager.initializePools().catch(() => {});
    getPool().query('SELECT NOW()', ...);
  });
}
```

This is testability through side-effect control. Importing `server.ts` in tests should not bind a port or start Docker containers. Exporting `app` and `server` lets tests mount the Express app directly.

Warm pool initialization happens at boot because container cold starts are user-visible latency. The system chooses to pay startup cost once instead of making the first code execution wait. The database health check validates connectivity early.

The shutdown handlers catch `SIGINT` and `SIGTERM`. In container orchestration systems such as Kubernetes, processes are expected to clean up on termination. Without cleanup, warm containers can become orphaned Docker resources consuming memory and CPU after the Node process exits.

## Interview Discussion: Protocol Multiplexing

Interviewer:
"Why not just run separate servers on separate ports for REST, collaboration, terminal, and voice?"

Candidate:
"Separate ports are easier for a prototype, but they push complexity into deployment, CORS, auth, routing, and load balancing. This backend uses one Node HTTP server as the public entrypoint. Express handles normal HTTP, Socket.IO attaches to the same server for event-based real-time features, and the raw `upgrade` handler routes binary WebSocket protocols to `ws`. That mirrors how production systems multiplex protocols behind one service boundary. It also centralizes authentication and makes the frontend simpler because it talks to one backend origin."

Interviewer:
"What is the downside?"

Candidate:
"The entrypoint becomes critical infrastructure. If `server.ts` grows too much, it can become a god file. In a larger system I would keep this file as composition only, push protocol details into handlers, and use infrastructure like ingress rules, Redis Socket.IO adapters, and separate services if scaling characteristics diverge."

## Interview Discussion: CRDT Persistence

Interviewer:
"Why don't you save directly to PostgreSQL after every keystroke?"

Candidate:
"A keystroke is not a good database transaction boundary. Human typing can generate frequent updates, and multiple collaborators multiply that write rate. Saving every keystroke would overload the DB and still would not preserve enough concurrency metadata to merge edits correctly. Yjs keeps a CRDT document in memory, and the backend debounces persistence to PostgreSQL. The database stores both the binary Yjs state for conflict-free history and plain content for non-CRDT consumers."

Interviewer:
"What happens if the process crashes before the debounce fires?"

Candidate:
"There is a small durability window. For a production editor, I would add an append-only operation log or a durable queue so every CRDT update is recorded cheaply before snapshotting. This implementation chooses simplicity and lower DB pressure, which is appropriate for a project but not the final design for a globally distributed editor."

## Engineering Lessons

- A backend entrypoint should compose protocols without owning every protocol's details.
- WebSocket systems still need server-side authorization; disabling UI controls is not security.
- CRDTs solve concurrent editing by preserving operation history, not by overwriting text.
- Presence belongs in fast ephemeral storage; durable documents belong in persistent storage.
- Protocol choice matters: Socket.IO events, raw WebSocket byte streams, and HTTP routes solve different problems.
- Graceful shutdown is part of resource management when the backend creates external resources such as Docker containers.

## Common Mistakes

- Treating WebSocket connections as trusted after the initial HTTP login.
- Using Socket.IO for binary protocols that expect raw WebSocket frames.
- Saving collaborative text with last-write-wins semantics.
- Persisting ephemeral presence to the primary relational database.
- Ignoring horizontal scaling implications of in-memory maps.
- Hiding all logs globally in production instead of using structured logging controls.

## Production Improvements

- Replace global log suppression with structured logging, request IDs, trace IDs, and sampling.
- Use short-lived WebSocket tickets instead of long-lived JWTs in query strings.
- Move in-memory presence to Redis or a Socket.IO Redis adapter for multi-instance deployments.
- Persist CRDT updates through an append-only event log before debounced snapshots.
- Add metrics around WebSocket counts, save latency, dropped viewer updates, and Docker pool status.
- Use a stronger read-only CRDT enforcement layer that does not depend on raw protocol byte positions.
- Add graceful HTTP server draining before process exit.

## Interview Revision

`server.ts` is the backend composition root. It loads configuration, creates Express, wraps it in an HTTP server, attaches REST routes, handles raw WebSocket upgrades, delegates terminal and LSP streams, configures Yjs persistence, runs Socket.IO presence and WebRTC signaling, starts Docker warm pools, and cleans up on shutdown.

The most defensible architecture points are:

- One port can serve REST, Socket.IO, and raw WebSockets by owning the Node HTTP server.
- CRDT state is stored as binary Yjs updates because plain text is not enough for concurrent editing.
- Debounced persistence protects PostgreSQL from keystroke-level write amplification.
- Viewer permissions are enforced on the server-side WebSocket stream, not only in the frontend.
- Socket.IO is used where rooms and event semantics help; raw `ws` is used where protocol bytes matter.
- In-memory presence is fast and appropriate for ephemeral state, but it requires Redis or sticky sessions at scale.

