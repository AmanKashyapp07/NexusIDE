/**
 * Purpose: Terminal PTY WebSocket handler, Docker execution attach stream demuxer, and bi-directional filesystem watcher.
 * High-Level Architecture: Bridges raw WebSocket client terminal frames to containerized bash PTY streams, while running a polling file-watcher daemon (`stat`/`inode` tracking) that syncs container filesystem changes back into PostgreSQL and Socket.IO.
 * Primary Trade-offs: Inode-based diffing over raw path tracking enables atomic file move/rename detection across container volumes.
 * Complexity: O(K) directory stat scanning per polling interval, where K is container file count (depth-capped at 5).
 */

import { IncomingMessage } from 'http';
import { WebSocket } from 'ws';
import { getPool } from '../db.js';
import jwt from 'jsonwebtoken';
import type Docker from 'dockerode';
import { Writable } from 'stream';
import * as Y from 'yjs';
import { getIO } from '../socket.js';
import { docs } from '../server.js';
import { getOrCreateWorkspaceContainer, releaseWorkspaceContainer, getRunningContainer } from '../sandbox/workspaceContainer.js';
import { TerminalStreamBuffer } from './terminalStreamBuffer.js';
import type { TerminalRole, TerminalWatcherEntry, WorkspaceFileDetail, WorkspaceFilesMapResult } from '../types/terminal.types.js';

interface DecodedUser {
   id: string;
}

interface DBWorkspace {
   owner_id: string;
   is_public: boolean;
}

interface DBUser {
   github_token?: string;
   username?: string;
   email?: string;
}

const logDebug = (msg: string): void => {
   process.stdout.write(`[DEBUG] ${msg}\n`);
};

// =============================================================================
// WRITE COOLDOWN & STATE GUARDS
// =============================================================================

// INTENT: Prevent infinite write loops between terminal filesystem updates and database synchronization.
const recentWrites = new Map<string, number>(); 
const WRITE_COOLDOWN_MS = 3000; 

function markFileAsWritten(workspaceId: string, relativePath: string): void {
   recentWrites.set(`${workspaceId}/${relativePath}`, Date.now());
}

function isInWriteCooldown(workspaceId: string, relativePath: string): boolean {
   const key = `${workspaceId}/${relativePath}`;
   const writeTime = recentWrites.get(key);
   if (!writeTime) return false;
   if (Date.now() - writeTime < WRITE_COOLDOWN_MS) return true;
   recentWrites.delete(key); 
   return false;
}

function hasActiveYjsDoc(workspaceId: string, fileId: string): boolean {
   const docName = `${workspaceId}-${fileId}`;
   return !!(docs && docs.has(docName));
}

const MAX_FILE_SIZE_BYTES = 1 * 1024 * 1024; 
const EXCLUDED_DIRS = ['node_modules', '.git', '.next', 'dist', 'build', '.cache', '__pycache__', '.venv', 'venv'];

// =============================================================================
// TERMINAL WEBSOCKET CONNECTION HANDLER & DOCKER ATTACH
// =============================================================================

