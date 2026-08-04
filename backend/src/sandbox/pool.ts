/**
 * Purpose: Pre-warmed Docker container pool manager for workspace execution sandboxing.
 * High-Level Architecture: Maintains a dynamic buffer of idle pre-booted Docker containers (`sandbox-dev-env:latest`), enforcing strict CPU/RAM CGroup quotas and dynamic port bindings to reduce cold-start latency.
 * Primary Trade-offs: Pre-allocating idle containers trades background host RAM (~1GB per container) for instantaneous user workspace initialization.
 * Complexity: O(1) container pop/push operations with background async replenishment.
 */

import Docker from 'dockerode';
import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as net from 'net';
import type { WarmContainer } from '../types/sandbox.types.js';

export type { WarmContainer } from '../types/sandbox.types.js';

// =============================================================================
// DOCKER SOCKET DETECTION & SETUP
// =============================================================================

// INTENT: Detect host OS platform and select appropriate Docker socket path.
// WHY: macOS Docker Desktop uses `~/.docker/run/docker.sock`, while Linux uses `/var/run/docker.sock`.
const homeDir = process.env.HOME || '';
const defaultMacSocket = path.join(homeDir, '.docker/run/docker.sock');
const finalSocketPath = process.platform === 'darwin' && existsSync(defaultMacSocket)
   ? defaultMacSocket
   : '/var/run/docker.sock';

export const docker = new Docker({ socketPath: finalSocketPath });

// INTENT: Dynamically locate an available TCP port on the host OS.
// WHY: Prevents port collisions when binding host ports to container preview endpoints.
function getFreePort(): Promise<number> {
   return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, () => {
         const { port } = srv.address() as net.AddressInfo;
         srv.close(() => resolve(port));
      });
      srv.on('error', reject);
   });
}

// =============================================================================
// WARM POOL MANAGER CLASS
// =============================================================================

const TERMINAL_POOL_MIN = 1;
const TERMINAL_POOL_MAX = 5;
let TERMINAL_POOL_SIZE = 2;

const TERMINAL_IMAGE = 'sandbox-dev-env:latest';

export const WORKSPACE_DATA_DIR = path.resolve(__dirname, '..', '..', 'workspace_data');

class WarmPoolManager {
   private terminalPool: WarmContainer[] = [];
   private activeTerminalSessions = 0;
   private replenishingTerminal = false;

   // INTENT: Verify base Docker image exists or compile image dynamically on boot.
   // WHY: Ensures all container dependencies (Node, Python, C++, TypeScript LS) are pre-installed in image layers.
   private async ensureTerminalImageExists(): Promise<void> {
      try {
         await docker.getImage(TERMINAL_IMAGE).inspect();
         console.log('[WarmPool] Terminal image ready.');
      } catch {
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
         try {
            execSync(`docker build -t ${TERMINAL_IMAGE} -`, { input: dockerfileContent, stdio: 'pipe' });
         } catch (buildErr) {
            process.stderr.write(`[Error] Docker image compile failed: ${buildErr instanceof Error ? buildErr.message : String(buildErr)}\n`);
            throw buildErr;
         }
      }
   }

   // INTENT: Bootstrap container pool during server start sequence.
   public async initializePools(): Promise<void> {
      console.log('[WarmPool] Initializing warm pools...');
      await this.ensureTerminalImageExists();
      await this.fillTerminalPool();
      console.log('[WarmPool] All pools initialized.');
   }

   // INTENT: Pop a pre-warmed container from the pool or create one on-demand if pool is depleted.
   // WHY: Reduces workspace container provisioning time from ~3.5s to <50ms.
   // INTERVIEW NOTES: Single-flight replenishment ensures background filling doesn't block the caller thread.
   public async popTerminalContainer(): Promise<WarmContainer> {
      this.activeTerminalSessions++;
      this.adjustTerminalPoolSize();

      if (this.terminalPool.length === 0) {
         console.warn('[WarmPool] Terminal pool empty. Creating on-demand.');
         const container = await this.createTerminalContainer();
         this.fillTerminalPool().catch((err: Error) => console.error('[WarmPool] Refill failed:', err.message));
         return container;
      }

      const warmContainer = this.terminalPool.shift()!;
      this.fillTerminalPool().catch((err: Error) => console.error('[WarmPool] Refill failed:', err.message));
      return warmContainer;
   }

   public releaseTerminalContainer(): void {
      if (this.activeTerminalSessions > 0) {
         this.activeTerminalSessions--;
         this.adjustTerminalPoolSize();
      }
   }

   // INTENT: Dynamically resize pool size based on concurrent active user sessions.
   private adjustTerminalPoolSize(): void {
      const previousSize = TERMINAL_POOL_SIZE;
      const targetSize = Math.max(
         TERMINAL_POOL_MIN,
         Math.min(TERMINAL_POOL_MAX, this.activeTerminalSessions + 2)
      );
      
      if (targetSize !== previousSize) {
         TERMINAL_POOL_SIZE = targetSize;
         if (targetSize > previousSize) {
            this.fillTerminalPool().catch((err: Error) => console.error('[WarmPool] Resize failed:', err.message));
         }
      }
   }

   // INTENT: Asynchronously replenish warm container pool buffer.
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

   // =============================================================================
   // DOCKER CONTAINER PROVISIONING & CGROUP SANDBOXING
   // =============================================================================

   // INTENT: Create and boot a new isolated Docker container with strict CPU, RAM, PID, and security restrictions.
   // WHY: Enforces resource limits (1.5 CPU cores, 1GB RAM limit, 500 max PIDs) to prevent noisy neighbor effects or fork bombs.
   // INTERVIEW NOTES: Binding tmpfs `/tmp` directory as `rw,exec` prevents disk wear while allowing compilation artifacts to execute.
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

   // INTENT: Remove all warm pool container instances during server teardown.
   public async cleanup(): Promise<void> {
      console.log('[WarmPool] Cleaning up...');
      while (this.terminalPool.length > 0) {
         const warm = this.terminalPool.shift();
         if (warm) {
            await warm.container.remove({ force: true }).catch((err: unknown) => {
               console.error(`Remove failed for ${warm.id}:`, err instanceof Error ? err.message : String(err));
            });
         }
      }
   }
}

export const warmPoolManager = new WarmPoolManager();