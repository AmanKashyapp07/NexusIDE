import { IncomingMessage } from 'http';
import { WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { getPool } from '../db.js';
import { getOrCreateWorkspaceContainer, releaseWorkspaceContainer } from '../sandbox/workspaceContainer.js';
import { extractDockerPayload } from '../utils/streamParser.utils.js';

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

interface DecodedToken {
   id: string;
}

export async function handleLspConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
   let containerReleased = false;
   let execStream: { write: (data: Buffer) => void; destroyed?: boolean; writable?: boolean; end: () => void; destroy?: () => void; on: (event: string, cb: (...args: unknown[]) => void) => void } | null = null;
   let execStreamReady = false;
   let userId = '';
   let workspaceId = '';
   const messageQueue: Buffer[] = [];

   let idleTimeout = setTimeout(() => ws.close(1000, 'Idle Timeout'), IDLE_TIMEOUT_MS);
   const resetIdleTimeout = (): void => { 
      clearTimeout(idleTimeout); 
      idleTimeout = setTimeout(() => ws.close(1000, 'Idle'), IDLE_TIMEOUT_MS); 
   };

   ws.on('message', (msg: unknown) => {
      resetIdleTimeout();
      const data = Buffer.isBuffer(msg) ? msg : Buffer.from(msg as string | Uint8Array);
      if (execStreamReady && execStream && !execStream.destroyed && execStream.writable) {
         execStream.write(data);
      } else {
         messageQueue.push(data);
      }
   });

   const cleanup = async (): Promise<void> => {
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
      const wsId = lspIdx !== -1 ? parts[lspIdx + 1] || '' : '';
      const lang = lspIdx !== -1 ? parts[lspIdx + 2] || '' : '';
      const token = url.searchParams.get('token');

      workspaceId = wsId;

      if (!workspaceId || !lang || !token) {
         console.warn('[LSP Close]: Missing params. workspaceId:', workspaceId, 'lang:', lang, 'token:', !!token);
         return ws.close(4000, 'Bad Request');
      }

      let decodedUser: DecodedToken;
      try { 
         decodedUser = jwt.verify(token, process.env.JWT_SECRET || 'fallback') as DecodedToken; 
      } catch (e: unknown) { 
         const msg = e instanceof Error ? e.message : String(e);
         console.warn('[LSP Close]: JWT verification failed:', msg);
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

      let frameBuffer: Buffer = Buffer.alloc(0);
      execStream.on('data', (chunk: unknown) => {
         const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
         frameBuffer = Buffer.concat([frameBuffer, bufferChunk]) as Buffer;
         
         while (true) {
            const extracted = extractDockerPayload(frameBuffer);
            if (!extracted) break;

            const { payload, streamType, remainingBuffer } = extracted;
            frameBuffer = remainingBuffer as Buffer;

            if (streamType === 1) {
               if (ws.readyState === WebSocket.OPEN) ws.send(payload);
            } else if (streamType === 2) {
               console.warn('[LSP Stderr]:', payload.toString('utf8').trim());
            }
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

   } catch (err: unknown) {
      console.error('[LSP Connection Error]:', err);
      if (ws.readyState === WebSocket.OPEN) ws.close(1011, 'Server Error');
      await cleanup();
   }
}