// INTENT: Connect interactive xterm.js frontend WebSocket to container bash TTY stream.
// WHY: Stream hijack enables real-time terminal I/O streaming with sub-millisecond input response times.
// INTERVIEW NOTES: Enforces restricted shell (`/bin/bash --restricted`) and path stripping for 'viewer' role to sandbox non-admin shell access.
export async function handleTerminalConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
   let stream: { write: (data: Buffer) => void; destroyed?: boolean; writable?: boolean; end: () => void; destroy?: () => void; on: (event: string, cb: (...args: unknown[]) => void) => void } | null = null;
   let container: Docker.Container | null = null;
   let userId = '';
   let workspaceId = '';

   try {
      const url = new URL(req.url || '', 'http://' + (req.headers.host || 'localhost'));
      const pathSegments = url.pathname.split('/').filter(Boolean);
      // Support both /terminal/{id} and /ws/terminal/{id} path forms
      const uuidSegment = pathSegments.find(seg => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(seg));
      workspaceId = uuidSegment || (pathSegments[1] as string);
      const token = url.searchParams.get('token');


      if (!workspaceId || !token) return ws.close(4401, 'Unauthorized');

      let decodedUser: DecodedUser;
      try { 
         decodedUser = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret') as DecodedUser; 
      } catch { 
         return ws.close(4401, 'Invalid token'); 
      }

      userId = String(decodedUser?.id || '');
      if (!userId) return ws.close(4401, 'Invalid payload');

      const wsResult = await getPool().query<DBWorkspace>('SELECT owner_id, is_public FROM workspaces WHERE id = $1', [workspaceId]);
      if (!wsResult.rows.length) return ws.close(4404, 'Not found');

      const workspace = wsResult.rows[0]!;
      let userRole: TerminalRole | null = workspace.owner_id === userId ? 'admin' : null;

      if (!userRole) {
         const collabRes = await getPool().query<{ role: TerminalRole }>('SELECT role FROM workspace_collaborators WHERE workspace_id = $1 AND user_id = $2', [workspaceId, userId]);
         userRole = collabRes.rows.length ? collabRes.rows[0]!.role : (workspace.is_public ? 'viewer' : null);
      }
      if (!userRole) return ws.close(4403, 'Forbidden');

      let githubToken = '';
      let githubUsername = '';
      let githubEmail = '';
      if (userRole === 'admin') {
         const userRes = await getPool().query<DBUser>('SELECT github_token, username, email FROM users WHERE id = $1', [userId]);
         if (userRes.rows.length) { 
            githubToken = userRes.rows[0]!.github_token || ''; 
            githubUsername = userRes.rows[0]!.username || ''; 
            githubEmail = userRes.rows[0]!.email || ''; 
         }
      }

      container = await getOrCreateWorkspaceContainer(userId, workspaceId);

      const isViewer = userRole === 'viewer';
      const envVars = [
         'PS1=\\[\\033[1;35m\\]sandbox\\[\\033[0m\\]:\\[\\033[1;34m\\]~#\\[\\033[0m\\] ',
         'PROMPT_DIRTRIM=2',
         'TERM=xterm-256color', 'LANG=C.UTF-8', `HOME=/workspaces/${workspaceId}`
      ];
      if (isViewer) envVars.push('PATH=/viewer_bin');

      if (userRole === 'admin') {
         const isTestUser = githubEmail?.endsWith('@test.local');
         const isNoGitUser = githubUsername?.startsWith('NoGit');

         if (githubToken || (isTestUser && !isNoGitUser)) {
            const name = githubUsername || 'test-admin';
            const email = githubEmail || 'test-admin@test.local';
            const tokenVal = githubToken || 'dummy_token';
            envVars.push(`GITHUB_TOKEN=${tokenVal}`, `GIT_AUTHOR_NAME=${name}`, `GIT_AUTHOR_EMAIL=${email}`, `GIT_COMMITTER_NAME=${name}`, `GIT_COMMITTER_EMAIL=${email}`, `GIT_ASKPASS=/tmp/git-askpass`);
            const askpass = `#!/bin/sh\ncase "$1" in\n  *Username*|*username*) echo "git" ;;\n  *) echo "$GITHUB_TOKEN" ;;\nesac`;
            const wrapper = `#!/bin/sh\ncase "$1" in\n  clone|config) /usr/bin/git "$@" ;;\n  commit|push|add|status|log|diff|pull|checkout) if [ ! -d .git ] && [ "$1" != "checkout" ]; then echo "Error: Not a git repository."; exit 1; fi; /usr/bin/git "$@" ;;\n  *) echo "Only clone, config, commit, push, add, status, log, diff, pull, checkout allowed." ; exit 1 ;;\nesac`;

            try {
               const setupExec = await container.exec({ Cmd: ['sh', '-c', `echo "${Buffer.from(askpass).toString('base64')}" | base64 -d > /tmp/git-askpass && chmod +x /tmp/git-askpass && echo "${Buffer.from(wrapper).toString('base64')}" | base64 -d > /tmp/git && chmod +x /tmp/git`] });
               await setupExec.start({ hijack: true, stdin: false });
               await new Promise(res => setTimeout(res, 200));
               envVars.push('PATH=/tmp:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin');
            } catch (err: unknown) { 
               const msg = err instanceof Error ? err.message : String(err);
               console.error('[Terminal] Git setup failed:', msg); 
            }
         } else {
            const blocker = `#!/bin/sh\necho "Error: Git commands are only available when signed in with a GitHub account."\nexit 1`;
            try {
               const setupExec = await container.exec({ Cmd: ['sh', '-c', `echo "${Buffer.from(blocker).toString('base64')}" | base64 -d > /tmp/git && chmod +x /tmp/git`] });
               await setupExec.start({ hijack: true, stdin: false });
               await new Promise(res => setTimeout(res, 200));
               envVars.push('PATH=/tmp:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin');
            } catch (err: unknown) { 
               const msg = err instanceof Error ? err.message : String(err);
               console.error('[Terminal] Git blocker setup failed:', msg); 
            }
         }
      }

      const wsPath = `/workspaces/${workspaceId}`;
      const exec = await container.exec({ Cmd: isViewer ? ['/bin/bash', '--restricted'] : ['/bin/bash'], Tty: true, AttachStdin: true, AttachStdout: true, AttachStderr: true, WorkingDir: wsPath, Env: envVars });
      stream = await exec.start({ hijack: true, stdin: true, Tty: true });

      const watcherTimeout = { current: null as NodeJS.Timeout | null };
      startTerminalWatcher(ws, container, workspaceId, watcherTimeout);

      const streamBuffer = new TerminalStreamBuffer(ws);

      stream.on('data', (chunk: unknown) => {
         const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
         streamBuffer.push(data);
      });
      ws.on('message', (data: unknown) => {
         const bufferData = Buffer.isBuffer(data) ? data : Buffer.from(data as string | Uint8Array);
         if (stream && !stream.destroyed && stream.writable) stream.write(bufferData);
      });

      stream.on('end', () => {
         streamBuffer.flush();
         if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'Shell ended');
      });
      stream.on('error', () => {
         streamBuffer.clear();
         if (ws.readyState === WebSocket.OPEN) ws.close(1011, 'Stream error');
      });

      ws.on('close', async () => {
         streamBuffer.clear();
         if (watcherTimeout.current) clearTimeout(watcherTimeout.current);
         if (stream && !stream.destroyed) { 
            try { stream.end(); stream.destroy?.(); } catch {} 
         }
         if (container) await releaseWorkspaceContainer(userId, workspaceId).catch(() => {});
      });
      ws.on('error', () => (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) && ws.close());

   } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
         ws.close(/docker|connect|enoent|econnrefused/i.test(msg || '') ? 4500 : 1011, 'Connection error');
      }
   }
}

