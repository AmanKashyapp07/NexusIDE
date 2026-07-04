import Docker from 'dockerode';
import { warmPoolManager, WORKSPACE_DATA_DIR } from './pool';
import { getPool } from '../db';
import tar from 'tar-stream';
import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';

// this file manages the lifecycle of workspace containers, including creation, reference counting, and cleanup.
// [UX/DX] Universal Execution Script
// Injected into every container so users can just type `run index.js` or `run main.cpp` 
// without needing to know specific compiler flags or runtime commands.
const RUN_SCRIPT = `#!/bin/sh
if [ -z "$1" ]; then echo "Usage: run <filename>"; exit 1; fi
file="$1"; ext="\${file##*.}"
case "$ext" in
  py) python3 "$file" ;;
  js) node "$file" ;;
  c) gcc "$file" -o /tmp/a.out && /tmp/a.out ;;
  cpp) g++ "$file" -o /tmp/a.out && /tmp/a.out ;;
  java) javac "$file" -d /tmp && java -cp /tmp "\${file%.*}" ;;
  sh) sh "$file" ;;
  *) echo "Unsupported: .$ext"; exit 1 ;;
esac`; // this is like alias for the user to run files without needing to know the specific command for each language.

export interface WorkspaceContainerRef {
  container: Docker.Container;
  id: string;
  refCount: number;
  hostPort?: number | undefined;
  cleanupTimeout?: NodeJS.Timeout | null;
  lastActivityMs?: number;
}
// workspace containers are used for running user code in a secure, isolated environment. Each user in a workspace gets their own container, but if they open multiple tabs, they share the same container. This is important for resource efficiency and session persistence.
// [STATE MANAGEMENT] Active Session Registry
// Maps `${userId}-${workspaceId}` to a container reference. every user in a workspace gets their own container, but if they open multiple tabs, they share the same container. This is important for resource efficiency and session persistence. 
// Enables container multiplexing: if a user opens the same workspace in 5 browser tabs, 
// they share 1 underlying container instead of booting 5, saving massive RAM and CPU.
const activeWorkspaceContainers = new Map<string, WorkspaceContainerRef>();

export async function getOrCreateWorkspaceContainer(userId: string, workspaceId: string): Promise<Docker.Container> {
  const key = `${userId}-${workspaceId}`;
  const existingRef = activeWorkspaceContainers.get(key);
  
  // [ARCHITECTURE] Reference Counting
  // If the container is already running for this user's workspace, increment the refCount and return it instantly.
  if (existingRef) {
    if (existingRef.cleanupTimeout) {
      clearTimeout(existingRef.cleanupTimeout);
      existingRef.cleanupTimeout = null;
    }
    existingRef.refCount++;
    return existingRef.container;
  }

  const { container, id, hostPort } = await warmPoolManager.popTerminalContainer();

  // [PERSISTENT STORAGE] Create Host-Side Workspace Directory
  // Each workspace gets a dedicated folder on the host machine. Because the entire
  // workspace_data/ directory is bind-mounted into the container at /workspaces,
  // this folder is instantly visible inside the container at /workspaces/<workspaceId>.
  const wsHostDir = path.join(WORKSPACE_DATA_DIR, workspaceId);
  if (!existsSync(wsHostDir)) mkdirSync(wsHostDir, { recursive: true });

  // [DATA HYDRATION] Recursive Tree Traversal
  // Pulls the entire virtual filesystem from Postgres in a single query using a Recursive CTE, 
  // avoiding the N+1 query problem when loading deeply nested folder structures.
  // Files are extracted into the host-side bind mount, so the container sees them immediately.
  const filesRes = await getPool().query(
    `WITH RECURSIVE file_path_cte AS (
      SELECT id, parent_id, name, type, content, name::text as path FROM files WHERE workspace_id = $1 AND parent_id IS NULL
      UNION ALL
      SELECT f.id, f.parent_id, f.name, f.type, f.content, (cte.path || '/' || f.name)::text as path
      FROM files f INNER JOIN file_path_cte cte ON f.parent_id = cte.id WHERE f.workspace_id = $1
    ) SELECT type, content, path FROM file_path_cte;`,
    [workspaceId]
  );

  // [ARCHITECTURE] Streamed File Injection into Bind Mount
  // We pipe a tar stream into a `tar -x` process inside the container, extracting
  // directly into the workspace's bind-mounted directory for native-speed file I/O.
  const wsContainerPath = `/workspaces/${workspaceId}`;
  const pack = tar.pack();
  for (const file of filesRes.rows) {
    if (file.type === 'file') pack.entry({ name: file.path }, file.content || '');
    else pack.entry({ name: file.path, type: 'directory' });
  }
  pack.entry({ name: '.run.sh' }, RUN_SCRIPT);
  pack.finalize();

  const exec = await container.exec({ Cmd: ['tar', '-x', '-C', wsContainerPath], AttachStdin: true, AttachStdout: true, AttachStderr: true });
  const stream = await exec.start({ hijack: true, stdin: true });
  
  await new Promise<void>((resolve, reject) => {
    pack.pipe(stream);
    stream.on('end', resolve);
    stream.on('error', reject);
    pack.on('error', reject);
  });

  // [SYSTEM SETUP] Bootstrap Environment
  // 1. Move the universal run script to bin so it's globally available.
  // 2. [UX] Fire-and-forget `npm install` in the background (using Detach: true). 
  //    The user gets control of the terminal instantly while heavy dependencies install invisibly.
  try {
    const setupExec = await container.exec({ Cmd: ['sh', '-c', `cp ${wsContainerPath}/.run.sh /usr/local/bin/run && chmod +x /usr/local/bin/run && rm -f ${wsContainerPath}/.run.sh`] });
    const setupStream = await setupExec.start({ hijack: true, stdin: false });
    await new Promise<void>((res) => { setupStream.on('end', res); setupStream.on('error', res); });

    const installExec = await container.exec({ Cmd: ['sh', '-c', `cd ${wsContainerPath} && if [ -f package.json ] && [ ! -d node_modules ]; then npm install; fi`] });
    installExec.start({ Detach: true, hijack: false }).catch(() => {});
  } catch (err) {
    console.error(`[WorkspaceContainer] Setup failed for ${key}:`, err);
  }

  activeWorkspaceContainers.set(key, { container, id, refCount: 1, hostPort, cleanupTimeout: null, lastActivityMs: Date.now() });
  return container;
}

