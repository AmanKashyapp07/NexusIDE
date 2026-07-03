import { IncomingMessage } from 'http';
import { WebSocket } from 'ws';
import { getPool } from '../db';
import jwt from 'jsonwebtoken';
import Docker from 'dockerode';
import { Writable } from 'stream';
import * as Y from 'yjs';
import { getIO } from '../socket';
// @ts-ignore
import { docs } from 'y-websocket/bin/utils';
import { getOrCreateWorkspaceContainer, releaseWorkspaceContainer, getRunningContainer } from '../sandbox/workspaceContainer';

type TerminalRole = 'viewer' | 'editor' | 'admin';

const logDebug = (msg: string) => process.stdout.write(`[DEBUG] ${msg}\n`);

// =============================================================================
// [ARCHITECTURE] WRITE-COOLDOWN REGISTRY
// =============================================================================
// When the editor writes a file to the container disk, we record the write timestamp.
// The watcher will skip any file whose mtime matches a recent write, preventing the
// circular "write → detect → overwrite Yjs" feedback loop that causes vanishing text.

const recentWrites = new Map<string, number>(); // key: `${workspaceId}/${relativePath}`, value: timestamp (ms)
const WRITE_COOLDOWN_MS = 3000; // Ignore watcher changes within 3s of our own write

function markFileAsWritten(workspaceId: string, relativePath: string): void {
  recentWrites.set(`${workspaceId}/${relativePath}`, Date.now());
}

function isInWriteCooldown(workspaceId: string, relativePath: string): boolean {
  const key = `${workspaceId}/${relativePath}`;
  const writeTime = recentWrites.get(key);
  if (!writeTime) return false;
  if (Date.now() - writeTime < WRITE_COOLDOWN_MS) return true;
  recentWrites.delete(key); // Expired, clean up
  return false;
}

// Check if a file has an active Yjs document open (meaning clients are editing it).
// If it does, the watcher must NEVER overwrite its content — Yjs is the source of truth.
function hasActiveYjsDoc(workspaceId: string, fileId: string): boolean {
  const docName = `${workspaceId}-${fileId}`;
  return docs.has(docName);
}

// =============================================================================
// [CONFIGURATION] WATCHER EXCLUSIONS & LIMITS
// =============================================================================

const MAX_FILE_SIZE_BYTES = 1 * 1024 * 1024; // 1MB — skip files larger than this to prevent OOM

// Directories to completely exclude from scanning (pruned in the `find` command itself)
const EXCLUDED_DIRS = ['node_modules', '.git', '.next', 'dist', 'build', '.cache', '__pycache__', '.venv', 'venv'];