// =============================================================================
// CONTAINER FILESYSTEM SYNC ROUTINES
// =============================================================================

async function getContainerForSync(workspaceId: string): Promise<Docker.Container | null> {
   try {
      const res = await getPool().query<{ owner_id: string }>('SELECT owner_id FROM workspaces WHERE id = $1', [workspaceId]);
      return res.rows.length ? getRunningContainer(res.rows[0]!.owner_id, workspaceId) : null;
   } catch { 
      return null; 
   }
}

const npmInstallTimeouts = new Map<string, NodeJS.Timeout>();

// INTENT: Write updated editor buffer content directly into container disk volume.
// WHY: Ensures terminal commands (`python main.py`, `npm start`) execute against the latest edited code state.
// EDGE CASE: Blocks directory traversal attacks (`..`, NULL byte validation) on target target file path.
export async function syncFileToTerminal(workspaceId: string, fileId: string, content: string): Promise<void> {
   try {
      const container = await getContainerForSync(workspaceId);
      if (!container) return;

      const pathRes = await getPool().query<{ path: string }>(
         `WITH RECURSIVE cte AS (
            SELECT id, name::text as path FROM files WHERE workspace_id = $1 AND parent_id IS NULL
            UNION ALL
            SELECT f.id, (cte.path || '/' || f.name)::text FROM files f JOIN cte ON f.parent_id = cte.id WHERE f.workspace_id = $1
         ) SELECT path FROM cte WHERE id = $2;`,
         [workspaceId, fileId]
      );
      if (!pathRes.rows.length) return;

      const filePath = pathRes.rows[0]!.path;
      const wsPath = `/workspaces/${workspaceId}`;
      const fullPath = `${wsPath}/${filePath}`;

      if (filePath.includes('..') || filePath.startsWith('/') || filePath.includes('\0')) {
         throw new Error('Directory traversal block');
      }

      const contentBase64 = Buffer.from(content, 'utf8').toString('base64');
      const dirPath = fullPath.substring(0, fullPath.lastIndexOf('/'));

      const mkdirExec = await container.exec({ Cmd: ['mkdir', '-p', dirPath] });
      await mkdirExec.start({ hijack: true, stdin: false });
      await new Promise(res => setTimeout(res, 50));

      const writeExec = await container.exec({
         Cmd: ['sh', '-c', `base64 -d > "${fullPath.replace(/"/g, '\\"')}"`],
         AttachStdin: true, AttachStdout: true, AttachStderr: true
      });
      const writeStream = await writeExec.start({ hijack: true, stdin: true });
      writeStream.end(contentBase64);

      markFileAsWritten(workspaceId, filePath);

      // INTENT: Automatically trigger `npm install` when `package.json` is modified.
      if (filePath === 'package.json') {
         const existingTimeout = npmInstallTimeouts.get(workspaceId);
         if (existingTimeout) clearTimeout(existingTimeout);
         npmInstallTimeouts.set(workspaceId, setTimeout(async () => {
            try {
               (await container.exec({ Cmd: ['sh', '-c', `cd ${wsPath} && npm install`] }))
                  .start({ Detach: true, hijack: false }).catch(() => {});
            } catch {}
         }, 2000));
      }
   } catch (err: unknown) { 
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[TerminalSync] Sync failed:', msg); 
   }
}

