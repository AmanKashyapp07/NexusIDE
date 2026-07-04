import Docker from 'dockerode';
import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as net from 'net';

// this file solves the problem of cold-start latency for containers by maintaining a pool of pre-warmed containers ready for immediate use. It also manages a separate pool for terminal containers, which are heavier and require more resources. The pools are dynamically adjusted based on usage patterns to optimize resource utilization and performance.
// under normal circumstances, the warm pool manager will maintain a small number of pre-warmed containers for each supported language, allowing for rapid execution of code snippets without the overhead of container creation. The terminal pool is managed separately, with dynamic scaling based on active sessions to ensure that resources are allocated efficiently while still providing a responsive development environment. otheriwse, it will take 400-800ms to create a new container on-demand, which is not ideal for interactive coding experiences.

// Docker daemon path selection based on platform

const homeDir = process.env.HOME || '';
const defaultMacSocket = path.join(homeDir, '.docker/run/docker.sock');
const finalSocketPath = process.platform === 'darwin' && existsSync(defaultMacSocket)
  ? defaultMacSocket
  : '/var/run/docker.sock';

export const docker = new Docker({ socketPath: finalSocketPath });

export interface WarmContainer {
  container: Docker.Container;
  id: string;
  hostPort?: number;
}

// Utility to find an open port on the host machine for web preview binding
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

const TERMINAL_POOL_MIN = 1;
const TERMINAL_POOL_MAX = 5;
let TERMINAL_POOL_SIZE = 2; // Dynamic pool size target

const TERMINAL_IMAGE = 'sandbox-dev-env:latest';

// [PERSISTENT STORAGE] Host-side workspace data directory
// All workspace files are stored here on the host machine and bind-mounted into containers.
// This replaces the previous tmpfs-backed /app approach, enabling native-speed file I/O
// and persistent storage that survives container restarts.
export const WORKSPACE_DATA_DIR = path.resolve(__dirname, '..', '..', 'workspace_data');

class WarmPoolManager {
  private terminalPool: WarmContainer[] = [];
  private activeTerminalSessions = 0;
  private replenishingTerminal: boolean = false;

  constructor() {}

  // Pre-builds custom workspace developer environment (compiler tools & global runtime packages)
  private async ensureTerminalImageExists(): Promise<void> {
    try {
      await docker.getImage(TERMINAL_IMAGE).inspect();
      console.log('[WarmPool] Terminal image ready.');
    } catch (err) {
      console.log('[WarmPool] Building terminal image...');
      const dockerfileContent = `FROM alpine:3.20
RUN apk add --no-cache nodejs npm python3 py3-pip g++ gcc make libc-dev git curl bash tree jq zip unzip sqlite py3-numpy py3-pandas py3-requests py3-scipy py3-scikit-learn py3-matplotlib py3-beautifulsoup4
RUN npm install -g typescript typescript-language-server pyright lodash axios express moment uuid chalk tailwindcss @tailwindcss/cli ts-node nodemon dotenv cors
RUN ARCH=$(uname -m) && \\
    if [ "$ARCH" = "x86_64" ]; then npm install -g @tailwindcss/oxide-linux-x64-musl; \\
    elif [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then npm install -g @tailwindcss/oxide-linux-arm64-musl; fi
ENV NODE_PATH=/usr/local/lib/node_modules:/usr/lib/node_modules
RUN mkdir -p /viewer_bin && ln -s /bin/busybox /viewer_bin/ls && ln -s /bin/busybox /viewer_bin/cat && ln -s /bin/busybox /viewer_bin/echo && ln -s /bin/busybox /viewer_bin/pwd && ln -s /bin/busybox /viewer_bin/clear && ln -s /bin/busybox /viewer_bin/grep
WORKDIR /app
`;
      execSync(`docker build -t ${TERMINAL_IMAGE} -`, { input: dockerfileContent, stdio: 'pipe' });
    }
  }

  // Startup phase: Initializes terminal pool
  public async initializePools(): Promise<void> {
    console.log('[WarmPool] Initializing warm pools...');
    await this.ensureTerminalImageExists();
    await this.fillTerminalPool();
    console.log('[WarmPool] All pools initialized.');
  }

