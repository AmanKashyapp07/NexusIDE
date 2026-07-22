import { IncomingMessage } from 'http';
import { WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { getPool } from '../db';
import { getOrCreateWorkspaceContainer, releaseWorkspaceContainer } from '../sandbox/workspaceContainer';

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Purpose: Upgrades WebSockets and proxies JSON-RPC signals between the Monaco editor and the container language server process.
 * Under the Hood:
 *   1. Implements a 15-minute idle timeout that triggers socket closures to scale down containers.
 *   2. Authenticates connections statefully using JWT decoding and DB collaborator checks.
 *   3. Blocks viewer roles from spawning LSP servers to prevent resource exhaustion.
 *   4. Synchronously queues early messages in an array until Docker exec starts, flushing them once active.
 *   5. Parses Docker's 8-byte frame header, extracting the payload stream source (1 = stdout) and forwarding clean updates.
 * Design Decisions: Buffering client messages resolves the startup lag between WS connections and container startups.
 * Complexity: Time Complexity: Message routing and slice buffers O(N) where N is bytes length, Space Complexity: O(P).
 * Security & Failure Cases: Uses try-catch blocks and finalizers to clean up exec streams and container counts on socket closes.
 */
export async function handleLspConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
  let containerReleased = false, execStream: any = null, execStreamReady = false;
  let userId = '', workspaceId = '';
  const messageQueue: Buffer[] = [];

  let idleTimeout = setTimeout(() => ws.close(1000, 'Idle Timeout'), IDLE_TIMEOUT_MS);
  const resetIdleTimeout = () => { 
    clearTimeout(idleTimeout); 
    idleTimeout = setTimeout(() => ws.close(1000, 'Idle'), IDLE_TIMEOUT_MS); 
  };

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
    if (execStream) { 
      try { execStream.end(); execStream.destroy?.(); } catch {} 
    }
    if (userId && workspaceId) {
      await releaseWorkspaceContainer(userId, workspaceId).catch(() => {});
    }
  };

  try {
    const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    const parts = url.pathname.split('/').filter(Boolean);
    const lspIdx = parts.indexOf('lsp');
    const workspaceId = lspIdx !== -1 ? parts[lspIdx + 1] || '' : '';
    const lang = lspIdx !== -1 ? parts[lspIdx + 2] || '' : '';
    const token = url.searchParams.get('token');

    if (!workspaceId || !lang || !token) {
      console.warn('[LSP Close]: Missing params. workspaceId:', workspaceId, 'lang:', lang, 'token:', !!token);
      return ws.close(4000, 'Bad Request');
    }

    let decodedUser: any;
    try { 
      decodedUser = jwt.verify(token, process.env.JWT_SECRET || 'fallback'); 
    } catch (e: any) { 
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

    if (!userRole || userRole === 'viewer') {
      console.warn('[LSP Close]: User not authorized. Role:', userRole);
      return ws.close(4403, 'Editor required for LSP');
    }

    const cmd = lang === 'python' ? ['pyright-langserver', '--stdio'] 
              : ['javascript', 'typescript'].includes(lang) 
              ? ['typescript-language-server', '--stdio'] 
              : null;
    if (!cmd) {
      console.warn('[LSP Close]: Unsupported LSP language:', lang);
      return ws.close(4000, `Unsupported LSP: ${lang}`);
    }

    const container = await getOrCreateWorkspaceContainer(userId, workspaceId);
    const exec = await container.exec({ Cmd: cmd, AttachStdin: true, AttachStdout: true, AttachStderr: true, Tty: false, WorkingDir: '/app' });
    execStream = await exec.start({ hijack: true, stdin: true });

    execStreamReady = true;
    while (messageQueue.length > 0) {
      const data = messageQueue.shift();
      if (data && execStream && !execStream.destroyed && execStream.writable) execStream.write(data);
    }

    let frameBuffer = Buffer.alloc(0);
    execStream.on('data', (chunk: Buffer) => {
      frameBuffer = Buffer.concat([frameBuffer, chunk]);
      while (frameBuffer.length >= 8) {
        const streamType = frameBuffer[0];
        const payloadSize = frameBuffer.readUInt32BE(4);
        if (frameBuffer.length < 8 + payloadSize) break;
        
        const payload = frameBuffer.slice(8, 8 + payloadSize);
        if (streamType === 1) {
          if (ws.readyState === WebSocket.OPEN) ws.send(payload);
        } else if (streamType === 2) {
          console.warn('[LSP Stderr]:', payload.toString('utf8').trim());
        }
        
        frameBuffer = frameBuffer.slice(8 + payloadSize);
      }
    });

    execStream.on('end', () => ws.readyState === WebSocket.OPEN && ws.close(1000, 'LSP Stream Closed'));
    execStream.on('error', () => ws.readyState === WebSocket.OPEN && ws.close(1011, 'LSP Internal Error'));

    ws.on('close', async () => { 
      clearTimeout(idleTimeout); 
      await cleanup(); 
    });
    ws.on('error', async () => { 
      clearTimeout(idleTimeout); 
      await cleanup(); 
    });

  } catch (err: any) {
    console.error('[LSP Connection Error]:', err);
    if (ws.readyState === WebSocket.OPEN) ws.close(1011, 'Server Error');
    await cleanup();
  }
}