export async function syncDeleteToTerminal(wsId: string, filePath: string): Promise<void> {
   const c = await getContainerForSync(wsId);
   if (c && !filePath.includes('..') && !filePath.includes('\0')) {
      (await c.exec({ Cmd: ['rm', '-rf', `/workspaces/${wsId}/${filePath}`] })).start({ hijack: true, stdin: false }).catch(() => {});
   }
}

export async function syncFolderToTerminal(wsId: string, folderPath: string): Promise<void> {
   const c = await getContainerForSync(wsId);
   if (c && !folderPath.includes('..') && !folderPath.includes('\0')) {
      (await c.exec({ Cmd: ['mkdir', '-p', `/workspaces/${wsId}/${folderPath}`] })).start({ hijack: true, stdin: false }).catch(() => {});
   }
}

// =============================================================================
// DATABASE FILE TREE UTILITIES & MAP BUILDERS
// =============================================================================

async function getWorkspaceFilesMap(workspaceId: string): Promise<WorkspaceFilesMapResult> {
   const res = await getPool().query<{ id: string; parent_id: string | null; name: string; type: 'file' | 'directory'; content: string; path: string }>(
      `WITH RECURSIVE cte AS (
         SELECT id, parent_id, name, type, content, name::text as path FROM files WHERE workspace_id = $1 AND parent_id IS NULL
         UNION ALL
         SELECT f.id, f.parent_id, f.name, f.type, f.content, (cte.path || '/' || f.name)::text FROM files f JOIN cte ON f.parent_id = cte.id WHERE f.workspace_id = $1
      ) SELECT * FROM cte;`,
      [workspaceId]
   );
   const pathToId = new Map<string, string>();
   const idToPath = new Map<string, string>();
   const fileDetails = new Map<string, WorkspaceFileDetail>();
   res.rows.forEach(r => { 
      pathToId.set(r.path, r.id); 
      idToPath.set(r.id, r.path); 
      fileDetails.set(r.path, { id: r.id, type: r.type, content: r.content }); 
   });
   return { pathToId, idToPath, fileDetails };
}