export async function releaseWorkspaceContainer(userId: string, workspaceId: string): Promise<void> {
  const key = `${userId}-${workspaceId}`;
  const ref = activeWorkspaceContainers.get(key);
  if (!ref) return;

  // [LIFECYCLE] Reference Decrementing
  // When a user closes a tab, we decrement. We ONLY destroy the container if refCount hits 0,
  // ensuring we don't kill the session if they still have other browser tabs open.
  ref.refCount--;

  if (ref.refCount <= 0) {
    if (ref.cleanupTimeout) {
      clearTimeout(ref.cleanupTimeout);
    }
    ref.cleanupTimeout = setTimeout(async () => {
      const currentRef = activeWorkspaceContainers.get(key);
      if (currentRef && currentRef.refCount <= 0) {
        activeWorkspaceContainers.delete(key);
        await currentRef.container.remove({ force: true }).catch(() => {});
        warmPoolManager.releaseTerminalContainer(); // Notify the pool manager to scale down if needed
      }
    }, 300000); // 5 minutes grace period
  }
}

export async function cleanupAllWorkspaceContainers(): Promise<void> {
  for (const [key, ref] of activeWorkspaceContainers.entries()) {
    if (ref.cleanupTimeout) {
      clearTimeout(ref.cleanupTimeout);
    }
    await ref.container.remove({ force: true }).catch(() => {});
  }
  activeWorkspaceContainers.clear();
}

// Accessor methods condensed to implicit returns
export const getRunningContainer = (userId: string, workspaceId: string): Docker.Container | null => 
  activeWorkspaceContainers.get(`${userId}-${workspaceId}`)?.container || null;

export const getRunningContainerRef = (userId: string, workspaceId: string): WorkspaceContainerRef | null => 
  activeWorkspaceContainers.get(`${userId}-${workspaceId}`) || null;

export function touchWorkspaceActivity(userId: string, workspaceId: string): void {
  const key = `${userId}-${workspaceId}`;
  const ref = activeWorkspaceContainers.get(key);
  if (ref) {
    ref.lastActivityMs = Date.now();
  }
}

// [RESOURCE MANAGEMENT] Global AFK Sweeper
// Scans active containers every 5 minutes. If a container hasn't received a heartbeat
// in over 30 minutes, forcefully kill it to prevent orphaned containers from draining resources.
setInterval(async () => {
  const now = Date.now();
  for (const [key, ref] of activeWorkspaceContainers.entries()) {
    if (ref.lastActivityMs && now - ref.lastActivityMs > 30 * 60 * 1000) {
      console.log(`[WorkspaceContainer] AFK Timeout exceeded for ${key}. Force destroying...`);
      if (ref.cleanupTimeout) clearTimeout(ref.cleanupTimeout);
      activeWorkspaceContainers.delete(key);
      await ref.container.remove({ force: true }).catch(() => {});
      warmPoolManager.releaseTerminalContainer();
    }
  }
}, 5 * 60 * 1000);