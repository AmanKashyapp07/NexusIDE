import Docker from 'dockerode';
import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as net from 'net';

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

// ARCHITECTURE DETAIL: Cold-start container latency reduction.
// Creating a container on-demand takes 400-800ms (overlay2 assembly, namespace creation, cgroup limits, PTY fork).
// Maintaining pre-warmed containers with active background replenishment drops execution start overhead to ~10ms.
const POOL_SIZE = 2; // High-concurrency buffer. Refills in background when popped.
const TERMINAL_POOL_MIN = 1;
const TERMINAL_POOL_MAX = 5;
let TERMINAL_POOL_SIZE = 2; // Dynamic pool size target

const WARM_LANGUAGES = ['python', 'javascript', 'cpp', 'c', 'bash', 'java'];

const IMAGE_CONFIGS: Record<string, string> = {
  python: 'python:3.10-alpine',
  javascript: 'node:20-alpine',
  cpp: 'gcc:12',
  c: 'gcc:12',
  bash: 'alpine:3.18',
  java: 'eclipse-temurin:21-jdk-alpine'
};

const TERMINAL_IMAGE = 'sandbox-dev-env:latest';

class WarmPoolManager {
  private pools: Record<string, WarmContainer[]> = {};
  private terminalPool: WarmContainer[] = [];
  private activeTerminalSessions = 0;
  
  // CONCURRENCY CONTROL: Prevents multiple concurrent refilling cycles
  // from spawning excess containers due to asynchronous event loop interleaving.
  private replenishing: Record<string, boolean> = {};
  private replenishingTerminal: boolean = false;

  constructor() {
    for (const lang of WARM_LANGUAGES) {
      this.pools[lang] = [];
      this.replenishing[lang] = false;
    }
  }

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

  // Startup phase: Initializes pools in parallel to optimize boot speed (Promise.all concurrency)
  public async initializePools(): Promise<void> {
    console.log('[WarmPool] Initializing warm pools...');
    await this.ensureTerminalImageExists();
    await Promise.all([
      ...WARM_LANGUAGES.map((lang) => this.fillPool(lang)),
      this.fillTerminalPool()
    ]);
    console.log('[WarmPool] All pools initialized.');
  }

  // FIFO Popping: Pops oldest container, starts async non-blocking replenishment.
  // Single-use execution containers: Once code runs, container is discarded (prevents state leakage).
  // Fallback: If empty, create container synchronously (slower response but prevents failures).
  public async popContainer(lang: string): Promise<WarmContainer> {
    const pool = this.pools[lang];
    if (!pool || pool.length === 0) {
      console.warn(`[WarmPool] Pool empty for ${lang}. Creating on-demand.`);
      return this.createWarmContainer(lang);
    }

    const warmContainer = pool.shift()!;
    this.fillPool(lang).catch((err) => console.error(`[WarmPool] Refill failed for ${lang}:`, err.message));
    return warmContainer;
  }

  // Refills pool up to target POOL_SIZE sequentially in the background (prevents host CPU load spikes)
  private async fillPool(lang: string): Promise<void> {
    if (this.replenishing[lang]) return;
    this.replenishing[lang] = true;

    try {
      const pool = this.pools[lang];
      while (pool && pool.length < POOL_SIZE) {
        pool.push(await this.createWarmContainer(lang));
      }
    } finally {
      this.replenishing[lang] = false;
    }
  }

  // CONTAINER HARDENING & SECURITY (Defense in Depth):
  // - Memory/MemorySwap: Limits memory usage; swap limit = memory prevents swap space exhaustion.
  // - NanoCpus: Restricts host CPU starvation.
  // - PidsLimit: Fork-bomb prevention (ceilings maximum active processes).
  // - NetworkMode 'none': Isolation; blocks data exfiltration and reverse shells.
  // - ReadonlyRootfs: Read-only container root prevents planting persistent backdoors.
  // - Tmpfs: Ephemeral, capped in-memory directories for file writes (/app, /tmp).
  // - exec mount option: Required to allow execution of compiled C/C++ native binaries on tmpfs.
  // - Tty false: Multiplexes stdout/stderr into an 8-byte frame header protocol for clean division.
  private async createWarmContainer(lang: string): Promise<WarmContainer> {
    const image = IMAGE_CONFIGS[lang];
    if (!image) throw new Error(`Unsupported pool language: ${lang}`);

    const container = await docker.createContainer({
      Image: image,
      Cmd: ['sh', '-c', 'sleep infinity'], // Generic POSIX idle command to keep container alive
      HostConfig: {
        Memory: 100 * 1024 * 1024,
        MemorySwap: 100 * 1024 * 1024,
        NanoCpus: 500_000_000,
        PidsLimit: 50,
        NetworkMode: 'none',
        ReadonlyRootfs: true,
        Tmpfs: {
          '/app': 'rw,exec,size=10m',
          '/tmp': 'rw,exec,size=10m'
        }
      },
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      OpenStdin: true,
      StdinOnce: true,
      Tty: false
    });

    await container.start();
    return { container, id: container.id };
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
  // - Volume Bind: Mounts host directory to persist shell history across container restarts.
  private async createTerminalContainer(): Promise<WarmContainer> {
    const HISTORY_DIR = path.join('/Users/amankashyap/Documents/sandbox/backend', 'terminal_history');
    if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });

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
          '/app': 'rw,exec,size=512m',
          '/tmp': 'rw,exec,size=256m'
        },
        Binds: [`${HISTORY_DIR}:/history`]
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
    for (const lang of WARM_LANGUAGES) {
      const pool = this.pools[lang];
      while (pool && pool.length > 0) {
        const warm = pool.shift()!;
        await warm.container.remove({ force: true }).catch((err) => console.error(`Remove failed for ${warm.id}:`, err.message));
      }
    }

    while (this.terminalPool.length > 0) {
      const warm = this.terminalPool.shift()!;
      await warm.container.remove({ force: true }).catch((err) => console.error(`Remove failed for ${warm.id}:`, err.message));
    }
  }
}

export const warmPoolManager = new WarmPoolManager();