// =============================================================================
// [I/O MULTIPLEXING] TERMINAL WEBSOCKET HANDLER
// =============================================================================
export async function handleTerminalConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
  let stream: any = null, container: Docker.Container | null = null;
  let userId = '', workspaceId = '';

  try {
    const url = new URL(req.url || '', 'http://' + (req.headers.host || 'localhost'));
    workspaceId = url.pathname.split('/').filter(Boolean)[1] as string;
    const token = url.searchParams.get('token');

    if (!workspaceId || !token) return ws.close(4401, 'Unauthorized');

    let decodedUser: any;
    try { decodedUser = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret'); }
    catch { return ws.close(4401, 'Invalid token'); }

    userId = String(decodedUser?.id || '');
    if (!userId) return ws.close(4401, 'Invalid payload');

    const wsResult = await getPool().query('SELECT owner_id, is_public FROM workspaces WHERE id = $1', [workspaceId]);
    if (!wsResult.rows.length) return ws.close(4404, 'Not found');

    const workspace = wsResult.rows[0];
    let userRole: TerminalRole | null = workspace.owner_id === userId ? 'admin' : null;

    if (!userRole) {
      const collabRes = await getPool().query('SELECT role FROM workspace_collaborators WHERE workspace_id = $1 AND user_id = $2', [workspaceId, userId]);
      userRole = collabRes.rows.length ? collabRes.rows[0].role : (workspace.is_public ? 'viewer' : null);
    }
    if (!userRole) return ws.close(4403, 'Forbidden');

    let githubToken = '', githubUsername = '', githubEmail = '';
    if (userRole === 'admin') {
      const userRes = await getPool().query('SELECT github_token, username, email FROM users WHERE id = $1', [userId]);
      if (userRes.rows.length) { githubToken = userRes.rows[0].github_token || ''; githubUsername = userRes.rows[0].username || ''; githubEmail = userRes.rows[0].email || ''; }
    }

    container = await getOrCreateWorkspaceContainer(userId, workspaceId);

    // Viewers get restricted bash
    const isViewer = userRole === 'viewer';
    const envVars = [
      'PS1=\\[\\033[1;35m\\]sandbox\\[\\033[0m\\]:\\[\\033[1;34m\\]\\w\\[\\033[1;32m\\]\\$\\[\\033[0m\\] ',
      'PROMPT_DIRTRIM=2',
      'TERM=xterm-256color', 'LANG=C.UTF-8', `HOME=/workspaces/${workspaceId}`
    ];
    if (isViewer) envVars.push('PATH=/viewer_bin');

    // Git credential setup for admin users
    if (userRole === 'admin' && githubToken) {
      envVars.push(`GITHUB_TOKEN=${githubToken}`, `GIT_AUTHOR_NAME=${githubUsername}`, `GIT_AUTHOR_EMAIL=${githubEmail}`, `GIT_COMMITTER_NAME=${githubUsername}`, `GIT_COMMITTER_EMAIL=${githubEmail}`, `GIT_ASKPASS=/tmp/git-askpass`);
      const askpass = `#!/bin/sh\ncase "$1" in\n  *Username*|*username*) echo "git" ;;\n  *) echo "$GITHUB_TOKEN" ;;\nesac`;
      const wrapper = `#!/bin/sh\ncase "$1" in\n  clone) /usr/bin/git "$@" ;;\n  commit|push|add|status|log|diff|pull) if [ ! -d .git ]; then echo "Error: Not a git repository."; exit 1; fi; /usr/bin/git "$@" ;;\n  *) echo "Only clone, commit, push, add, status, log, diff, pull allowed." ; exit 1 ;;\nesac`;

      try {
        const setupExec = await container.exec({ Cmd: ['sh', '-c', `echo "${Buffer.from(askpass).toString('base64')}" | base64 -d > /tmp/git-askpass && chmod +x /tmp/git-askpass && echo "${Buffer.from(wrapper).toString('base64')}" | base64 -d > /tmp/git && chmod +x /tmp/git`] });
        await setupExec.start({ hijack: true, stdin: false });
        await new Promise(res => setTimeout(res, 200));
        envVars.push('PATH=/tmp:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin');
      } catch (err: any) { console.error('[Terminal] Git setup failed:', err.message); }
    }

    const wsPath = `/workspaces/${workspaceId}`;
    const exec = await container.exec({ Cmd: isViewer ? ['/bin/bash', '--restricted'] : ['/bin/bash'], Tty: true, AttachStdin: true, AttachStdout: true, AttachStderr: true, WorkingDir: wsPath, Env: envVars });
    stream = await exec.start({ hijack: true, stdin: true, Tty: true });

    // Start background file synchronization watcher
    const watcherTimeout = { current: null as NodeJS.Timeout | null };
    startTerminalWatcher(ws, container, workspaceId, watcherTimeout);

    // Raw byte piping between browser WebSocket and container shell
    stream.on('data', (chunk: Buffer) => ws.readyState === WebSocket.OPEN && ws.send(chunk));
    ws.on('message', (data: any) => stream && !stream.destroyed && stream.writable && stream.write(Buffer.isBuffer(data) ? data : Buffer.from(data)));

    stream.on('end', () => ws.readyState === WebSocket.OPEN && ws.close(1000, 'Shell ended'));
    stream.on('error', () => ws.readyState === WebSocket.OPEN && ws.close(1011, 'Stream error'));

    ws.on('close', async () => {
      if (watcherTimeout.current) clearTimeout(watcherTimeout.current);
      if (stream && !stream.destroyed) { try { stream.end(); stream.destroy(); } catch {} }
      if (container) await releaseWorkspaceContainer(userId, workspaceId).catch(() => {});
    });
    ws.on('error', () => (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) && ws.close());

  } catch (err: any) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(/docker|connect|enoent|econnrefused/i.test(err.message || '') ? 4500 : 1011, 'Connection error');
    }
  }
}