  // Dynamic scaling for Terminal Containers:
  // Unlike code-execution containers which run for seconds, terminals stay active for hours.
  // Sizing targets are dynamically adjusted using session tracking to avoid heavy idle RAM usage.
  public async popTerminalContainer(): Promise<WarmContainer> {
    this.activeTerminalSessions++;
    this.adjustTerminalPoolSize();

    if (this.terminalPool.length === 0) {
      console.warn('[WarmPool] Terminal pool empty. Creating on-demand.');
      const container = await this.createTerminalContainer();
      this.fillTerminalPool().catch((err) => console.error('[WarmPool] Refill failed:', err.message));
      return container;
    }

    const warmContainer = this.terminalPool.shift()!;
    this.fillTerminalPool().catch((err) => console.error('[WarmPool] Refill failed:', err.message));
    return warmContainer;
  }

  public releaseTerminalContainer(): void {
    if (this.activeTerminalSessions > 0) {
      this.activeTerminalSessions--;
      this.adjustTerminalPoolSize();
    }
  }

  // Elastic Scaling Algorithm: Maintains a safe buffer of (active + 2) up to MAX ceiling
  private adjustTerminalPoolSize(): void {
    const previousSize = TERMINAL_POOL_SIZE;
    const targetSize = Math.max(
      TERMINAL_POOL_MIN,
      Math.min(TERMINAL_POOL_MAX, this.activeTerminalSessions + 2)
    );
    
    if (targetSize !== previousSize) {
      TERMINAL_POOL_SIZE = targetSize;
      if (targetSize > previousSize) {
        this.fillTerminalPool().catch((err) => console.error('[WarmPool] Resize failed:', err.message));
      }
    }
  }

  private async fillTerminalPool(): Promise<void> {
    if (this.replenishingTerminal) return;
    this.replenishingTerminal = true;

    try {
      while (this.terminalPool.length < TERMINAL_POOL_SIZE) {
        this.terminalPool.push(await this.createTerminalContainer());
      }
    } finally {
      this.replenishingTerminal = false;
    }
  }

  // Creates a heavy-weight developer workspace container:
  // - Port Binding: Exposes port 3000 to dynamically allocated host port for web preview.
  // - Writable FS (ReadonlyRootfs: false): Needed to write node_modules and support PTY allocations.
  // - Increased Resource Limits: 1GB memory, 1.5 CPUs, 500 Pids to handle npm install and compilers.
  // - Tty true: Critical for interactive shells. Forces pseudo-terminal allocation so stdout/stderr
  //   are not multiplexed with Docker's 8-byte frame header, preventing character corruption in browser PTY.
  // - Bind Mount: Maps host workspace_data/ directory into /workspaces inside the container for
  //   persistent, native-speed file I/O that survives container restarts.
  private async createTerminalContainer(): Promise<WarmContainer> {
    const HISTORY_DIR = path.join(WORKSPACE_DATA_DIR, '..', 'terminal_history');
    if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });
    if (!existsSync(WORKSPACE_DATA_DIR)) mkdirSync(WORKSPACE_DATA_DIR, { recursive: true });

    const hostPort = await getFreePort();

    const container = await docker.createContainer({
      Image: TERMINAL_IMAGE,
      Cmd: ['sh', '-c', 'sleep infinity'],
      ExposedPorts: { '3000/tcp': {} },
      HostConfig: {
        PortBindings: { '3000/tcp': [{ HostPort: String(hostPort) }] },
        Memory: 1024 * 1024 * 1024,
        MemorySwap: 1024 * 1024 * 1024,
        NanoCpus: 1_500_000_000,
        PidsLimit: 500,
        ReadonlyRootfs: false,
        Tmpfs: {
          '/tmp': 'rw,exec,size=256m'
        },
        Binds: [
          `${HISTORY_DIR}:/history`,
          `${WORKSPACE_DATA_DIR}:/workspaces`
        ]
      },
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      OpenStdin: true,
      StdinOnce: true,
      Tty: true
    });

    await container.start();
    return { container, id: container.id, hostPort };
  }

  // Graceful shutdown hook: Force-removes all pooled containers to prevent host Docker resource leaks (zombies)
  public async cleanup(): Promise<void> {
    console.log('[WarmPool] Cleaning up...');
    while (this.terminalPool.length > 0) {
      const warm = this.terminalPool.shift()!;
      await warm.container.remove({ force: true }).catch((err) => console.error(`Remove failed for ${warm.id}:`, err.message));
    }
  }
} // when we type control c in the terminal, this cleanup method is called to gracefully shut down all pooled containers. It iterates through each language pool and the terminal pool, forcefully removing each container to prevent resource leaks and ensure that no zombie containers remain on the host system. This helps maintain a clean and efficient Docker environment, preventing unnecessary resource consumption and potential conflicts with future container operations. all containers are deleted to prevent resource leaks and ensure that the system remains clean and efficient. This is particularly important in a development environment where containers may be created and destroyed frequently, as it helps to avoid clutter and potential conflicts with future container operations.

