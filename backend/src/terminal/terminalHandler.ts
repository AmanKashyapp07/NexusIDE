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
import { getOrCreateWorkspaceContainer, releaseWorkspaceContainer } from '../sandbox/workspaceContainer';

type TerminalRole = 'viewer' | 'editor' | 'admin';

// =============================================================================
// [I/O MULTIPLEXING] TERMINAL WEBSOCKET HANDLER
// =============================================================================
// INTERVIEW KEY: This function bridges a full-duplex TCP WebSocket from the browser 
// directly to the stdin/stdout of a running bash process inside a Docker container.
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

    // [SECURITY] RBAC Shell Degradation
    // Viewers get restricted bash (rbash) preventing them from changing directories or running unauthorized scripts.
    const isViewer = userRole === 'viewer';
    const envVars = [
      'PS1=\\[\\033[1;35m\\]\\u@sandbox\\[\\033[0m\\]:\\[\\033[1;34m\\]\\w\\[\\033[1;32m\\]\\$\\[\\033[0m\\] ',
      'TERM=xterm-256color', 'LANG=C.UTF-8', 'HOME=/tmp' // Fix for read-only rootfs
    ];
    if (isViewer) envVars.push('PATH=/viewer_bin');

    // [ARCHITECTURE] In-Memory Ephemeral Git Wrapper
    // INTERVIEW KEY: To support Git cloning in a container with a read-only root filesystem and no persistent disk, 
    // we inject credentials via env vars and base64-encode custom shell scripts into `/tmp`.
    // This shadows the system `git` binary to enforce strict security guardrails (blocking destructive commands).
    if (userRole === 'admin' && githubToken) {
      envVars.push(`GITHUB_TOKEN=${githubToken}`, `GIT_AUTHOR_NAME=${githubUsername}`, `GIT_AUTHOR_EMAIL=${githubEmail}`, `GIT_COMMITTER_NAME=${githubUsername}`, `GIT_COMMITTER_EMAIL=${githubEmail}`, `GIT_ASKPASS=/tmp/git-askpass`);
      const askpass = `#!/bin/sh\ncase "$1" in\n  *Username*|*username*) echo "git" ;;\n  *) echo "$GITHUB_TOKEN" ;;\nesac`;
      const wrapper = `#!/bin/sh\ncase "$1" in\n  clone) /usr/bin/git "$@" ;;\n  commit|push|add|status|log|diff) if [ ! -d .git ]; then echo "Error: Not a git repository."; exit 1; fi; /usr/bin/git "$@" ;;\n  *) echo "Only clone, commit, push, add, status, log, diff allowed." ; exit 1 ;;\nesac`;
      
      try {
        const setupExec = await container.exec({ Cmd: ['sh', '-c', `echo "${Buffer.from(askpass).toString('base64')}" | base64 -d > /tmp/git-askpass && chmod +x /tmp/git-askpass && echo "${Buffer.from(wrapper).toString('base64')}" | base64 -d > /tmp/git && chmod +x /tmp/git`] });
        await setupExec.start({ hijack: true, stdin: false });
        await new Promise(res => setTimeout(res, 200));
        envVars.push('PATH=/tmp:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'); // Prepend /tmp to shadow real git
      } catch (err: any) { console.error('[Terminal] Git setup failed:', err.message); }
    }

    const exec = await container.exec({ Cmd: isViewer ? ['/bin/bash', '--restricted'] : ['/bin/bash'], Tty: true, AttachStdin: true, AttachStdout: true, AttachStderr: true, WorkingDir: '/app', Env: envVars });
    stream = await exec.start({ hijack: true, stdin: true, Tty: true });

    // Start background file synchronization watcher
    const watcherTimeout = { current: null as NodeJS.Timeout | null };
    startTerminalWatcher(ws, container, workspaceId, watcherTimeout);

    // [STREAMING] Raw Byte Piping
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
// [FILE SYNC] FORWARD (DB/Editor -> Container)
// =============================================================================

async function getContainerForSync(workspaceId: string): Promise<Docker.Container | null> {
  try {
    const res = await getPool().query('SELECT owner_id FROM workspaces WHERE id = $1', [workspaceId]);
    return res.rows.length ? await getOrCreateWorkspaceContainer(res.rows[0].owner_id, workspaceId) : null;
  } catch { return null; }
}

const npmInstallTimeouts = new Map<string, NodeJS.Timeout>();

