# Backend Engineering Chapter: `backend/src/sandbox/workspaceContainer.ts`

## Why Workspace Containers Need Their Own Registry

An IDE terminal is not the same as a run-code request. A run-code request is transactional: execute this program, return output, destroy the environment. A terminal is conversational. The user expects state to persist across commands, browser tabs, language-server sessions, preview servers, file edits, and dependency installs.

The first-principles problem is session identity. If the same user opens the same workspace in two tabs, both tabs should see the same terminal filesystem. If each tab creates a new container, the user gets split-brain development environments. One tab installs dependencies, the other tab cannot see them. One tab creates files, the other tab talks to a different shell. That is not an IDE; it is two unrelated containers.

This file creates a registry keyed by `userId-workspaceId`. The registry maps a logical workspace session to exactly one running Docker container, plus a reference count. The container becomes the mutable runtime mirror of the persistent workspace stored in PostgreSQL.

The mental model is a hotel room key. A workspace container is the room. Multiple browser tabs are duplicate keys for the same guest and room. The hotel should not create a new room every time the guest asks for another key.

## The Universal Run Script

The file defines `RUN_SCRIPT`, a shell script that maps file extensions to runtime commands. From first principles, beginners often force users to remember language-specific commands:

- `python3 main.py`
- `node index.js`
- `g++ main.cpp -o main && ./main`
- `javac Main.java && java Main`

That is acceptable in a raw terminal, but a web IDE benefits from a consistent abstraction. `run <filename>` becomes a small developer-experience layer. It reduces friction and makes the sandbox feel intentional rather than merely a Docker shell.

The trade-off is simplicity versus flexibility. Extension-based dispatch works for common files, but real projects often need custom build systems, package scripts, environment variables, or multi-file compilation. A larger system would support workspace-level run configurations, similar to VS Code tasks or GitHub Codespaces devcontainer commands.

## Reference Counting as Lifecycle Control

The registry stores:

```ts
interface WorkspaceContainerRef {
  container: Docker.Container;
  id: string;
  refCount: number;
  hostPort?: number;
}
```

Reference counting solves a common lifecycle bug. If one tab closes, the backend receives a WebSocket close event. If the backend immediately deletes the container, any other open tab or language server using that container is broken. Reference counting lets every consumer increment the count when it attaches and decrement when it leaves. The container is removed only when the count reaches zero.

A naive implementation might keep containers forever until server shutdown. That preserves state but leaks memory. Another naive implementation might delete on first disconnect. That saves memory but breaks multi-tab workflows. Reference counting is the middle ground.

The hidden assumption is that every caller releases exactly once. If a close event is missed or a code path forgets to call `releaseWorkspaceContainer`, containers leak. If release is called twice, active sessions can be killed early. Production systems often combine reference counting with leases, heartbeats, idle timeouts, and reapers.

## Hydrating the Container from PostgreSQL

When no container exists for the user-workspace pair, the file claims a terminal container from `warmPoolManager.popTerminalContainer()` and hydrates it from the database.

The workspace file tree is stored relationally as an adjacency list: each file has an optional `parent_id`. To reconstruct paths, the code uses a recursive CTE. This avoids the N+1 query problem where every directory causes another database round trip. One SQL query produces every path and content row.

The data flow is:

```text
PostgreSQL files table
        |
        v
Recursive CTE produces path/content/type
        |
        v
tar-stream archive in Node memory
        |
        v
Docker exec: tar -x -C /app
        |
        v
Running workspace container
```

The important engineering choice is tar streaming. Docker has `putArchive`, but the comments explain that `/app` is tmpfs-backed and `putArchive` can fail for that use case. More generally, tar streaming is a good systems pattern because it moves many files over one stream rather than many separate Docker exec calls. A beginner might create each file with a separate `echo > file` command. That fails with quoting bugs, poor performance, binary-file issues, and excessive Docker API calls.

## Bootstrapping the Runtime Environment

After file hydration, the code installs the `run` command globally inside the container:

