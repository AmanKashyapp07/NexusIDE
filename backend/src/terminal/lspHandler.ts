import { IncomingMessage } from 'http';
import { WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { getPool } from '../db';
import { getOrCreateWorkspaceContainer, releaseWorkspaceContainer } from '../sandbox/workspaceContainer';

const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

// =============================================================================
// [I/O MULTIPLEXING] Language Server Protocol (LSP) WebSocket Handler
// =============================================================================
// INTERVIEW KEY: This bridges standard JSON-RPC messages between the browser's Monaco Editor 
// and a language server (Pyright/TSServer) running inside an isolated Docker container.
export async function handleLspConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
  let containerReleased = false, execStream: any = null, execStreamReady = false;
  let userId = '', workspaceId = '';
  const messageQueue: Buffer[] = [];

  // [RESOURCE LIFECYCLE] Idle Timeout
  // Language servers are heavy (often 100MB+ RAM). We strictly terminate idle sessions 
  // after 15 minutes to allow `releaseWorkspaceContainer` to scale down the Docker pool.
  let idleTimeout = setTimeout(() => ws.close(1000, 'Idle Timeout'), IDLE_TIMEOUT_MS);
  const resetIdleTimeout = () => { clearTimeout(idleTimeout); idleTimeout = setTimeout(() => ws.close(1000, 'Idle'), IDLE_TIMEOUT_MS); };

  // [CONCURRENCY] Early Message Buffering
  // INTERVIEW KEY: The WebSocket handshakes instantly, but Docker `exec.start()` takes ~100ms. 
  // If the client sends the LSP "initialize" packet immediately, it drops. 
  // We synchronously queue incoming packets in memory and flush them once the bash stream connects.
  ws.on('message', (msg: any) => {
    resetIdleTimeout();
    const data = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
    (execStreamReady && execStream && !execStream.destroyed && execStream.writable) 
      ? execStream.write(data) 
      : messageQueue.push(data);
  });

  const cleanup = async () => {
    if (containerReleased) return;
    containerReleased = true;
    if (execStream) { try { execStream.end(); execStream.destroy?.(); } catch {} }
    if (userId && workspaceId) await releaseWorkspaceContainer(userId, workspaceId).catch(() => {});
  };

  try {
    const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    const [_, __, wsId, lang] = url.pathname.split('/').filter(Boolean);
    workspaceId = wsId || '';
    const token = url.searchParams.get('token');

    if (!workspaceId || !lang || !token) {
      console.warn('[LSP Close]: Missing params. workspaceId:', workspaceId, 'lang:', lang, 'token:', !!token);
      return ws.close(4000, 'Bad Request');
    }

    // [SECURITY] Lazy Environment Evaluation
    // `JWT_SECRET` is read lazily here. If read at the module scope, ESM static imports hoist it 
    // before `server.ts` calls `dotenv.config()`, resulting in undefined secrets and broken auth.
    let decodedUser: any;
    try { decodedUser = jwt.verify(token, process.env.JWT_SECRET || 'fallback'); } 
    catch (e: any) { 
      console.warn('[LSP Close]: JWT verification failed:', e.message);
      return ws.close(4401, 'Invalid token'); 
    }
    
    userId = String(decodedUser?.id || '');
    if (!userId) {
      console.warn('[LSP Close]: No userId in token');
      return ws.close(4401, 'Invalid payload');
    }

    const wsResult = await getPool().query('SELECT owner_id, is_public FROM workspaces WHERE id = $1', [workspaceId]);
    if (!wsResult.rows.length) {
      console.warn('[LSP Close]: Workspace not found in DB:', workspaceId);
      return ws.close(4404, 'Not found');
    }
    
    let userRole = wsResult.rows[0].owner_id === userId ? 'admin' : null;
    if (!userRole) {
      const collabRes = await getPool().query('SELECT role FROM workspace_collaborators WHERE workspace_id = $1 AND user_id = $2', [workspaceId, userId]);
      userRole = collabRes.rows.length ? collabRes.rows[0].role : (wsResult.rows[0].is_public ? 'viewer' : null);
    }

    // [SECURITY] RBAC Resource Protection
    // Only Editors/Admins can spawn Language Servers. Viewers are blocked to prevent 
    // read-only visitors from consuming heavy CPU/RAM resources on the host server.
    if (!userRole || userRole === 'viewer') {
      console.warn('[LSP Close]: User not authorized. Role:', userRole);
      return ws.close(4403, 'Editor required for LSP');
    }

    const cmd = lang === 'python' ? ['pyright-langserver', '--stdio'] 
              : ['javascript', 'typescript'].includes(lang) ? ['typescript-language-server', '--stdio'] : null;
    if (!cmd) {
      console.warn('[LSP Close]: Unsupported LSP language:', lang);
      return ws.close(4000, `Unsupported LSP: ${lang}`);
    }

    const container = await getOrCreateWorkspaceContainer(userId, workspaceId);
    const exec = await container.exec({ Cmd: cmd, AttachStdin: true, AttachStdout: true, AttachStderr: true, Tty: false, WorkingDir: '/app' });
    execStream = await exec.start({ hijack: true, stdin: true });

    // Flush buffered messages
    execStreamReady = true;
    while (messageQueue.length > 0) {
      const data = messageQueue.shift();
      if (data && execStream && !execStream.destroyed && execStream.writable) execStream.write(data);
    }

    // [MEMORY MANAGEMENT] Docker Protocol Demultiplexing
    // INTERVIEW KEY: Because `Tty: false` is set, Docker wraps stdout/stderr in 8-byte headers.
    // We buffer raw chunks, slice out the 8-byte header to determine the stream type (1=stdout, 2=stderr),
    // and extract exactly `payloadSize` bytes. This prevents JSON-RPC packets from being corrupted by Docker metadata.
    let frameBuffer = Buffer.alloc(0);
    execStream.on('data', (chunk: Buffer) => {
      frameBuffer = Buffer.concat([frameBuffer, chunk]);
      while (frameBuffer.length >= 8) {
        const streamType = frameBuffer[0];
        const payloadSize = frameBuffer.readUInt32BE(4);
        if (frameBuffer.length < 8 + payloadSize) break; // Wait for full packet to arrive
        
        const payload = frameBuffer.slice(8, 8 + payloadSize);
        if (streamType === 1) ws.readyState === WebSocket.OPEN && ws.send(payload);
        else if (streamType === 2) console.warn('[LSP Stderr]:', payload.toString('utf8').trim());
        
        frameBuffer = frameBuffer.slice(8 + payloadSize);
      }
    });

    execStream.on('end', () => ws.readyState === WebSocket.OPEN && ws.close(1000, 'LSP Stream Closed'));
    execStream.on('error', () => ws.readyState === WebSocket.OPEN && ws.close(1011, 'LSP Internal Error'));

    ws.on('close', async () => { clearTimeout(idleTimeout); await cleanup(); });
    ws.on('error', async () => { clearTimeout(idleTimeout); await cleanup(); });

  } catch (err: any) {
    console.error('[LSP Connection Error]:', err);
    if (ws.readyState === WebSocket.OPEN) ws.close(1011, 'Server Error');
    await cleanup();
  }
}