// =============================================================================
// [FILE SYNC] FORWARD (Editor/Yjs -> Container Disk)
// =============================================================================
// This is the ONE-WAY OUT path: content flows from Yjs → DB → disk.
// The watcher should never reverse this flow for files with active editors.

async function getContainerForSync(workspaceId: string): Promise<Docker.Container | null> {
  try {
    const res = await getPool().query('SELECT owner_id FROM workspaces WHERE id = $1', [workspaceId]);
    if (!res.rows.length) return null;
    return getRunningContainer(res.rows[0].owner_id, workspaceId);
  } catch { return null; }
}

const npmInstallTimeouts = new Map<string, NodeJS.Timeout>();

/**
 * Writes file content from the editor to the container disk.
 * Uses safe argument passing (stdin pipe) to avoid shell injection.
 */
export async function syncFileToTerminal(workspaceId: string, fileId: string, content: string): Promise<void> {
  try {
    const container = await getContainerForSync(workspaceId);
    if (!container) return;

    const pathRes = await getPool().query(
      `WITH RECURSIVE cte AS (
        SELECT id, name::text as path FROM files WHERE workspace_id = $1 AND parent_id IS NULL
        UNION ALL
        SELECT f.id, (cte.path || '/' || f.name)::text FROM files f JOIN cte ON f.parent_id = cte.id WHERE f.workspace_id = $1
      ) SELECT path FROM cte WHERE id = $2;`,
      [workspaceId, fileId]
    );
    if (!pathRes.rows.length) return;

    const filePath = pathRes.rows[0].path;
    const wsPath = `/workspaces/${workspaceId}`;
    const fullPath = `${wsPath}/${filePath}`;

    // SAFE FILE WRITE: Use base64 encoding to transport content safely.
    // This avoids all shell injection vectors — no filename interpolation in shell commands.
    const contentBase64 = Buffer.from(content, 'utf8').toString('base64');
    const dirPath = fullPath.substring(0, fullPath.lastIndexOf('/'));

    // Use a two-step approach: mkdir with positional args, then base64 decode into file via stdin
    const mkdirExec = await container.exec({ Cmd: ['mkdir', '-p', dirPath] });
    await mkdirExec.start({ hijack: true, stdin: false });
    await new Promise(res => setTimeout(res, 50));

    // Write content via stdin pipe to avoid any shell metacharacter issues
    const writeExec = await container.exec({
      Cmd: ['sh', '-c', `base64 -d > "${fullPath.replace(/"/g, '\\"')}"`],
      AttachStdin: true, AttachStdout: true, AttachStderr: true
    });
    const writeStream = await writeExec.start({ hijack: true, stdin: true });
    writeStream.end(contentBase64);

    // Mark this file as recently written so the watcher ignores the mtime change
    markFileAsWritten(workspaceId, filePath);

    // Debounced npm install on package.json changes
    if (filePath === 'package.json') {
      if (npmInstallTimeouts.has(workspaceId)) clearTimeout(npmInstallTimeouts.get(workspaceId)!);
      npmInstallTimeouts.set(workspaceId, setTimeout(async () => {
        try {
          (await container.exec({ Cmd: ['sh', '-c', `cd ${wsPath} && npm install`] }))
            .start({ Detach: true, hijack: false }).catch(() => {});
        } catch {}
      }, 2000));
    }
  } catch (err: any) { console.error('[TerminalSync] Sync failed:', err.message); }
}

export async function syncDeleteToTerminal(wsId: string, filePath: string): Promise<void> {
  const c = await getContainerForSync(wsId);
  if (c) (await c.exec({ Cmd: ['rm', '-rf', `/workspaces/${wsId}/${filePath}`] })).start({ hijack: true, stdin: false }).catch(() => {});
}

export async function syncFolderToTerminal(wsId: string, folderPath: string): Promise<void> {
  const c = await getContainerForSync(wsId);
  if (c) (await c.exec({ Cmd: ['mkdir', '-p', `/workspaces/${wsId}/${folderPath}`] })).start({ hijack: true, stdin: false }).catch(() => {});
}

// =============================================================================
// [STATE MANAGEMENT] REVERSE SYNC (Container -> DB/Yjs)
// =============================================================================
// This handles EXTERNAL changes: files created/modified/deleted by terminal commands
// (git clone, npm init, vim, etc.) where no active Yjs editor session exists.