```text
cp /app/.run.sh /usr/local/bin/run
chmod +x /usr/local/bin/run
rm -f /app/.run.sh
```

This is a runtime bootstrap step. The base terminal image contains language runtimes, but each workspace needs its own file tree and helper command. Installing the helper at hydration time keeps the image generic and the workspace behavior consistent.

The file also starts `npm install` in detached mode if `package.json` exists and `node_modules` does not. This is a latency trade-off. The user gets terminal control immediately while dependency installation happens in the background. A synchronous install would make the terminal feel frozen. A detached install can surprise users if they run commands before dependencies finish. Production developer environments often solve this with explicit setup progress indicators, lifecycle tasks, or prebuilds.

## Registry Accessors and Preview Routing

`getRunningContainer` and `getRunningContainerRef` expose read-only access to the active registry. The preview proxy in the workspace route uses `getRunningContainerRef` to find the `hostPort` mapped from the container's port 3000.

This is an example of separation of concerns. The preview proxy should not know how containers are created or reference-counted. It only needs to ask, "Is there a running container for this user and workspace, and what host port is it bound to?"

If this file were removed, terminal sessions, LSP sessions, and preview proxying would lose the shared runtime identity layer. The system could still execute one-shot code, but it would no longer provide a coherent cloud IDE environment.

## Interview Discussion: Shared Workspace Containers

Interviewer:
"Why not create a separate terminal container for every browser tab?"

Candidate:
"Because the terminal represents workspace runtime state, not a tab. If every tab got a new container, dependency installs, generated files, running dev servers, and language-server state would diverge. The registry uses `userId-workspaceId` as the identity key so all tabs for the same user and workspace share one runtime. Reference counting prevents early teardown while any tab still uses it."

Interviewer:
"What if two different users open the same workspace?"

Candidate:
"This implementation keys by user and workspace, so different users get separate containers. That avoids shell-level interference and credential leakage between collaborators. The persistent database and Yjs layer synchronize files, while each user's terminal environment remains isolated."

## Interview Discussion: Hydration

Interviewer:
"Why hydrate with a tar stream instead of creating files one by one?"

Candidate:
"A workspace is a filesystem tree. Sending each file through a separate Docker exec call would create many API round trips and quoting problems. A tar stream preserves paths and directory structure and moves the whole tree through one stream. It is the same reason deployment systems package artifacts before shipping them to a host."

## Engineering Lessons

- Stateful developer environments need an identity map separate from stateless request handling.
- Reference counting is a simple lifecycle tool but requires disciplined acquire/release symmetry.
- Recursive CTEs are powerful for turning relational adjacency lists into filesystem paths.
- Streaming archives are a robust way to move file trees across process or container boundaries.
- Runtime bootstrap can improve UX, but background setup should be visible in production systems.

## Common Mistakes

- Creating one container per tab and fragmenting workspace state.
- Deleting a container when one socket closes even though other consumers still use it.
- Hydrating file trees with many shell commands instead of a streamable archive.
- Assuming `npm install` is instant or safe to block terminal startup.
- Sharing one container across different users and leaking credentials or shell state.

## Production Improvements

- Add idle expiration for containers whose ref count is zero but cleanup failed.
- Use container labels and a background reaper to recover from missed releases.
- Surface background dependency-install status to the frontend.
- Support configurable workspace startup commands instead of only automatic `npm install`.
- Persist or snapshot selected runtime state if containers are evicted.
- Replace in-process registry with a distributed session registry when horizontally scaling.

## Interview Revision

`workspaceContainer.ts` gives the cloud IDE a coherent runtime session. It maps each `userId-workspaceId` pair to one Docker container, hydrates that container from PostgreSQL using a recursive CTE and tar stream, injects a universal `run` command, starts dependency installation in the background, tracks reference counts, and exposes lookup helpers for terminal, LSP, and preview systems.

The strongest interview explanation is: persistent workspace state lives in PostgreSQL/Yjs, while mutable runtime state lives in a per-user workspace container. This file bridges those two worlds.

