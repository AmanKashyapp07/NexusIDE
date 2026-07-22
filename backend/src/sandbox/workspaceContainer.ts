import Docker from 'dockerode';
import { warmPoolManager, WORKSPACE_DATA_DIR } from './pool';
import { getPool } from '../db';
import tar from 'tar-stream';
import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';

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
esac`;

export interface WorkspaceContainerRef {
  container: Docker.Container;
  id: string;
  refCount: number;
  hostPort?: number | undefined;
  cleanupTimeout?: NodeJS.Timeout | null;
  lastActivityMs?: number;
}

const activeWorkspaceContainers = new Map<string, WorkspaceContainerRef>();

/**
 * Purpose: Spawns or retrieves an active container allocated for a user workspace session.
 * Under the Hood:
 *   1. Checks activeWorkspaceContainers for an existing user-workspace key reference.
 *   2. If a reference exists, clears its cleanup timeout, increments refCount, and returns it.
 *   3. If a reference does not exist, pops a warm container from the WarmPoolManager.
 *   4. Creates the host-side workspace directory mapped to the bind mount.
 *   5. Executes a recursive CTE database query to fetch the file structure in a single query.
 *   6. Compiles an in-memory tar archive of the files and directories.
 *   7. Pipes the tar stream into a container process running `tar -x -C /workspaces/<workspaceId>`.
 *   8. Moves the runtime run script and triggers a background `npm install` execution.
 *   9. Maps the container reference in activeWorkspaceContainers.
 * Design Decisions: Reference counting allows multiple browser tabs to share a single container instance.
 *                   Streaming tar archives directly in memory avoids temporary host-side disk write latency.
 * Complexity: Time Complexity: File tree DB fetch O(N), file extraction O(N * F) where N is file count 
 *             and F is file size; Space Complexity O(N) memory allocation.
 * Security & Failure Cases: Catches environment setup errors to ensure the container is still registered 
 *                           even if a post-creation script fails.
 */
export async function getOrCreateWorkspaceContainer(userId: string, workspaceId: string): Promise<Docker.Container> {
  const key = `${userId}-${workspaceId}`;
  const existingRef = activeWorkspaceContainers.get(key);
  
  if (existingRef) {
    if (existingRef.cleanupTimeout) {
      clearTimeout(existingRef.cleanupTimeout);
      existingRef.cleanupTimeout = null;
    }
    existingRef.refCount++;
    return existingRef.container;
  }

  const { container, id, hostPort } = await warmPoolManager.popTerminalContainer();

  const wsHostDir = path.join(WORKSPACE_DATA_DIR, workspaceId);
  if (!existsSync(wsHostDir)) mkdirSync(wsHostDir, { recursive: true });

  const filesRes = await getPool().query(
    `WITH RECURSIVE file_path_cte AS (
      SELECT id, parent_id, name, type, content, name::text as path FROM files WHERE workspace_id = $1 AND parent_id IS NULL
      UNION ALL
      SELECT f.id, f.parent_id, f.name, f.type, f.content, (cte.path || '/' || f.name)::text as path
      FROM files f INNER JOIN file_path_cte cte ON f.parent_id = cte.id WHERE f.workspace_id = $1
    ) SELECT type, content, path FROM file_path_cte;`,
    [workspaceId]
  );

  const wsContainerPath = `/workspaces/${workspaceId}`;
  const pack = tar.pack();
  for (const file of filesRes.rows) {
    if (file.type === 'file') {
      pack.entry({ name: file.path }, file.content || '');
    } else {
      pack.entry({ name: file.path, type: 'directory' });
    }
  }
  pack.entry({ name: '.run.sh' }, RUN_SCRIPT);
  pack.finalize();

  const exec = await container.exec({ 
    Cmd: ['tar', '-x', '-C', wsContainerPath], 
    AttachStdin: true, 
    AttachStdout: true, 
    AttachStderr: true 
  });
  const stream = await exec.start({ hijack: true, stdin: true });
  
  await new Promise<void>((resolve, reject) => {
    pack.pipe(stream);
    stream.on('end', resolve);
    stream.on('error', reject);
    pack.on('error', reject);
  });

  try {
    const setupExec = await container.exec({ 
      Cmd: ['sh', '-c', `cp ${wsContainerPath}/.run.sh /usr/local/bin/run && chmod +x /usr/local/bin/run && rm -f ${wsContainerPath}/.run.sh`] 
    });
    const setupStream = await setupExec.start({ hijack: true, stdin: false });
    await new Promise<void>((res) => { 
      setupStream.on('end', res); 
      setupStream.on('error', res); 
    });

    const installExec = await container.exec({ 
      Cmd: ['sh', '-c', `cd ${wsContainerPath} && if [ -f package.json ] && [ ! -d node_modules ]; then npm install; fi`] 
    });
    installExec.start({ Detach: true, hijack: false }).catch(() => {});
  } catch (err) {
    console.error(`[WorkspaceContainer] Setup failed for ${key}:`, err);
  }

  activeWorkspaceContainers.set(key, { container, id, refCount: 1, hostPort, cleanupTimeout: null, lastActivityMs: Date.now() });
  return container;
}

/**
 * Purpose: Decrements container references and manages dynamic cleanup timeouts.
 * Under the Hood: 
 *   - Decrements reference counts when a user closes a tab.
 *   - Once the reference count hits 0, starts a 5-minute timeout.
 *   - When the timer fires, removes the container instance from Docker and deletes the entry.
 * Complexity: Time Complexity O(1), Space Complexity O(1).
 */
export async function releaseWorkspaceContainer(userId: string, workspaceId: string): Promise<void> {
  const key = `${userId}-${workspaceId}`;
  const ref = activeWorkspaceContainers.get(key);
  if (!ref) return;

  ref.refCount--;

  if (ref.refCount <= 0) {
    if (ref.cleanupTimeout) {
      clearTimeout(ref.cleanupTimeout);
    }
    const gracePeriod = process.env.NODE_ENV === 'test' || process.env.CI ? 5000 : 300000;
    ref.cleanupTimeout = setTimeout(async () => {
      const currentRef = activeWorkspaceContainers.get(key);
      if (currentRef && currentRef.refCount <= 0) {
        activeWorkspaceContainers.delete(key);
        await currentRef.container.remove({ force: true }).catch(() => {});
        warmPoolManager.releaseTerminalContainer();
      }
    }, gracePeriod);
  }
}

/**
 * Purpose: Cleans up and deletes all running workspace containers during server shutdown.
 * Under the Hood: Iterates through registry map values, clears timeouts, and removes instances.
 * Complexity: Time Complexity O(C) where C is active container count, Space Complexity O(1).
 */
export async function cleanupAllWorkspaceContainers(): Promise<void> {
  for (const [key, ref] of activeWorkspaceContainers.entries()) {
    if (ref.cleanupTimeout) {
      clearTimeout(ref.cleanupTimeout);
    }
    await ref.container.remove({ force: true }).catch(() => {});
  }
  activeWorkspaceContainers.clear();
}

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

// Global AFK Sweeper: Cleans up containers that have been inactive for more than 30 minutes.
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