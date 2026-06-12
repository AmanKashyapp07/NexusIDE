import { IncomingMessage } from 'http';
import { WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { getPool } from '../db';
import { getOrCreateWorkspaceContainer, releaseWorkspaceContainer } from '../sandbox/workspaceContainer';

// NOTE: Do NOT read JWT_SECRET at module level — ESM static imports are hoisted
// and evaluated before dotenv.config() runs in server.ts. Read it lazily inside
// the handler so process.env is fully populated at call time.
const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

type TerminalRole = 'viewer' | 'editor' | 'admin';

export async function handleLspConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
  let containerReleased = false;
  let execStream: any = null;
  let userId = '';
  let workspaceId = '';
  let execStreamReady = false;
  const messageQueue: Buffer[] = [];

  // Set up idle timeout timer
  let idleTimeout = setTimeout(() => {
    console.log(`[LSP] Session idle for 15m. Closing socket.`);
    ws.close(1000, 'LSP Session Idle Timeout');
  }, IDLE_TIMEOUT_MS);

  const resetIdleTimeout = () => {
    clearTimeout(idleTimeout);
    idleTimeout = setTimeout(() => {
      console.log(`[LSP] Session idle for 15m. Closing socket.`);
      ws.close(1000, 'LSP Session Idle Timeout');
    }, IDLE_TIMEOUT_MS);
  };

  // Immediately register message listener to avoid race conditions and lost messages
  // while container setup and exec startup are running asynchronously.
  ws.on('message', (messageData: any) => {
    resetIdleTimeout();
    const data = Buffer.isBuffer(messageData) ? messageData : Buffer.from(messageData);
    if (execStreamReady && execStream && !execStream.destroyed && execStream.writable) {
      execStream.write(data);
    } else {
      messageQueue.push(data);
    }
  });

  const cleanup = async () => {
    if (containerReleased) return;
    containerReleased = true;

    console.log(`[LSP] Tearing down connection for user ${userId} in workspace ${workspaceId}`);
    if (execStream) {
      try {
        execStream.end();
        execStream.destroy?.();
      } catch (err) {
        // ignore
      }
    }
    if (userId && workspaceId) {
      await releaseWorkspaceContainer(userId, workspaceId);
    }
  };

  try {
    // 1. Parse URL parameters
    const parsedUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
    
    // Path shape: /ws/lsp/:workspaceId/:language
    if (pathParts.length < 4 || pathParts[0] !== 'ws' || pathParts[1] !== 'lsp') {
      ws.close(4000, 'Bad Request: Expected /ws/lsp/<workspaceId>/<language>');
      return;
    }

    workspaceId = pathParts[2] as string;
    const language = pathParts[3] as string;
    const token = parsedUrl.searchParams.get('token');

    if (!token) {
      ws.close(4401, 'Unauthorized: Token required');
      return;
    }

    // 2. Verify Token
    // Read JWT_SECRET lazily here (not at module level) so dotenv.config() in
    // server.ts has already populated process.env before this line runs.
    const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';
    let decodedUser: any;
    try {
      decodedUser = jwt.verify(token, JWT_SECRET);
    } catch (e: any) {
      console.error('[LSP] JWT verify failed:', (e as Error).message, '| secret prefix:', JWT_SECRET.slice(0, 4));
      ws.close(4401, 'Unauthorized: Invalid token');
      return;
    }

    userId = typeof decodedUser.id === 'string' ? decodedUser.id : String(decodedUser.id || '');
    if (!userId) {
      ws.close(4401, 'Unauthorized: Invalid token payload');
      return;
    }

    // 3. Verify access permissions
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
        userRole = collabResult.rows[0].role as TerminalRole;
      } else if (workspace.is_public) {
        userRole = 'viewer';
      }
    }

    if (!userRole || userRole === 'viewer') {
      ws.close(4403, 'Forbidden: Editor role required for LSP access');
      return;
    }

    // Determine target LSP command
    let cmd: string[] = [];
    if (language === 'python') {
      cmd = ['pyright-langserver', '--stdio'];
    } else if (language === 'javascript' || language === 'typescript') {
      cmd = ['typescript-language-server', '--stdio'];
    } else {
      ws.close(4000, `Bad Request: Unsupported LSP language "${language}"`);
      return;
    }

    // 4. Retrieve or create unified container
    const container = await getOrCreateWorkspaceContainer(userId, workspaceId);

    // 5. Spawn language server inside the container
    console.log(`[LSP] Spawning server "${cmd.join(' ')}" inside container...`);
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false, // multiplexed stdout/stderr streams
      WorkingDir: '/app'
    });

    execStream = await exec.start({ hijack: true, stdin: true });

    // 6. Flush early buffered messages to the language server
    execStreamReady = true;
    while (messageQueue.length > 0) {
      const data = messageQueue.shift();
      if (data && execStream && !execStream.destroyed && execStream.writable) {
        execStream.write(data);
      }
    }

    let frameBuffer = Buffer.alloc(0);
    execStream.on('data', (chunk: Buffer) => {
      frameBuffer = Buffer.concat([frameBuffer, chunk]);
      while (frameBuffer.length >= 8) {
        const streamType = frameBuffer[0];
        const payloadSize = frameBuffer.readUInt32BE(4);
        if (frameBuffer.length < 8 + payloadSize) {
          break;
        }
        const payload = frameBuffer.slice(8, 8 + payloadSize);
        if (streamType === 1) { // stdout
          ws.send(payload);
        } else if (streamType === 2) { // stderr
          console.warn('[LSP Stderr]:', payload.toString('utf8').trim());
        }
        frameBuffer = frameBuffer.slice(8 + payloadSize);
      }
    });

    execStream.on('end', () => {
      console.log('[LSP] Exec stream ended');
      ws.close(1000, 'LSP Stream Closed');
    });

    execStream.on('error', (err: any) => {
      console.error('[LSP] Exec stream error:', err);
      ws.close(1011, 'LSP Internal Exec Error');
    });

    ws.on('close', async () => {
      clearTimeout(idleTimeout);
      await cleanup();
    });

    ws.on('error', async (err) => {
      console.error('[LSP] WS Connection error:', err);
      clearTimeout(idleTimeout);
      await cleanup();
    });

  } catch (err: any) {
    console.error('[LSP] Connection initialization failed:', err);
    ws.close(1011, 'Internal Server Error');
    await cleanup();
  }
}