export async function syncFileToTerminal(workspaceId: string, fileId: string, content: string): Promise<void> {
  try {
    const container = await getContainerForSync(workspaceId);
    if (!container) return;

    const pathRes = await getPool().query(`WITH RECURSIVE cte AS (SELECT id, name::text as path FROM files WHERE workspace_id = $1 AND parent_id IS NULL UNION ALL SELECT f.id, (cte.path || '/' || f.name)::text FROM files f JOIN cte ON f.parent_id = cte.id WHERE f.workspace_id = $1) SELECT path FROM cte WHERE id = $2;`, [workspaceId, fileId]);
    if (!pathRes.rows.length) return;

    const filePath = pathRes.rows[0].path;
    const writeStream = await (await container.exec({ Cmd: ['sh', '-c', `mkdir -p "$(dirname "/app/${filePath}")" && cat > "/app/${filePath}"`], AttachStdin: true, AttachStdout: true, AttachStderr: true })).start({ hijack: true, stdin: true });
    writeStream.end(content);

    // [PERFORMANCE] Debounced NPM Installs
    // If a user is rapidly editing package.json, we don't want to run `npm install` 100 times.
    // We clear previous timeouts and wait for a 2-second typing pause before spawning the detached install.
    if (filePath === 'package.json') {
      if (npmInstallTimeouts.has(workspaceId)) clearTimeout(npmInstallTimeouts.get(workspaceId)!);
      npmInstallTimeouts.set(workspaceId, setTimeout(async () => {
        try { (await container.exec({ Cmd: ['sh', '-c', 'cd /app && npm install'] })).start({ Detach: true, hijack: false }).catch(()=>{}); } catch {}
      }, 2000));
    }
  } catch (err: any) { console.error('[TerminalSync] Sync failed:', err.message); }
}

export async function syncDeleteToTerminal(wsId: string, path: string): Promise<void> {
  const c = await getContainerForSync(wsId);
  if (c) (await c.exec({ Cmd: ['rm', '-rf', `/app/${path}`] })).start({ hijack: true, stdin: false }).catch(()=>{});
}

export async function syncFolderToTerminal(wsId: string, path: string): Promise<void> {
  const c = await getContainerForSync(wsId);
  if (c) (await c.exec({ Cmd: ['mkdir', '-p', `/app/${path}`] })).start({ hijack: true, stdin: false }).catch(()=>{});
}

// =============================================================================
// [STATE MANAGEMENT] REVERSE SYNC & POLLING (Container -> DB/Yjs)
// =============================================================================

async function getWorkspaceFilesMap(workspaceId: string) {
  const res = await getPool().query(`WITH RECURSIVE cte AS (SELECT id, parent_id, name, type, content, name::text as path FROM files WHERE workspace_id = $1 AND parent_id IS NULL UNION ALL SELECT f.id, f.parent_id, f.name, f.type, f.content, (cte.path || '/' || f.name)::text FROM files f JOIN cte ON f.parent_id = cte.id WHERE f.workspace_id = $1) SELECT * FROM cte;`, [workspaceId]);
  const pathToId = new Map<string, string>(), idToPath = new Map<string, string>(), fileDetails = new Map<string, any>();
  res.rows.forEach(r => { pathToId.set(r.path, r.id); idToPath.set(r.id, r.path); fileDetails.set(r.path, { id: r.id, type: r.type, content: r.content }); });
  return { pathToId, idToPath, fileDetails };
}

