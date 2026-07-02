import Docker from 'dockerode';
import { warmPoolManager } from './pool';
import { getPool } from '../db';
import tar from 'tar-stream';

export interface WorkspaceContainerRef {
  container: Docker.Container;
  id: string;
  refCount: number;
  hostPort?: number | undefined;
}

// Map key: `${userId}-${workspaceId}`
const activeWorkspaceContainers = new Map<string, WorkspaceContainerRef>();

export async function getOrCreateWorkspaceContainer(userId: string, workspaceId: string): Promise<Docker.Container> {
  const key = `${userId}-${workspaceId}`;
  const existingRef = activeWorkspaceContainers.get(key);
  if (existingRef) {
    existingRef.refCount++;
    console.log(`[WorkspaceContainer] Reusing container for session ${key}. refCount=${existingRef.refCount}`);
    return existingRef.container;
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

  console.log(`[WorkspaceContainer] Hydrating container for ${key} with ${workspaceFiles.length} files`);
  // Use Docker exec with tar to extract files.
  // We cannot use container.putArchive() here because /app is a tmpfs mount.
  // The Docker daemon's archive API writes directly to the overlayfs layers on the host,
  // which bypasses the container's tmpfs namespace, causing silent failures.
  const pack = tar.pack();

  for (const file of workspaceFiles) {
    if (file.type === 'file') {
      pack.entry({ name: file.path }, file.content || '');
    } else {
      pack.entry({ name: file.path, type: 'directory' });
    }
  }

  const runScriptContent = `#!/bin/sh
if [ -z "$1" ]; then
  echo "Usage: run <filename>"
  exit 1
fi

file="$1"
ext="\${file##*.}"

case "$ext" in
  py)
    python3 "$file"
    ;;
  js)
    node "$file"
    ;;
  c)
    gcc "$file" -o /tmp/a.out && /tmp/a.out
    ;;
  cpp)
    g++ "$file" -o /tmp/a.out && /tmp/a.out
    ;;
  java)
    javac "$file" -d /tmp && java -cp /tmp "\${file%.*}"
    ;;
  sh)
    sh "$file"
    ;;
  *)
    echo "Unsupported file extension: .$ext"
    exit 1
    ;;
esac
`;
  pack.entry({ name: '.run.sh' }, runScriptContent);
  pack.finalize();

  const exec = await container.exec({
    Cmd: ['tar', '-x', '-C', '/app'],
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start({ hijack: true, stdin: true });
  
  await new Promise<void>((resolve, reject) => {
    pack.pipe(stream);
    pack.on('end', () => resolve());
    pack.on('error', reject);
    stream.on('error', reject);
  });

  // Setup the global 'run' utility
  try {
    const setupExec = await container.exec({
      Cmd: ['sh', '-c', 'cp /app/.run.sh /usr/local/bin/run && chmod +x /usr/local/bin/run && rm -f /app/.run.sh'],
    });
    await setupExec.start({ hijack: true, stdin: false });
  } catch (err: any) {
    console.error('[WorkspaceContainer] Failed to set up run utility:', err.message);
  }

  // Auto-install node_modules if package.json exists
  try {
    const installExec = await container.exec({
      Cmd: ['sh', '-c', 'cd /app && if [ -f package.json ] && [ ! -d node_modules ]; then npm install; fi'],
      AttachStdin: false,
      AttachStdout: false,
      AttachStderr: false
    });
    installExec.start({ Detach: true, hijack: false }).catch(err => console.error('[WorkspaceContainer] Auto-install detached start failed:', err));
  } catch (err: any) {
    console.error('[WorkspaceContainer] Failed to start auto-install:', err.message);
  }

  const newRef: WorkspaceContainerRef = {
    container,
    id: container.id,
    refCount: 1,
    hostPort: warm.hostPort
  };
  activeWorkspaceContainers.set(key, newRef);
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

export function getRunningContainerRef(userId: string, workspaceId: string): WorkspaceContainerRef | null {
  const key = `${userId}-${workspaceId}`;
  return activeWorkspaceContainers.get(key) || null;
}