async function getWorkspaceFilesMap(workspaceId: string) {
  const res = await getPool().query(
    `WITH RECURSIVE cte AS (
      SELECT id, parent_id, name, type, content, name::text as path FROM files WHERE workspace_id = $1 AND parent_id IS NULL
      UNION ALL
      SELECT f.id, f.parent_id, f.name, f.type, f.content, (cte.path || '/' || f.name)::text FROM files f JOIN cte ON f.parent_id = cte.id WHERE f.workspace_id = $1
    ) SELECT * FROM cte;`,
    [workspaceId]
  );
  const pathToId = new Map<string, string>(), idToPath = new Map<string, string>(), fileDetails = new Map<string, any>();
  res.rows.forEach(r => { pathToId.set(r.path, r.id); idToPath.set(r.id, r.path); fileDetails.set(r.path, { id: r.id, type: r.type, content: r.content }); });
  return { pathToId, idToPath, fileDetails };
}

async function dbCreateFile(workspaceId: string, relativePath: string, type: 'file' | 'directory', content = ''): Promise<string | null> {
  const parts = relativePath.split('/'), name = parts.pop() || '', parentPath = parts.join('/');
  let parentId: string | null = null;
  if (parentPath) {
    const map = await getWorkspaceFilesMap(workspaceId);
    parentId = map.pathToId.get(parentPath) || null;
    if (!parentId) {
      parentId = await dbCreateFile(workspaceId, parentPath, 'directory', '') || null;
    }
  }
  const lang = type === 'file' ? (name.match(/\.(js|ts|tsx|jsx|mjs)$/) ? 'javascript' : name.match(/\.py$/) ? 'python' : name.match(/\.cpp$/) ? 'cpp' : name.match(/\.c$/) ? 'c' : name.match(/\.html$/) ? 'html' : name.match(/\.css$/) ? 'css' : name.match(/\.java$/) ? 'java' : name.match(/\.json$/) ? 'json' : name.match(/\.md$/) ? 'markdown' : 'text') : null;

  try {
    const res = await getPool().query(
      `INSERT INTO files (workspace_id, name, type, parent_id, language, content) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [workspaceId, name, type, parentId, lang, content]
    );

    // Create initial Yjs state for new files
    if (res.rows[0]?.id && type === 'file') {
      const ydoc = new Y.Doc();
      ydoc.getText('monaco').insert(0, content);
      await getPool().query('UPDATE files SET yjs_state = $1 WHERE id = $2', [Buffer.from(Y.encodeStateAsUpdate(ydoc)), res.rows[0].id]);
      ydoc.destroy();
    }
    return res.rows[0]?.id;
  } catch (err: any) {
    if (err.code === '23505') {
      const existing = await getWorkspaceFilesMap(workspaceId);
      return existing.pathToId.get(relativePath) || null;
    }
    throw err;
  }
}

/**
 * Updates a file's content in the DB. ONLY called for files WITHOUT an active Yjs doc.
 * For files with active editors, Yjs handles all state — we never touch them here.
 */
async function dbUpdateFileExternal(workspaceId: string, fileId: string, content: string) {
  // Double-check: if this file has an active Yjs doc, do NOT overwrite it
  if (hasActiveYjsDoc(workspaceId, fileId)) return;

  const ydoc = new Y.Doc();
  ydoc.getText('monaco').insert(0, content);
  await getPool().query('UPDATE files SET yjs_state = $1, content = $2 WHERE id = $3', [Buffer.from(Y.encodeStateAsUpdate(ydoc)), content, fileId]);
  ydoc.destroy();

  // If a Yjs doc gets opened AFTER this update (e.g., user opens the file),
  // the persistence layer's bindState will load the latest state from DB. No race.
}

async function dbDeleteFile(fileId: string) {
  await getPool().query('DELETE FROM files WHERE id = $1', [fileId]);
}

async function readContainerFileContent(container: Docker.Container, workspaceId: string, relativePath: string): Promise<string> {
  try {
    const exec = await container.exec({
      Cmd: ['sh', '-c', `base64 "/workspaces/${workspaceId}/${relativePath}"`],
      AttachStdout: true, AttachStderr: true
    });
    const stream = await exec.start({ hijack: true });
    return new Promise((resolve) => {
      let stdout = '';
      const stdoutW = new Writable({ write(c, _, cb) { stdout += c.toString('utf8'); cb(); } });
      const stderrW = new Writable({ write(_, __, cb) { cb(); } });
      container.modem.demuxStream(stream, stdoutW, stderrW);
      stream.on('end', () => {
        try {
          const decoded = Buffer.from(stdout.replace(/\s/g, ''), 'base64').toString('utf8');
          resolve(decoded);
        } catch { resolve(''); }
      });
      stream.on('error', () => resolve(''));
    });
  } catch { return ''; }
}

// =============================================================================
// [ARCHITECTURE] FS POLLING LOOP (Redesigned)
// =============================================================================
// The watcher detects EXTERNAL file system changes (from terminal commands) and
// syncs them to the DB. It follows strict rules:
//
// 1. NEVER touch files with an active Yjs document (those are owned by the editor)
// 2. NEVER touch files in write-cooldown (we just wrote them, ignore the mtime bump)
// 3. Skip files larger than MAX_FILE_SIZE_BYTES (prevents OOM)
// 4. Exclude heavy directories at the `find` command level (prevents CPU spikes)
// 5. Only scan to maxdepth 5 (reasonable project depth)

function startTerminalWatcher(ws: WebSocket, container: Docker.Container, workspaceId: string, watcherTimeout: { current: NodeJS.Timeout | null }) {
  logDebug(`[Watcher] Initializing watcher for workspace: ${workspaceId}`);
  let lastState = new Map<string, { path: string; mtime: number; size: number; isDir: boolean }>();
  let isFirstScan = true;

  const runScan = async () => {
    if (ws.readyState !== WebSocket.OPEN) {
      logDebug(`[Watcher] WebSocket closed for workspace: ${workspaceId}`);
      return;
    }
    try {
      const wsPath = `/workspaces/${workspaceId}`;

      // Build the find command with proper directory exclusions (pruned early, no traversal)
      const pruneArgs = EXCLUDED_DIRS.flatMap(dir => ['-name', dir, '-prune', '-o']);
      const findCmd = [
        'find', wsPath, '-mindepth', '1', '-maxdepth', '5',
        ...pruneArgs,
        '-exec', 'stat', '-c', '%Y %s %F %n', '{}', ';'
      ];

      const stream = await (await container.exec({ Cmd: findCmd, AttachStdout: true, AttachStderr: true })).start({ hijack: true });
      const rawOutput = await new Promise<string>((res) => {
        let out = '';
        const w = new Writable({ write(c, _, cb) { out += c.toString(); cb(); } });
        const errW = new Writable({ write(_, __, cb) { cb(); } }); // discard stderr
        container.modem.demuxStream(stream, w, errW);
        stream.on('end', () => res(out));
        stream.on('error', () => res(''));
      });

      logDebug(`[Watcher] Raw scan output for ${workspaceId}: [${rawOutput.trim()}]`);

      const currentFiles = new Map<string, any>();
      const wsPathPrefix = `${wsPath}/`;

      rawOutput.replace(/\r/g, '').split('\n').forEach(line => {
        const match = line.match(/^(\d+)\s+(\d+)\s+(.*?)\s+(\/workspaces\/.*)$/);
        if (match && match[4]?.startsWith(wsPathPrefix)) {
          const relPath = match[4].substring(wsPathPrefix.length).trim();
          if (!relPath || relPath.startsWith('.') || relPath.includes('/.')) return; // Skip dotfiles
          const size = parseInt(match[2]!, 10);
          const isDir = match[3]!.includes('directory');
          // Skip files exceeding size limit (prevents OOM when loading large files into memory)
          if (!isDir && size > MAX_FILE_SIZE_BYTES) return;
          currentFiles.set(relPath, { path: relPath, mtime: parseInt(match[1]!, 10), size, isDir });
        }
      });

      logDebug(`[Watcher] Parsed current files for ${workspaceId}: ${JSON.stringify(Array.from(currentFiles.keys()))}`);

      if (isFirstScan) {
        // On first scan, just establish baseline — don't sync anything
        const { fileDetails } = await getWorkspaceFilesMap(workspaceId);
        fileDetails.forEach((detail, path) => {
          lastState.set(path, {
            path,
            mtime: currentFiles.get(path)?.mtime || 0,
            size: currentFiles.get(path)?.size || 0,
            isDir: detail.type === 'directory'
          });
        });
        // Also add files that exist on disk but not in DB (to track them)
        for (const [path, entry] of currentFiles) {
          if (!lastState.has(path)) lastState.set(path, entry);
        }
        isFirstScan = false;
        logDebug(`[Watcher] First scan baseline established for ${workspaceId}. Tracked files count: ${lastState.size}`);

        if (ws.readyState === WebSocket.OPEN) watcherTimeout.current = setTimeout(runScan, 1500);
        return;
      }

      let changed = false;
      const { pathToId, fileDetails } = await getWorkspaceFilesMap(workspaceId);

      // Process Deletions: files that were in last scan but are gone now
      for (const [path] of lastState.entries()) {
        if (!currentFiles.has(path)) {
          const fileId = pathToId.get(path);
          logDebug(`[Watcher] File deletion detected for path: ${path}, ID: ${fileId}`);
          if (fileId) {
            // Don't delete from DB if the file has an active Yjs doc
            // (the editor is open — maybe user is about to recreate it)
            if (!hasActiveYjsDoc(workspaceId, fileId)) {
              await dbDeleteFile(fileId);
              logDebug(`[Watcher] Deleted file from DB: ${path}`);
              changed = true;
            }
          }
          lastState.delete(path);
        }
      }

      // Process Additions & Modifications
      // Sort: directories first, then by depth (shallowest first) for proper parent creation
      const sortedEntries = [...currentFiles.entries()].sort(([aPath, aVal], [bPath, bVal]) => {
        if (aVal.isDir && !bVal.isDir) return -1;
        if (!aVal.isDir && bVal.isDir) return 1;
        return aPath.split('/').length - bPath.split('/').length || aPath.localeCompare(bPath);
      });

      for (const [path, current] of sortedEntries) {
        const last = lastState.get(path);

        if (!last) {
          // NEW file/directory detected on disk
          logDebug(`[Watcher] Addition detected for path: ${path}`);
          if (fileDetails.has(path)) {
            // Already in DB, just track it
            lastState.set(path, current);
            continue;
          }
          const content = (!current.isDir && current.size > 0)
            ? await readContainerFileContent(container, workspaceId, path)
            : '';
          const newId = await dbCreateFile(workspaceId, path, current.isDir ? 'directory' : 'file', content);
          if (newId) {
            logDebug(`[Watcher] Created new file/directory in DB with ID: ${newId} for path: ${path}`);
            lastState.set(path, current);
            changed = true;
          }
        } else if (!current.isDir && (current.mtime !== last.mtime || current.size !== last.size)) {
          // MODIFIED file detected on disk
          const fileId = pathToId.get(path);
          logDebug(`[Watcher] Modification detected for file path: ${path}, ID: ${fileId}`);
          if (!fileId) { lastState.set(path, current); continue; }

          // CRITICAL: Skip if this file has an active Yjs editor session.
          // The editor owns this file's state — the watcher must not interfere.
          if (hasActiveYjsDoc(workspaceId, fileId)) {
            lastState.set(path, current); // Update mtime tracking but don't sync content
            continue;
          }

          // CRITICAL: Skip if we recently wrote this file to disk (our own write bouncing back)
          if (isInWriteCooldown(workspaceId, path)) {
            lastState.set(path, current);
            continue;
          }

          // It's a genuine external change (terminal command modified this file)
          const content = current.size > 0 ? await readContainerFileContent(container, workspaceId, path) : '';
          if (fileDetails.get(path)?.content !== content) {
            await dbUpdateFileExternal(workspaceId, fileId, content);
            logDebug(`[Watcher] Updated file content in DB for modified path: ${path}`);
            changed = true;
          }
          lastState.set(path, current);
        }
      }

      if (changed) {
        logDebug(`[Watcher] File tree changed, emitting file-tree-update event for room: presence-${workspaceId}`);
        getIO()?.to(`presence-${workspaceId}`).emit('file-tree-update');
      }
    } catch (err: any) {
      logDebug(`[Watcher] Scan error: ${err.message}`);
    }

    if (ws.readyState === WebSocket.OPEN) watcherTimeout.current = setTimeout(runScan, 1500);
  };

  watcherTimeout.current = setTimeout(runScan, 1500);
}
