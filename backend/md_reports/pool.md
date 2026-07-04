# Backend Engineering Chapter: `backend/src/sandbox/pool.ts`

## Why Container Pools Exist

Running untrusted code is expensive and dangerous. Every execution needs an isolated environment, language runtime, filesystem, resource limits, and a way to return output. The naive solution is to create a Docker container whenever the user clicks "Run." That is simple, but it makes latency visible. Container creation involves image lookup, filesystem layer setup, namespace creation, cgroup assignment, and process startup. Even if that only takes several hundred milliseconds, users feel it in an IDE.

The production solution is pooling. A pool is a set of already-created resources waiting for work. Database pools solve connection setup cost. Thread pools solve thread startup cost. This file applies the same principle to Docker containers. Instead of creating a runner container at request time, the backend keeps language-specific containers asleep with `sleep infinity`. When execution starts, the code claims a warm container, runs inside it, and the pool refills in the background.

The mental model is a taxi stand. A naive system calls a new taxi from the depot for every passenger. A pooled system keeps taxis waiting near the curb. The passenger still gets an isolated ride, but they do not wait for the taxi to be manufactured.

## Docker Daemon Selection

The file begins by deciding which Docker socket to use:

```ts
const defaultMacSocket = path.join(homeDir, '.docker/run/docker.sock');
const finalSocketPath = process.platform === 'darwin' && existsSync(defaultMacSocket)
  ? defaultMacSocket
  : '/var/run/docker.sock';
export const docker = new Docker({ socketPath: finalSocketPath });
```

The first-principles issue is that Docker is not a network API by default on local machines. On Linux, the daemon usually listens on `/var/run/docker.sock`. On modern Docker Desktop for macOS, the socket can live under the user's home directory. A beginner might hardcode `/var/run/docker.sock`, which fails on many local Mac setups. This code makes local development less brittle by detecting the platform-specific socket.

The trade-off is deployment specificity. This is useful for local development, but a production system would make the Docker endpoint explicit through configuration. Hardcoded local paths are not ideal for multi-host deployments, remote Docker daemons, or Kubernetes.

## The Two Pool Types

This file manages two categories of containers:

1. Short-lived execution containers for `python`, `javascript`, `cpp`, `c`, `bash`, and `java`.
2. Long-lived terminal containers based on a custom `sandbox-dev-env:latest` image.

The difference matters. Execution containers are disposable. Their job is to run one command and disappear, preventing state leakage between runs. Terminal containers are session state. They hold a user's workspace filesystem, shell history, installed dependencies, language servers, and preview server port. Treating both as the same would either leak state into code execution or destroy the terminal every time a user runs a command.

That separation is a strong interview point: isolation policy depends on workload lifetime.

## Warm Execution Containers

`POOL_SIZE`, `WARM_LANGUAGES`, and `IMAGE_CONFIGS` define the runner pool. The implementation keeps two warm containers per language. This number is a latency buffer, not a hard concurrency limit. If the pool is empty, `popContainer` creates an on-demand container.

The naive alternative is an unbounded pool. That lowers latency under spikes but risks exhausting host memory. Another naive alternative is no fallback when the pool is empty. That keeps resource usage predictable but turns traffic spikes into failures. This implementation chooses a middle ground: keep a small buffer, refill asynchronously, and create synchronously only when necessary.

The `replenishing` flags prevent duplicate refill loops. JavaScript is single-threaded, but async interleaving still creates race conditions. Two requests can pop containers close together and both start a refill loop. Without the boolean guard, the pool could overshoot its target. This is a lightweight concurrency control mechanism.

In a distributed system, this in-memory guard would not be enough. If multiple backend processes run on the same Docker host, each process maintains its own idea of pool size. At large scale, container scheduling would move to Kubernetes, Nomad, Firecracker, or a dedicated sandbox service.

## Container Hardening

The runner container configuration is the security core:

```ts
Memory: 100 * 1024 * 1024
MemorySwap: 100 * 1024 * 1024
NanoCpus: 500_000_000
PidsLimit: 50
NetworkMode: 'none'
ReadonlyRootfs: true
Tmpfs: { '/app': 'rw,exec,size=10m', '/tmp': 'rw,exec,size=10m' }
```

From first principles, untrusted code can attack availability, confidentiality, and integrity. It can allocate memory forever, fork processes repeatedly, scan the network, write files, or attempt persistence. A beginner often relies on a timeout alone. Timeouts stop infinite loops eventually, but they do not prevent a fork bomb from exhausting process slots or a memory bomb from pressuring the host before the timeout fires.

The production solution is defense in depth:

- Memory limits contain memory exhaustion.
- Equal memory and swap limits prevent swap abuse.
- CPU quotas protect the host from starvation.
- PID limits reduce fork-bomb damage.
- Network isolation blocks exfiltration and scanning.
- Read-only root filesystems prevent persistent mutation of base images.
- Tmpfs gives code a small writable workspace without host disk persistence.

The `rw,exec` tmpfs option is important because compiled C and C++ binaries need to execute from `/app`. Without `exec`, compilation might succeed but running the output would fail.

The trade-off is compatibility. Real projects often need network access to install dependencies, more memory, or larger temp directories. Secure sandboxes intentionally restrict capabilities, so product teams must decide which developer features are worth additional risk.

## Terminal Containers as Developer Environments

Terminal containers are different. They need more memory, writable filesystem behavior, a PTY, and host port binding for previews:

