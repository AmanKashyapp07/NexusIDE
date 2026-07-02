# Backend Engineering Chapter: `backend/src/terminal/lspHandler.ts`

## Why an LSP Bridge Exists

Modern code editors feel intelligent because a language server runs nearby. The editor asks for completions, hover information, diagnostics, and symbol data through the Language Server Protocol. In a local IDE, Monaco or VS Code can spawn language servers on the same machine. In a browser IDE, the browser cannot safely run Pyright or TypeScript language server with access to the workspace filesystem.

The backend must therefore bridge the browser to a language server running inside the workspace container. That bridge must preserve LSP's JSON-RPC byte stream, enforce authorization, manage container lifecycle, and avoid leaking resources.

A beginner might run one global language server on the backend host. That fails because each workspace has different files and dependencies. It also creates cross-user isolation risks. The production solution is to run the language server inside the same isolated workspace container that holds the user's files.

The mental model is a translator sitting between Monaco and a containerized language expert. Monaco speaks LSP over WebSocket. The language server speaks LSP over stdio. This file pipes those two conversations together without interpreting the language semantics.

## Idle Timeout as Resource Governance

Language servers are memory-heavy. Pyright and TypeScript servers can easily consume hundreds of megabytes in large projects. Keeping them alive forever after a tab disappears wastes host resources.

`IDLE_TIMEOUT_MS` closes idle LSP connections after 15 minutes. This is not primarily a UX feature; it is capacity protection. Systems that expose long-lived developer tooling must define what "unused" means. Without idle timeouts, one user can open many workspaces, walk away, and leave language servers consuming memory.

The trade-off is cold restart latency. If a user returns after the timeout, the language server must start again. Production systems often combine idle timeouts with warm pools, persisted indexes, or project-size-aware policies.

## Early Message Buffering

The WebSocket can receive messages before Docker `exec.start()` finishes. LSP clients often send `initialize` immediately after the socket opens. If the backend attaches the WebSocket listener only after the container stream is ready, the initialize packet can be lost.

The file solves this with `messageQueue`. Incoming messages are always accepted. If the exec stream is not ready, they are buffered. Once the stream is ready, the queue is flushed.

This is a classic distributed systems lesson: connection establishment and backend readiness are not the same event. A TCP/WebSocket connection may be open while the downstream dependency is still starting. Good bridge code absorbs that timing gap.

The trade-off is memory. If the downstream stream never becomes ready and the client sends many messages, the queue can grow. This implementation relies on early validation and setup success. A production system would cap the queue and close the socket if buffering exceeds a limit.

## Authorization Before Resource Allocation

The handler parses the workspace ID, language, and token from the URL, verifies the JWT, then queries PostgreSQL for workspace ownership or collaborator role. Only editors and admins can spawn LSP processes.

This is important because LSP servers are compute resources. A viewer may be allowed to read files, but allowing every viewer to start language servers would let read-only visitors consume CPU and memory. Authorization is not only about data visibility; it is also about resource usage.

The naive frontend-only solution would hide IntelliSense for viewers. That fails because a client can open the WebSocket manually. This file enforces the policy before creating a container exec process.

## Language Selection

The supported mapping is intentionally narrow:

```text
python -> pyright-langserver --stdio
javascript/typescript -> typescript-language-server --stdio
```

LSP is a protocol, but every language server is an executable with its own installation and resource profile. A production system cannot blindly run any command requested by the client. This whitelist protects the container from arbitrary process spawning and keeps operational expectations clear.

Adding a language requires three layers to agree:

1. The terminal image must include the language server binary.
2. This handler must map the language to a safe command.
3. The frontend editor must request that language.

That coordination is a good example of backend/frontend contract design.

## Docker Exec Stream and JSON-RPC Preservation

The handler starts the language server inside the workspace container with `Tty: false`. That matters. LSP over stdio is not a terminal protocol. It expects exact byte framing with headers such as `Content-Length`. A PTY can transform output, line endings, control characters, or buffering behavior. Using non-TTY stdio is the correct choice for machine protocols.

However, Docker non-TTY streams are multiplexed. Docker wraps stdout and stderr with 8-byte headers. The handler manually parses frames:

```text
8-byte Docker header
payload bytes
8-byte Docker header
payload bytes
```

Only stdout payloads are forwarded to the browser because LSP messages are on stdout. Stderr is logged as diagnostic noise. If the handler forwarded raw Docker frames, Monaco would receive corrupt JSON-RPC and fail to parse messages.

The first-principles lesson is that bridges must preserve protocol boundaries. They are not allowed to "mostly work" with strings when the downstream protocol is byte-framed.

## Cleanup and Shared Container Lifecycle

The LSP does not create its own fresh container. It calls `getOrCreateWorkspaceContainer`, meaning it shares the same hydrated workspace runtime as the terminal and preview server. That gives the language server access to the same files and installed dependencies.

On close or error, cleanup destroys the exec stream and calls `releaseWorkspaceContainer`. Because workspace containers are reference-counted, releasing the LSP does not necessarily remove the container if a terminal tab is still attached.

The `containerReleased` flag makes cleanup idempotent. Network systems often emit multiple failure events: `error`, `close`, and catch blocks can all run. Without an idempotency guard, release could run twice and decrement the reference count incorrectly.

## Interview Discussion: Why Not Run LSP in the Browser?

Interviewer:
"Why does the backend need to bridge language servers? Couldn't Monaco run them in the browser?"

Candidate:
"Some language intelligence can run in the browser, but real language servers need filesystem access, project dependencies, and often native or Node/Python runtimes. In this IDE, the authoritative workspace runtime is the Docker container. Running Pyright or TypeScript language server inside that container gives diagnostics based on the actual project files and installed dependencies. The backend bridges WebSocket bytes to the server's stdio stream."

Interviewer:
"Why use `Tty: false`?"

Candidate:
"LSP is not an interactive terminal. It is JSON-RPC over stdio with exact `Content-Length` framing. A PTY can alter stream behavior. Non-TTY preserves machine protocol bytes, but Docker multiplexes stdout and stderr, so this handler strips Docker frame headers before forwarding stdout to the browser."

## Engineering Lessons

- Browser IDEs often need backend bridges for tools that require filesystem and runtime access.
- Authorization protects compute resources, not just database rows.
- A WebSocket being open does not mean the downstream stream is ready; buffering prevents startup races.
- Machine protocols should use non-TTY streams and preserve byte framing.
- Cleanup must be idempotent in event-driven network code.

## Common Mistakes

- Starting language servers before checking workspace permissions.
- Running language servers globally and mixing project contexts.
- Using a PTY for LSP and corrupting JSON-RPC framing.
- Forgetting Docker's 8-byte multiplexing headers.
- Dropping early `initialize` messages during container startup.
- Releasing shared containers more than once.

## Production Improvements

- Cap the early message queue.
- Add per-workspace or per-user LSP concurrency limits.
- Cache language-server indexes for large projects.
- Emit metrics for LSP startup time, memory usage, idle timeout closures, and unsupported language requests.
- Support more languages through explicit safe command registrations.
- Move LSP sessions to dedicated worker nodes for large-scale deployments.

## Interview Revision

`lspHandler.ts` bridges Monaco's browser WebSocket to a language server running inside the user's workspace container. It authenticates the user, verifies editor/admin role, starts the correct language server over stdio, buffers early client messages, strips Docker stream headers, forwards stdout JSON-RPC to the browser, logs stderr, enforces idle timeout, and releases the shared workspace container safely.

The core explanation: LSP is a byte-precise machine protocol, so the backend acts as a secure stream bridge, not a JSON API.