async function dbCreateFile(workspaceId: string, relativePath: string, type: 'file' | 'directory', content = ''): Promise<string | null> {
   const parts = relativePath.split('/');
   const name = parts.pop() || '';
   const parentPath = parts.join('/');
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
      const res = await getPool().query<{ id: string }>(
         `INSERT INTO files (workspace_id, name, type, parent_id, language, content) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
         [workspaceId, name, type, parentId, lang, content]
      );

      if (res.rows[0]?.id && type === 'file') {
         const ydoc = new Y.Doc();
         ydoc.getText('monaco').insert(0, content);
         await getPool().query('UPDATE files SET yjs_state = $1 WHERE id = $2', [Buffer.from(Y.encodeStateAsUpdate(ydoc)), res.rows[0].id]);
         ydoc.destroy();
      }
      return res.rows[0]?.id || null;
   } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr.code === '23505') {
         const existing = await getWorkspaceFilesMap(workspaceId);
         return existing.pathToId.get(relativePath) || null;
      }
      throw err;
   }
}

async function dbRenameFile(workspaceId: string, fileId: string, newRelativePath: string): Promise<void> {
   const parts = newRelativePath.split('/');
   const name = parts.pop() || '';
   const parentPath = parts.join('/');
   let parentId: string | null = null;
   
   if (parentPath) {
      const map = await getWorkspaceFilesMap(workspaceId);
      parentId = map.pathToId.get(parentPath) || null;
      if (!parentId) {
         parentId = await dbCreateFile(workspaceId, parentPath, 'directory', '') || null;
      }
   }
   
   const lang = name.match(/\.(js|ts|tsx|jsx|mjs)$/) ? 'javascript' : name.match(/\.py$/) ? 'python' : name.match(/\.cpp$/) ? 'cpp' : name.match(/\.c$/) ? 'c' : name.match(/\.html$/) ? 'html' : name.match(/\.css$/) ? 'css' : name.match(/\.java$/) ? 'java' : name.match(/\.json$/) ? 'json' : name.match(/\.md$/) ? 'markdown' : 'text';

   await getPool().query('UPDATE files SET name = $1, parent_id = $2, language = $3 WHERE id = $4', [name, parentId, lang, fileId]);
}

async function dbUpdateFileExternal(workspaceId: string, fileId: string, content: string): Promise<void> {
   if (hasActiveYjsDoc(workspaceId, fileId)) return;

   const ydoc = new Y.Doc();
   ydoc.getText('monaco').insert(0, content);
   await getPool().query('UPDATE files SET yjs_state = $1, content = $2 WHERE id = $3', [Buffer.from(Y.encodeStateAsUpdate(ydoc)), content, fileId]);
   ydoc.destroy();
}

async function dbDeleteFile(fileId: string): Promise<void> {
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
         const stdoutW = new Writable({ write(c: Buffer, _, cb) { stdout += c.toString('utf8'); cb(); } });
         const stderrW = new Writable({ write(_, __, cb) { cb(); } });
         container.modem.demuxStream(stream, stdoutW, stderrW);
         stream.on('end', () => {
            try {
               const decoded = Buffer.from(stdout.replace(/\s/g, ''), 'base64').toString('utf8');
               resolve(decoded);
            } catch { 
               resolve(''); 
            }
         });
         stream.on('error', () => resolve(''));
      });
   } catch { 
      return ''; 
   }
}

// =============================================================================
// RECURSIVE FILESYSTEM POLLED WATCHER DAEMON
// =============================================================================

// INTENT: Polling watcher thread tracking file creation, deletion, and inode-matched renames inside container workspace directory.
// WHY: Containerized environments lack reliable `inotify` kernel events across Docker volume mounts.
// INTERVIEW NOTES: By statting Linux `inode` identifiers (`%i`), moving/renaming a file preserves its underlying `fileId` and Yjs CRDT history.
function startTerminalWatcher(ws: WebSocket, container: Docker.Container, workspaceId: string, watcherTimeout: { current: NodeJS.Timeout | null }): void {
   logDebug(`[Watcher] Initializing watcher for workspace: ${workspaceId}`);
   const lastState = new Map<string, TerminalWatcherEntry>();
   let isFirstScan = true;

   const runScan = async (): Promise<void> => {
      if (ws.readyState !== WebSocket.OPEN) {
         logDebug(`[Watcher] WebSocket closed for workspace: ${workspaceId}`);
         return;
      }
      try {
         const wsPath = `/workspaces/${workspaceId}`;
         const pruneArgs = EXCLUDED_DIRS.flatMap(dir => ['-name', dir, '-prune', '-o']);
         
         const findCmd = [
            'find', wsPath, '-mindepth', '1', '-maxdepth', '5',
            ...pruneArgs,
            '-exec', 'stat', '-c', '%Y %s %F %i %n', '{}', ';'
         ];

         const stream = await (await container.exec({ Cmd: findCmd, AttachStdout: true, AttachStderr: true })).start({ hijack: true });
         const rawOutput = await new Promise<string>((res) => {
            let out = '';
            const w = new Writable({ write(c: Buffer, _, cb) { out += c.toString(); cb(); } });
            const errW = new Writable({ write(_, __, cb) { cb(); } });
            container.modem.demuxStream(stream, w, errW);
            stream.on('end', () => res(out));
            stream.on('error', () => res(''));
         });

         const currentFiles = new Map<string, TerminalWatcherEntry>();
         const wsPathPrefix = `${wsPath}/`;

         rawOutput.replace(/\r/g, '').split('\n').forEach(line => {
            const match = line.match(/^(\d+)\s+(\d+)\s+(.*?)\s+(\d+)\s+(\/workspaces\/.*)$/);
            if (match && match[5]?.startsWith(wsPathPrefix)) {
               const relPath = match[5].substring(wsPathPrefix.length).trim();
               if (!relPath || relPath.startsWith('.') || relPath.includes('/.')) return; 
               const size = parseInt(match[2]!, 10);
               const isDir = match[3]!.includes('directory');
               const inode = match[4]!;
               if (!isDir && size > MAX_FILE_SIZE_BYTES) return;
               currentFiles.set(relPath, { path: relPath, mtime: parseInt(match[1]!, 10), size, isDir, inode });
            }
         });

         if (isFirstScan) {
            const { fileDetails } = await getWorkspaceFilesMap(workspaceId);
            fileDetails.forEach((detail, pathKey) => {
               lastState.set(pathKey, {
                  path: pathKey,
                  mtime: currentFiles.get(pathKey)?.mtime || 0,
                  size: currentFiles.get(pathKey)?.size || 0,
                  isDir: detail.type === 'directory',
                  inode: currentFiles.get(pathKey)?.inode || '0'
               });
            });
            for (const [pathKey, entry] of currentFiles) {
               if (!lastState.has(pathKey)) lastState.set(pathKey, entry);
            }
            isFirstScan = false;
            if (ws.readyState === WebSocket.OPEN) watcherTimeout.current = setTimeout(runScan, 1500);
            return;
         }

         let changed = false;
         const { pathToId, fileDetails } = await getWorkspaceFilesMap(workspaceId);

         const deletedPaths = new Set<string>();
         for (const [pathKey] of lastState.entries()) {
            if (!currentFiles.has(pathKey)) deletedPaths.add(pathKey);
         }

         const addedEntries = new Map<string, TerminalWatcherEntry>();
         for (const [pathKey, current] of currentFiles.entries()) {
            if (!lastState.has(pathKey)) addedEntries.set(pathKey, current);
         }

         // INTENT: Inode matching to resolve file renames/moves vs delete + recreate.
         for (const [newPath, current] of addedEntries.entries()) {
            let renameOldPath: string | null = null;
            for (const oldPath of deletedPaths) {
               const last = lastState.get(oldPath);
               if (last && last.inode !== '0' && last.inode === current.inode) {
                  renameOldPath = oldPath;
                  break;
               }
            }

            if (renameOldPath) {
               const fileId = pathToId.get(renameOldPath);
               if (fileId) {
                  logDebug(`[Watcher] Rename detected via inode: ${renameOldPath} -> ${newPath}`);
                  await dbRenameFile(workspaceId, fileId, newPath);
                  changed = true;
                  
                  deletedPaths.delete(renameOldPath);
                  addedEntries.delete(newPath);
                  lastState.delete(renameOldPath);
                  lastState.set(newPath, current);
               }
            }
         }

         for (const pathKey of deletedPaths) {
            const fileId = pathToId.get(pathKey);
            logDebug(`[Watcher] File deletion detected for path: ${pathKey}, ID: ${fileId}`);
            if (fileId) {
               if (!hasActiveYjsDoc(workspaceId, fileId)) {
                  await dbDeleteFile(fileId);
                  logDebug(`[Watcher] Deleted file from DB: ${pathKey}`);
                  changed = true;
               }
            }
            lastState.delete(pathKey);
         }

         const sortedEntries = [...currentFiles.entries()].sort(([aPath, aVal], [bPath, bVal]) => {
            if (aVal.isDir && !bVal.isDir) return -1;
            if (!aVal.isDir && bVal.isDir) return 1;
            return aPath.split('/').length - bPath.split('/').length || aPath.localeCompare(bPath);
         });

         for (const [pathKey, current] of sortedEntries) {
            if (addedEntries.has(pathKey)) {
               logDebug(`[Watcher] Addition detected for path: ${pathKey}`);
               if (fileDetails.has(pathKey)) {
                  lastState.set(pathKey, current);
                  continue;
               }
               // INTENT: Small delay before reading newly-created file content.
               // WHY: Shell write buffers may not have flushed when the watcher first detects
               // the inode (e.g., during rapid `for` loop creation bursts). Without this,
               // readContainerFileContent may return empty or partial content.
               let content = '';
               if (!current.isDir && current.size > 0) {
                  await new Promise(r => setTimeout(r, 300));
                  content = await readContainerFileContent(container, workspaceId, pathKey);
               }
               const newId = await dbCreateFile(workspaceId, pathKey, current.isDir ? 'directory' : 'file', content);
               if (newId) {
                  logDebug(`[Watcher] Created new file/directory in DB with ID: ${newId} for path: ${pathKey}`);
                  lastState.set(pathKey, current);
                  changed = true;
               }
            } else {
               const last = lastState.get(pathKey);
               if (last && !current.isDir && (current.mtime !== last.mtime || current.size !== last.size)) {
                  const fileId = pathToId.get(pathKey);
                  logDebug(`[Watcher] Modification detected for file path: ${pathKey}, ID: ${fileId}`);
                  if (!fileId) { lastState.set(pathKey, current); continue; }
        
                  if (hasActiveYjsDoc(workspaceId, fileId)) {
                     lastState.set(pathKey, current); 
                     continue;
                  }
        
                  if (isInWriteCooldown(workspaceId, pathKey)) {
                     lastState.set(pathKey, current);
                     continue;
                  }
        
                  const content = current.size > 0 ? await readContainerFileContent(container, workspaceId, pathKey) : '';
                  if (fileDetails.get(pathKey)?.content !== content) {
                     await dbUpdateFileExternal(workspaceId, fileId, content);
                     logDebug(`[Watcher] Updated file content in DB for modified path: ${pathKey}`);
                     changed = true;
                  }
                  lastState.set(pathKey, current);
               }
            }
         }

         if (changed) {
            try {
               const { workspaceTreeCache } = await import('../utils/redisCache.js');
               await workspaceTreeCache.delete(workspaceId);
            } catch {}
            logDebug(`[Watcher] File tree changed, emitting file-tree-update event for room: presence-${workspaceId}`);
            getIO()?.to(`presence-${workspaceId}`).emit('file-tree-update');
            getIO()?.to(workspaceId).emit('file-tree-update');
            getIO()?.to(`presence-${workspaceId}`).emit('tree-updated');
            getIO()?.to(workspaceId).emit('tree-updated');
         }
      } catch (err: unknown) {
         const msg = err instanceof Error ? err.message : String(err);
         logDebug(`[Watcher] Scan error: ${msg}`);
      }

      if (ws.readyState === WebSocket.OPEN) watcherTimeout.current = setTimeout(runScan, 1500);
   };

   watcherTimeout.current = setTimeout(runScan, 1500);
}