```ts
Memory: 1024 * 1024 * 1024
NanoCpus: 1_500_000_000
PidsLimit: 500
ReadonlyRootfs: false
Tty: true
PortBindings: { '3000/tcp': [{ HostPort: String(hostPort) }] }
```

The first-principles issue is interactivity. A terminal is not a one-shot computation. It is a living development environment. Users run `npm install`, create files, start dev servers, and expect command history. That requires a heavier container than an execution runner.

`getFreePort` dynamically allocates a host port so the preview proxy can route browser traffic into the container's port 3000. A naive implementation hardcodes port 3000 on the host. That fails as soon as two users start preview servers. Dynamic port allocation is the minimal single-host solution.

The custom terminal image is built if missing. It installs Node, Python, compilers, Git, TypeScript language tooling, Pyright, common packages, and restricted viewer binaries. This makes terminal startup fast because expensive dependency installation is baked into the image. In a production CI/CD pipeline, this image would be built ahead of time, versioned, scanned for vulnerabilities, and pushed to a registry. Building it synchronously from application code is convenient for local development but not ideal for production reliability.

## Elastic Terminal Pool Sizing

Execution containers run briefly; terminals can last for hours. Keeping too many terminal containers warm wastes memory. Keeping too few increases startup latency. The file tracks active terminal sessions and adjusts the target pool:

```ts
targetSize = activeTerminalSessions + 2, clamped between min and max
```

This is a simple feedback-control algorithm. The system keeps a buffer of two extra terminal containers beyond current demand, but never below one or above five. It is not predictive autoscaling, but it captures the production principle: long-lived resource pools should size themselves based on observed demand.

At one million users, this algorithm would not run inside a single Node process. A large provider would use a cluster scheduler, per-node capacity accounting, image pre-pulling, bin-packing, autoscaling groups, and admission control. The same idea remains: keep enough warm capacity to hide cold starts without overcommitting memory.

## Cleanup as Resource Ownership

`cleanup()` removes pooled containers during shutdown. This is not optional hygiene. A Node process that creates Docker containers owns external resources outside the V8 heap. If the process exits without cleanup, Docker containers can remain alive. That creates zombie resource leaks: memory, ports, filesystem layers, and process slots remain consumed even though the backend is gone.

In production, cleanup must be paired with crash recovery. Signal handlers help on graceful shutdown, but they do not run if the process is killed with `SIGKILL` or the host crashes. A stronger design would label containers with owner metadata and run a periodic reaper that deletes orphaned containers by label and age.

## Interview Discussion: Warm Pools

Interviewer:
"Why do you pre-create containers instead of creating them per execution?"

Candidate:
"Container creation has user-visible latency because Docker has to set up namespaces, cgroups, filesystem layers, and the initial process. An IDE run button should feel interactive. The pool shifts that cost from request time to background time. When a request arrives, we pop an already-running container and refill asynchronously. This is the same principle as database connection pooling."

Interviewer:
"Does pooling reduce isolation?"

Candidate:
"Not for execution containers, because each warm container is single-use after it is popped. The container is removed after the run. Pooling reduces startup latency but does not reuse state across executions. Terminal containers are intentionally stateful, but they are scoped per user-workspace session and reference-counted elsewhere."

## Interview Discussion: Security Limits

Interviewer:
"Is a timeout enough to safely run user code?"

Candidate:
"No. A timeout only limits wall-clock duration. Malicious code can allocate memory, fork processes, or saturate CPU before the timeout fires. This file uses cgroup limits for memory and CPU, PID limits for fork bombs, network isolation for exfiltration prevention, read-only root filesystems for integrity, and small tmpfs mounts for controlled writes. The timeout in the execution layer is one defense among several."

## Engineering Lessons

- Pooling is a general latency optimization for expensive resource creation.
- Isolation policies must match workload lifetime: disposable runners and stateful terminals need different containers.
- Security for untrusted code requires resource limits, network isolation, filesystem restrictions, and lifecycle cleanup.
- Single-process in-memory pools are simple but become scheduling problems at scale.
- Cleanup is part of ownership when code creates external resources.

## Common Mistakes

- Relying only on timeouts for sandbox security.
- Reusing execution containers across users and leaking state.
- Hardcoding preview ports and breaking concurrency.
- Forgetting that async refill loops can race even in single-threaded JavaScript.
- Building production Docker images during application startup.
- Ignoring orphan cleanup when the server exits unexpectedly.

## Production Improvements

- Build and scan `sandbox-dev-env` in CI, then pull by immutable digest.
- Add Docker labels and a background orphan reaper.
- Replace hardcoded history path with environment configuration.
- Add metrics for pool depth, cold-start fallback count, container creation latency, and cleanup failures.
- Move scheduling to Kubernetes, Nomad, Firecracker, or a dedicated sandbox worker pool for horizontal scale.
- Add admission control when host capacity is exhausted instead of creating unbounded on-demand containers.

## Interview Revision

`pool.ts` is the capacity manager for Docker-backed execution. It hides cold-start latency through warm pools, enforces runner sandbox limits, builds or verifies a heavy terminal image, dynamically sizes long-lived terminal pool capacity, allocates preview ports, and cleans pooled containers during shutdown.

Key defenses:

- Execution containers are single-use and heavily restricted.
- Terminal containers are stateful and heavier because they power interactive development.
- Pool refill guards prevent async overshoot.
- Dynamic terminal sizing balances latency and memory.
- Cleanup prevents Docker resource leaks.