async function dbCreateFile(workspaceId: string, relativePath: string, type: 'file' | 'directory', content = '') {
  const parts = relativePath.split('/'), name = parts.pop() || '', parentPath = parts.join('/');
  const parentId = parentPath ? (await getWorkspaceFilesMap(workspaceId)).pathToId.get(parentPath) || null : null;
  const lang = type === 'file' ? (name.match(/\.(js|ts|mjs)$/) ? 'javascript' : name.match(/\.py$/) ? 'python' : name.match(/\.cpp$/) ? 'cpp' : name.match(/\.c$/) ? 'c' : name.match(/\.html$/) ? 'html' : name.match(/\.css$/) ? 'css' : name.match(/\.java$/) ? 'java' : 'text') : null;
  
  const res = await getPool().query(`INSERT INTO files (workspace_id, name, type, parent_id, language, content) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [workspaceId, name, type, parentId, lang, content]);
  
  // Propagate to Yjs CRDT instance
  if (res.rows[0]?.id && type === 'file') {
    const ydoc = new Y.Doc(); ydoc.getText('monaco').insert(0, content);
    await getPool().query('UPDATE files SET yjs_state = $1 WHERE id = $2', [Buffer.from(Y.encodeStateAsUpdate(ydoc)), res.rows[0].id]);
  }
  return res.rows[0]?.id;
}

async function dbUpdateFile(workspaceId: string, fileId: string, content: string) {
  const ydoc = new Y.Doc(); ydoc.getText('monaco').insert(0, content);
  await getPool().query('UPDATE files SET yjs_state = $1, content = $2 WHERE id = $3', [Buffer.from(Y.encodeStateAsUpdate(ydoc)), content, fileId]);
  
  // Force hot-reload open browser tabs via active Yjs instance
  const sharedDoc = docs.get(`${workspaceId}-${fileId}`);
  if (sharedDoc) {
    const text = sharedDoc.getText('monaco');
    if (text.toString() !== content) sharedDoc.transact(() => { text.delete(0, text.length); text.insert(0, content); });
  }
}

async function dbDeleteFile(fileId: string) { await getPool().query('DELETE FROM files WHERE id = $1', [fileId]); }

async function readContainerFileContent(container: Docker.Container, relativePath: string): Promise<string> {
  try {
    const stream = await (await container.exec({ Cmd: ['cat', `/app/${relativePath}`], AttachStdout: true })).start({ hijack: true });
    return new Promise((resolve, reject) => {
      let output = '';
      const w = new Writable({ write(c, _, cb) { output += c.toString('utf8'); cb(); } });
      container.modem.demuxStream(stream, w, w);
      stream.on('end', () => resolve(output)); stream.on('error', reject);
    });
  } catch { return ''; }
}

// [ARCHITECTURE] FS Polling Loop
// INTERVIEW KEY: Why use polling instead of `inotifywait` inside the container?
// Inotify relies on kernel events which are notoriously unreliable across certain Docker volume 
// mounts and virtualized hosts (like macOS). By executing a lightweight `find | stat` polling loop 
// every 1.5s, we guarantee a source-of-truth delta check between the ephemeral container and the persistent database.
function startTerminalWatcher(ws: WebSocket, container: Docker.Container, workspaceId: string, watcherTimeout: { current: NodeJS.Timeout | null }) {
  let lastState = new Map<string, { path: string; mtime: number; size: number; isDir: boolean }>(), isFirstScan = true;

  const runScan = async () => {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      // 1. Snapshot the current FS state
      const stream = await (await container.exec({ Cmd: ['find', '/app', '-mindepth', '1', '-maxdepth', '5', '-name', 'node_modules', '-prune', '-exec', 'stat', '-c', '%Y %s %F %n', '{}', ';', '-o', '-name', '.git', '-prune', '-o', '-exec', 'stat', '-c', '%Y %s %F %n', '{}', ';'], AttachStdout: true })).start({ hijack: true });
      const rawOutput = await new Promise<string>((res) => { let out = ''; const w = new Writable({ write(c, _, cb) { out += c.toString(); cb(); }}); container.modem.demuxStream(stream, w, w); stream.on('end', () => res(out)); stream.on('error', () => res('')); });
      
      const currentFiles = new Map<string, any>();
      rawOutput.replace(/\r/g, '').split('\n').forEach(line => {
        const match = line.match(/^(\d+)\s+(\d+)\s+(.*?)\s+\/app\/(.*)$/);
        if (match && match[1] && match[2] && match[3] && match[4]) {
          const relPath = match[4].trim();
          if (!relPath.startsWith('.') && !relPath.includes('/.')) { // Ignore dotfiles
            currentFiles.set(relPath, { path: relPath, mtime: parseInt(match[1], 10), size: parseInt(match[2], 10), isDir: match[3].includes('directory') });
          }
        }
      });

      if (isFirstScan) {
        const { fileDetails } = await getWorkspaceFilesMap(workspaceId);
        fileDetails.forEach((detail, path) => lastState.set(path, { path, mtime: currentFiles.get(path)?.mtime || 0, size: currentFiles.get(path)?.size || 0, isDir: detail.type === 'directory' }));
        isFirstScan = false;
      }

      let changed = false;
      const { pathToId, fileDetails } = await getWorkspaceFilesMap(workspaceId);

      // 2. Process Deletions
      for (const [path] of lastState.entries()) {
        if (!currentFiles.has(path)) {
          if (pathToId.get(path)) { await dbDeleteFile(pathToId.get(path)!); changed = true; }
          lastState.delete(path);
        }
      }

      // 3. Process Additions & Modifications
      for (const [path, current] of currentFiles.entries()) {
        const last = lastState.get(path);
        if (!last) {
          if (fileDetails.has(path)) { lastState.set(path, current); continue; }
          const content = (!current.isDir && current.size > 0) ? await readContainerFileContent(container, path) : '';
          if (await dbCreateFile(workspaceId, path, current.isDir ? 'directory' : 'file', content)) { lastState.set(path, current); changed = true; }
        } else if (!current.isDir && (current.mtime !== last.mtime || current.size !== last.size)) {
          const content = current.size > 0 ? await readContainerFileContent(container, path) : '';
          if (fileDetails.get(path)?.content !== content) { await dbUpdateFile(workspaceId, fileDetails.get(path)!.id, content); changed = true; }
          lastState.set(path, current);
        }
      }

      if (changed) {
        console.log(`[Watcher] File tree changed in workspace ${workspaceId}, emitting file-tree-update to presence-${workspaceId}`);
        getIO()?.to(`presence-${workspaceId}`).emit('file-tree-update');
      }
    } catch (err: any) {
      console.error('[Watcher] Scan error:', err.message);
    }
    
    if (ws.readyState === WebSocket.OPEN) watcherTimeout.current = setTimeout(runScan, 1500);
  };
  watcherTimeout.current = setTimeout(runScan, 1500);
}