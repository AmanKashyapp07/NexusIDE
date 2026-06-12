import Docker from 'dockerode';
import { warmPoolManager } from './pool';
import { getPool } from '../db';
import tar from 'tar-stream';

export interface WorkspaceContainerRef {
  container: Docker.Container;
  id: string;
  refCount: number;
}

// Map key: `${userId}-${workspaceId}`
const activeWorkspaceContainers = new Map<string, WorkspaceContainerRef>();

export async function getOrCreateWorkspaceContainer(userId: string, workspaceId: string): Promise<Docker.Container> {
  const key = `${userId}-${workspaceId}`;
  let ref = activeWorkspaceContainers.get(key);
  if (ref) {
    ref.refCount++;
    console.log(`[WorkspaceContainer] Reusing container for session ${key}. refCount=${ref.refCount}`);
    return ref.container;
  }

  console.log(`[WorkspaceContainer] Creating new container for session ${key}...`);
  const warm = await warmPoolManager.popTerminalContainer();
  const container = warm.container;

  // Hydrate files recursively from DB
  const filesRes = await getPool().query(
    `WITH RECURSIVE file_path_cte AS (
      SELECT id, parent_id, name, type, content, name::text as path
      FROM files 
      WHERE workspace_id = $1 AND parent_id IS NULL
      UNION ALL
      SELECT f.id, f.parent_id, f.name, f.type, f.content, (cte.path || '/' || f.name)::text as path
      FROM files f
      INNER JOIN file_path_cte cte ON f.parent_id = cte.id
      WHERE f.workspace_id = $1
    )
    SELECT id, parent_id, name, type, content, path FROM file_path_cte;`,
    [workspaceId]
  );

  const workspaceFiles = filesRes.rows;

  if (workspaceFiles.length > 0) {
    console.log(`[WorkspaceContainer] Hydrating container for ${key} with ${workspaceFiles.length} files`);
    const execWrite = await container.exec({
      Cmd: ['tar', '-xf', '-', '-C', '/app'],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true
    });
    const writeStream = await execWrite.start({ hijack: true, stdin: true });
    
    const pack = tar.pack();
    pack.pipe(writeStream);
    
    for (const file of workspaceFiles) {
      if (file.type === 'directory') {
        pack.entry({ name: file.path, type: 'directory' });
      } else {
        pack.entry({ name: file.path }, file.content || '');
      }
    }
    pack.finalize();
    
    await new Promise<void>((resolve, reject) => {
      writeStream.on('end', () => resolve());
      writeStream.on('error', (err) => reject(err));
    });
  }

  ref = {
    container,
    id: container.id,
    refCount: 1
  };
  activeWorkspaceContainers.set(key, ref);
  return container;
}

export async function releaseWorkspaceContainer(userId: string, workspaceId: string): Promise<void> {
  const key = `${userId}-${workspaceId}`;
  const ref = activeWorkspaceContainers.get(key);
  if (!ref) return;

  ref.refCount--;
  console.log(`[WorkspaceContainer] Session ${key} refCount decreased to ${ref.refCount}`);

  if (ref.refCount <= 0) {
    console.log(`[WorkspaceContainer] Cleaning up container for session ${key}...`);
    activeWorkspaceContainers.delete(key);
    try {
      await ref.container.remove({ force: true });
    } catch (err: any) {
      console.error(`[WorkspaceContainer] Failed to remove container ${ref.id}:`, err.message);
    }
    warmPoolManager.releaseTerminalContainer();
  }
}

export function getRunningContainer(userId: string, workspaceId: string): Docker.Container | null {
  const key = `${userId}-${workspaceId}`;
  const ref = activeWorkspaceContainers.get(key);
  return ref ? ref.container : null;
}
