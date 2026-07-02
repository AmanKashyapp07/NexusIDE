import { IncomingMessage } from 'http';
import { WebSocket } from 'ws';
import { getPool } from '../db';
import jwt from 'jsonwebtoken';
import Docker from 'dockerode';
import { Writable } from 'stream';
import * as Y from 'yjs';
import { getIO } from '../server';
// @ts-ignore
import { docs } from 'y-websocket/bin/utils';
import { getOrCreateWorkspaceContainer, releaseWorkspaceContainer } from '../sandbox/workspaceContainer';

// ---------------------------------------------------------------------------
// TERMINAL WEBSOCKET HANDLER (Stateless, KISS)
// ---------------------------------------------------------------------------

type TerminalRole = 'viewer' | 'editor' | 'admin';

export async function handleTerminalConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
  let stream: any = null;
  let container: Docker.Container | null = null;
  let userId = '';
  let workspaceId = '';

  try {
    // --- Parse URL ---
    const parsedUrl = new URL(req.url || '', 'http://' + (req.headers.host || 'localhost'));
    const pathParts = parsedUrl.pathname.split('/').filter(Boolean);

    if (pathParts.length < 2 || pathParts[0] !== 'terminal') {
      ws.close(4000, 'Bad Request');
      return;
    }

    workspaceId = pathParts[1] as string;
    const token = parsedUrl.searchParams.get('token');

    if (!token) {
      ws.close(4401, 'Unauthorized: Token required');
      return;
    }

    // --- Verify JWT ---
    let decodedUser: any;
    try {
      decodedUser = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
    } catch {
      ws.close(4401, 'Unauthorized: Invalid token');
      return;
    }

    userId = typeof decodedUser.id === 'string' ? decodedUser.id : String(decodedUser.id || '');
    if (!userId) {
      ws.close(4401, 'Unauthorized: Invalid token payload');
      return;
    }

    // --- Check workspace access ---
    const wsResult = await getPool().query(
      'SELECT owner_id, is_public FROM workspaces WHERE id = $1',
      [workspaceId]
    );
    if (wsResult.rows.length === 0) {
      ws.close(4404, 'Workspace not found');
      return;
    }

    const workspace = wsResult.rows[0];
    let userRole: TerminalRole | null = null;

    if (workspace.owner_id === userId) {
      userRole = 'admin';
    } else {
      const collabResult = await getPool().query(
        'SELECT role FROM workspace_collaborators WHERE workspace_id = $1 AND user_id = $2',
        [workspaceId, userId]
      );
      if (collabResult.rows.length > 0) {
        userRole = collabResult.rows[0].role;
      } else if (workspace.is_public) {
        userRole = 'viewer';
      }
    }

    if (!userRole) {
      ws.close(4403, 'Forbidden: No access');
      return;
    }

    let githubToken = '';
    let githubUsername = '';
    let githubEmail = '';

    if (userRole === 'admin') {
      const userRes = await getPool().query('SELECT github_token, username, email FROM users WHERE id = $1', [userId]);
      if (userRes.rows.length > 0) {
        githubToken = userRes.rows[0].github_token || '';
        githubUsername = userRes.rows[0].username || '';
        githubEmail = userRes.rows[0].email || '';
      }
    }

    // --- Get container (creates + hydrates workspace files) ---
    container = await getOrCreateWorkspaceContainer(userId, workspaceId);

    // --- Spawn bash shell ---
    const isViewer = userRole === 'viewer';
    let shellCmd = isViewer ? ['/bin/bash', '--restricted'] : ['/bin/bash'];

    // PS1 uses bash prompt escapes. In TS, each \\ becomes one \ at runtime.
    // Bash interprets: \u=username, \w=workdir, \$=$ or #
    // \[\033[...m\] wraps ANSI color codes so readline counts line length correctly.
    const ps1 = '\\[\\033[1;35m\\]\\u@sandbox\\[\\033[0m\\]:\\[\\033[1;34m\\]\\w\\[\\033[1;32m\\]\\$\\[\\033[0m\\] ';

    const envVars = [
      'PS1=' + ps1,
      'TERM=xterm-256color',   // Tells programs the terminal supports 256 colors
      'LANG=C.UTF-8',         // UTF-8 support
      'HOME=/tmp',            // Fix for read-only rootfs: redirect ~ to tmpfs
    ];
    if (isViewer) {
      envVars.push('PATH=/viewer_bin');
    }

    if (userRole === 'admin' && githubToken) {
      envVars.push(
        `GITHUB_TOKEN=${githubToken}`,
        `GIT_AUTHOR_NAME=${githubUsername}`,
        `GIT_AUTHOR_EMAIL=${githubEmail}`,
        `GIT_COMMITTER_NAME=${githubUsername}`,
        `GIT_COMMITTER_EMAIL=${githubEmail}`,
        `GIT_ASKPASS=/tmp/git-askpass`,
      );

      // Write two tiny helper scripts to /tmp using base64 to avoid all shell-escaping issues.
      // 1) /tmp/git-askpass — prints the token for HTTPS auth (used by GIT_ASKPASS env)
      // 2) /tmp/git — wrapper that allows clone, commit, push, add, status, log, and diff
      const askpass = [
        '#!/bin/sh',
        'case "$1" in',
        '  *Username*|*username*) echo "git" ;;',
        '  *) echo "$GITHUB_TOKEN" ;;',
        'esac',
      ].join('\n');
      const wrapper = [
        '#!/bin/sh',
        'case "$1" in',
        '  clone) ',
        '    /usr/bin/git "$@" ;;',
        '  commit|push|add|status|log|diff)',
        '    if [ ! -d .git ]; then echo "Error: Not a git repository."; exit 1; fi',
        '    /usr/bin/git "$@" ;;',
        '  *) ',
        '    echo "Only git clone, commit, push, add, status, log, and diff are allowed." ; exit 1 ;;',
        'esac',
      ].join('\n');

      const askpassB64 = Buffer.from(askpass).toString('base64');
      const wrapperB64 = Buffer.from(wrapper).toString('base64');

      try {
        const setupExec = await container.exec({
          Cmd: ['sh', '-c',
            `echo "${askpassB64}" | base64 -d > /tmp/git-askpass && chmod +x /tmp/git-askpass && ` +
            `echo "${wrapperB64}" | base64 -d > /tmp/git && chmod +x /tmp/git`
          ],
        });
        await setupExec.start({ hijack: true, stdin: false });
        await new Promise(resolve => setTimeout(resolve, 200));

        // Prepend /tmp to PATH so our "git" wrapper shadows /usr/bin/git
        envVars.push('PATH=/tmp:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin');
      } catch (err: any) {
        console.error('[Terminal] Git wrapper setup failed (non-fatal):', err.message);
      }
    }

    const exec = await container.exec({
      Cmd: shellCmd,
      Tty: true,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: '/app',
      Env: envVars,
    });

    stream = await exec.start({ hijack: true, stdin: true, Tty: true });

    // --- Start file watcher ---
    const watcherTimeout = { current: null as NodeJS.Timeout | null };
    startTerminalWatcher(ws, container, workspaceId, watcherTimeout);

    // --- Pipe: Docker -> Browser ---
    stream.on('data', (chunk: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(chunk);
      }
    });

    // --- Pipe: Browser -> Docker ---
    ws.on('message', (data: any) => {
      if (stream && !stream.destroyed && stream.writable) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
        stream.write(buf);
      }
    });

    // --- Stream ended (shell exited) ---
    stream.on('end', () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'Shell ended');
      }
    });

    stream.on('error', (err: Error) => {
      console.error('[Terminal] Stream error:', err.message);
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1011, 'Stream error');
      }
    });

    // --- WebSocket closed (user left) ---
    ws.on('close', async () => {
      if (watcherTimeout.current) {
        clearTimeout(watcherTimeout.current);
      }
      if (stream && !stream.destroyed) {
        try { stream.end(); } catch {}
        try { stream.destroy(); } catch {}
      }
      if (container) {
        await releaseWorkspaceContainer(userId, workspaceId).catch(() => {});
      }
    });

    ws.on('error', () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    });

    console.log('[Terminal] Connected for workspace:', workspaceId);

  } catch (err: any) {
    console.error('[Terminal] Setup error:', err.message || err);
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      const errMsg = (err.message || '').toLowerCase();
      const isDockerError = errMsg.includes('docker') || errMsg.includes('connect') || errMsg.includes('enoent') || errMsg.includes('econnrefused');
      if (isDockerError) {
        ws.close(4500, 'Docker daemon is not running on the host system.');
      } else {
        ws.close(1011, 'Internal server error');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// FILE SYNC HELPERS (editor -> container)
// ---------------------------------------------------------------------------

async function getContainerForSync(workspaceId: string): Promise<Docker.Container | null> {
  try {
    const wsResult = await getPool().query(
      'SELECT owner_id FROM workspaces WHERE id = $1',
      [workspaceId]
    );
    if (wsResult.rows.length === 0) return null;
    return await getOrCreateWorkspaceContainer(wsResult.rows[0].owner_id, workspaceId);
  } catch {
    return null;
  }
}

export async function syncFileToTerminal(workspaceId: string, fileId: string, content: string): Promise<void> {
  try {
    const container = await getContainerForSync(workspaceId);
    if (!container) return;

    const pathResult = await getPool().query(
      `WITH RECURSIVE file_path_cte AS (
        SELECT id, parent_id, name, name::text as path
        FROM files 
        WHERE workspace_id = $1 AND parent_id IS NULL
        UNION ALL
        SELECT f.id, f.parent_id, f.name, (cte.path || '/' || f.name)::text as path
        FROM files f
        INNER JOIN file_path_cte cte ON f.parent_id = cte.id
        WHERE f.workspace_id = $1
      )
      SELECT path FROM file_path_cte WHERE id = $2;`,
      [workspaceId, fileId]
    );

    if (pathResult.rows.length === 0) return;

    const filePath = pathResult.rows[0].path;
    const exec = await container.exec({
      Cmd: ['sh', '-c', `mkdir -p "$(dirname "/app/${filePath}")" && cat > "/app/${filePath}"`],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
    });

    const writeStream = await exec.start({ hijack: true, stdin: true });
    writeStream.end(content);
  } catch (err: any) {
    console.error('[TerminalSync] Failed to sync file:', err.message);
  }
}

export async function syncDeleteToTerminal(workspaceId: string, filePath: string): Promise<void> {
  try {
    const container = await getContainerForSync(workspaceId);
    if (!container) return;

    const exec = await container.exec({ Cmd: ['rm', '-rf', `/app/${filePath}`] });
    await exec.start({ hijack: true, stdin: false });
  } catch (err: any) {
    console.error('[TerminalSync] Failed to sync delete:', err.message);
  }
}

export async function syncFolderToTerminal(workspaceId: string, folderPath: string): Promise<void> {
  try {
    const container = await getContainerForSync(workspaceId);
    if (!container) return;

    const exec = await container.exec({ Cmd: ['mkdir', '-p', `/app/${folderPath}`] });
    await exec.start({ hijack: true, stdin: false });
  } catch (err: any) {
    console.error('[TerminalSync] Failed to sync folder:', err.message);
  }
}

// ---------------------------------------------------------------------------
// REVERSE SYNC: container -> database & Yjs
// ---------------------------------------------------------------------------

async function getWorkspaceFilesMap(workspaceId: string) {
  const res = await getPool().query(
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

  const pathToId = new Map<string, string>();
  const idToPath = new Map<string, string>();
  const fileDetails = new Map<string, { id: string; type: 'file' | 'directory'; content: string | null }>();

  for (const row of res.rows) {
    pathToId.set(row.path, row.id);
    idToPath.set(row.id, row.path);
    fileDetails.set(row.path, { id: row.id, type: row.type, content: row.content });
  }

  return { pathToId, idToPath, fileDetails };
}

async function dbCreateFile(workspaceId: string, relativePath: string, type: 'file' | 'directory', content: string = '') {
  const parts = relativePath.split('/');
  const name = parts[parts.length - 1] || '';
  const parentPath = parts.slice(0, -1).join('/');

  let parentId: string | null = null;
  if (parentPath) {
    const { pathToId } = await getWorkspaceFilesMap(workspaceId);
    parentId = pathToId.get(parentPath) || null;
  }

  let language = null;
  if (type === 'file') {
    if (name.endsWith('.js') || name.endsWith('.ts') || name.endsWith('.mjs')) language = 'javascript';
    else if (name.endsWith('.py')) language = 'python';
    else if (name.endsWith('.cpp')) language = 'cpp';
    else if (name.endsWith('.c')) language = 'c';
    else if (name.endsWith('.html')) language = 'html';
    else if (name.endsWith('.css')) language = 'css';
    else if (name.endsWith('.java')) language = 'java';
    else language = 'text';
  }

  const res = await getPool().query(
    `INSERT INTO files (workspace_id, name, type, parent_id, language, content) 
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [workspaceId, name, type, parentId, language, content]
  );
  const fileId = res.rows[0]?.id;

  if (fileId && type === 'file') {
    const ydoc = new Y.Doc();
    ydoc.getText('monaco').insert(0, content);
    const state = Y.encodeStateAsUpdate(ydoc);
    await getPool().query(
      'UPDATE files SET yjs_state = $1 WHERE id = $2',
      [Buffer.from(state), fileId]
    );
  }

  return fileId;
}

async function dbUpdateFile(workspaceId: string, fileId: string, content: string) {
  const ydoc = new Y.Doc();
  ydoc.getText('monaco').insert(0, content);
  const state = Y.encodeStateAsUpdate(ydoc);

  await getPool().query(
    'UPDATE files SET yjs_state = $1, content = $2 WHERE id = $3',
    [Buffer.from(state), content, fileId]
  );

  const docName = `${workspaceId}-${fileId}`;
  const sharedDoc = docs.get(docName);
  if (sharedDoc) {
    const text = sharedDoc.getText('monaco');
    if (text.toString() !== content) {
      sharedDoc.transact(() => {
        text.delete(0, text.length);
        text.insert(0, content);
      });
    }
  }
}

async function dbDeleteFile(fileId: string) {
  await getPool().query('DELETE FROM files WHERE id = $1', [fileId]);
}

async function readContainerFileContent(container: Docker.Container, relativePath: string): Promise<string> {
  try {
    const exec = await container.exec({
      Cmd: ['cat', `/app/${relativePath}`],
      AttachStdout: true,
      AttachStderr: false,
    });
    const stream = await exec.start({ hijack: true });

    return new Promise<string>((resolve, reject) => {
      let output = '';
      const writable = new Writable({
        write(chunk, _encoding, callback) {
          output += chunk.toString('utf8');
          callback();
        },
      });

      container.modem.demuxStream(stream, writable, writable);
      stream.on('end', () => resolve(output));
      stream.on('error', (err: Error) => reject(err));
    });
  } catch {
    return '';
  }
}

interface ContainerFileState {
  path: string;
  mtime: number;
  size: number;
  isDir: boolean;
}

// ---------------------------------------------------------------------------
// TERMINAL FILE WATCHER
// ---------------------------------------------------------------------------
function startTerminalWatcher(
  ws: WebSocket,
  container: Docker.Container,
  workspaceId: string,
  watcherTimeout: { current: NodeJS.Timeout | null }
) {
  let lastState = new Map<string, ContainerFileState>();
  let isFirstScan = true;
  const SCAN_INTERVAL = 1500;

  const runScan = async () => {
    if (ws.readyState !== WebSocket.OPEN) return;

    try {
      const exec = await container.exec({
        Cmd: ['find', '/app', '-mindepth', '1', '-maxdepth', '5', '-exec', 'stat', '-c', '%Y %s %F %n', '{}', ';'],
        AttachStdout: true,
        AttachStderr: false,
      });
      const stream = await exec.start({ hijack: true });

      const rawOutput = await new Promise<string>((resolve) => {
        let output = '';
        const writable = new Writable({
          write(chunk, _encoding, callback) {
            output += chunk.toString('utf8');
            callback();
          },
        });
        container.modem.demuxStream(stream, writable, writable);
        stream.on('end', () => resolve(output));
        stream.on('error', () => resolve(''));
      });

      const rawOutputClean = rawOutput.replace(/\r/g, '');
      const currentFiles = new Map<string, ContainerFileState>();
      const lines = rawOutputClean.split('\n');
      for (const line of lines) {
        const match = line.match(/^(\d+)\s+(\d+)\s+(.*?)\s+\/app\/(.*)$/);
        if (!match) continue;
        const mtime = parseInt(match[1] as string, 10);
        const size = parseInt(match[2] as string, 10);
        const typeStr = match[3] as string;
        const relPath = (match[4] as string).trim();
        if (!relPath) continue;
        // Ignore hidden files and directories (dotfiles) from syncing to the database
        if (relPath.startsWith('.') || relPath.includes('/.')) continue;
        const isDir = typeStr.includes('directory');
        currentFiles.set(relPath, { path: relPath, mtime, size, isDir });
      }

      if (isFirstScan) {
        const { fileDetails } = await getWorkspaceFilesMap(workspaceId);
        for (const [path, detail] of fileDetails.entries()) {
          const current = currentFiles.get(path);
          lastState.set(path, {
            path,
            mtime: current ? current.mtime : 0,
            size: current ? current.size : 0,
            isDir: detail.type === 'directory',
          });
        }
        isFirstScan = false;
      }

      let changed = false;
      const { pathToId, fileDetails } = await getWorkspaceFilesMap(workspaceId);

      // Deletions
      for (const [path] of lastState.entries()) {
        if (!currentFiles.has(path)) {
          const fileId = pathToId.get(path);
          if (fileId) {
            await dbDeleteFile(fileId);
            changed = true;
          }
          lastState.delete(path);
        }
      }

      // Additions / Modifications
      for (const [path, current] of currentFiles.entries()) {
        try {
          const last = lastState.get(path);

          if (!last) {
            const dbDetail = fileDetails.get(path);
            if (dbDetail) {
              lastState.set(path, current);
              continue;
            }

            let content = '';
            if (!current.isDir && current.size > 0) {
              content = await readContainerFileContent(container, path);
            }
            const newId = await dbCreateFile(workspaceId, path, current.isDir ? 'directory' : 'file', content);
            if (newId) {
              lastState.set(path, current);
              changed = true;
            }
          } else {
            if (!current.isDir && (current.mtime !== last.mtime || current.size !== last.size)) {
              let content = '';
              if (current.size > 0) {
                content = await readContainerFileContent(container, path);
              }
              const dbDetail = fileDetails.get(path);
              if (dbDetail && dbDetail.content !== content) {
                await dbUpdateFile(workspaceId, dbDetail.id, content);
                changed = true;
              }
              lastState.set(path, current);
            }
          }
        } catch (fileErr: any) {
          console.error(`[TerminalSync] Error syncing file ${path}:`, fileErr.message);
        }
      }

      if (changed) {
        const io = getIO();
        if (io) {
          io.to(`presence-${workspaceId}`).emit('file-tree-update');
        }
      }
    } catch (err: any) {
      console.error('[TerminalSync] Watcher global error:', err.message);
    }

    if (ws.readyState === WebSocket.OPEN) {
      watcherTimeout.current = setTimeout(runScan, SCAN_INTERVAL);
    }
  };

  watcherTimeout.current = setTimeout(runScan, SCAN_INTERVAL);
}