export const warmPoolManager = new WarmPoolManager();


// Image - template used to create containers
// Container - running instance of an image. this project creates containers to execute code snippets in various programming languages. Each container is an isolated environment that runs a specific image, which contains the necessary runtime and dependencies for the language being executed. The warm pool manager maintains a pool of pre-warmed containers for each supported language, allowing for rapid execution of code snippets without the overhead of creating a new container on-demand. This approach helps to reduce latency and improve performance when executing code in the sandbox environment.
// we are not running code on local machine to prrevent security issues. Instead, we are running code in isolated containers that are managed by the warm pool manager. This ensures that the code execution environment is secure and does not have access to the host system or other containers. The warm pool manager handles the creation, management, and cleanup of these containers, allowing for efficient and secure execution of code snippets in various programming languages.
// Dockerfile - a text file that contains instructions for building a Docker image. It specifies the base image, dependencies, and configuration needed to create a containerized environment for running code snippets in different programming languages. The warm pool manager uses these Dockerfiles to build the necessary images for each supported language, ensuring that the containers have the required runtime and libraries to execute code securely and efficiently. terminal image is manually designed but languages image is pulled from docker hub. The terminal image is built using a custom Dockerfile that installs various development tools and packages needed for the terminal environment. This allows for a consistent and ready-to-use development environment for users, while the language images are pulled from Docker Hub to provide lightweight and efficient runtime environments for executing code snippets in different programming languages. we didn't design the language images because they are already available on Docker Hub and provide the necessary runtime environments for executing code in their respective languages. By using pre-existing images, we can save time and resources while still ensuring that the containers have the required dependencies and configurations for secure and efficient code execution.

// build - process of creating a Docker image from a Dockerfile. It involves executing the instructions in the Dockerfile to assemble the necessary components, dependencies, and configurations into a single image that can be used to create containers. The warm pool manager builds the terminal image using a custom Dockerfile, while the language images are pulled from Docker Hub, which provides pre-built images for various programming languages. This approach allows for efficient and secure execution of code snippets in different languages while maintaining a consistent development environment for users.

// docker daemon - the background service that manages Docker containers and images. It handles container creation, execution, and cleanup, as well as image management and networking. The warm pool manager interacts with the Docker daemon through the Dockerode library to create and manage containers for executing code snippets in various programming languages. The Docker daemon ensures that the containers are isolated, secure, and efficiently managed, allowing for rapid execution of code in a sandboxed environment.

// docker socket - a Unix domain socket that allows communication between the Docker client and the Docker daemon. It is used by the warm pool manager to send commands and receive responses from the Docker daemon, enabling the creation, management, and cleanup of containers for executing code snippets in different programming languages. The warm pool manager uses the Docker socket to interact with the Docker daemon, ensuring that containers are created and managed securely and efficiently.

// dockerode - a Node.js library that provides a high-level API for interacting with the Docker daemon. It allows developers to create, manage, and monitor Docker containers and images using JavaScript or TypeScript. The warm pool manager uses Dockerode to communicate with the Docker daemon, enabling the creation and management of containers for executing code snippets in various programming languages. Dockerode simplifies the process of working with Docker in a Node.js environment, providing an easy-to-use interface for managing containers and images.

// port binding - the process of mapping a port on the host machine to a port inside a Docker container. This allows external clients to access services running inside the container through the specified host port. The warm pool manager uses port binding for terminal containers to expose a web interface on a dynamically allocated host port, enabling users to interact with the development environment through their web browser. Port binding is essential for providing access to services running inside containers while maintaining isolation and security.

// terminal history - a feature that allows users to persist their command history across terminal container restarts. The warm pool manager mounts a host directory to the terminal containers, enabling the storage of command history in a persistent location. This allows users to retain their command history even when the terminal container is stopped or restarted, providing a more seamless and user-friendly experience when working in the development environment.