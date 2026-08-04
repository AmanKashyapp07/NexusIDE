import type http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { getPool } from '../db.js';
import { handleTerminalConnection } from '../terminal/terminalHandler.js';
import { handleLspConnection } from '../terminal/lspHandler.js';
import { releaseWorkspaceContainer } from '../sandbox/workspaceContainer.js';
import { getDocsMap } from '../docsRegistry.js';
import { log } from './logger.service.js';
import { WSSharedDoc, getOrCreateDoc } from './yjsSyncEngine.service.js';

interface DecodedUser {
   id: string;
   username?: string;
}

const docs = getDocsMap();
const pendingConns = new Map<string, number>();

export function setupWebSocketServer(server: http.Server): WebSocketServer {
   const wss = new WebSocketServer({ noServer: true });

   server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
      if (url.pathname.startsWith('/socket.io/')) return; 
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
   });

   wss.on('connection', async (ws: WebSocket, req: http.IncomingMessage) => {
      try {
         const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
         
         if (url.pathname.startsWith('/terminal/')) return await handleTerminalConnection(ws, req);
         if (url.pathname.startsWith('/ws/lsp/') || url.pathname.startsWith('/lsp/')) return await handleLspConnection(ws, req);

         const token = url.searchParams.get('token');
         if (!token) return ws.close(4401, 'Unauthorized');

         let decodedUser: DecodedUser;
         try { 
            decodedUser = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret') as DecodedUser; 
         } catch { 
            return ws.close(4401, 'Invalid token'); 
         }

         const docName = url.pathname.slice(1);
         if (!docName || docName === 'default') return ws.close(4000, 'Invalid room format');

         const match = docName.match(/^([0-9a-fA-F-]{36})(-.*)?$/) || docName.match(/^workspace-([0-9a-fA-F-]{36})$/);
         if (!match || !match[1]) return ws.close(4000, 'Invalid room format');
         
         const workspaceId = match[1];

         let role: string | null = null;
         let docRef: WSSharedDoc | null = null;
         const docNameRef: string = docName;
         let messageBuffer: Buffer[] | null = [];

         const processMessage = (message: Buffer, targetDoc: WSSharedDoc): void => {
            try {
               const decoder = decoding.createDecoder(new Uint8Array(message));
               const messageType = decoding.readVarUint(decoder);

               if (role === 'viewer' && messageType === 0) {
                  const syncMessageType = decoding.readVarUint(decoder);
                  if (syncMessageType === 1 || syncMessageType === 2) return; 
               }

               const processDecoder = decoding.createDecoder(new Uint8Array(message));
               const type = decoding.readVarUint(processDecoder);

               if (type === 0) {
                  const encoder = encoding.createEncoder();
                  encoding.writeVarUint(encoder, 0);
                  syncProtocol.readSyncMessage(processDecoder, encoder, targetDoc, ws);
                  if (encoding.length(encoder) > 1) {
                     targetDoc.send(ws, encoding.toUint8Array(encoder));
                  }
               } else if (type === 1) {
                  awarenessProtocol.applyAwarenessUpdate(targetDoc.awareness, decoding.readVarUint8Array(processDecoder), ws);
               }
            } catch (err: unknown) {
               const msg = err instanceof Error ? err.message : String(err);
               log('🔌 WS', `Message processing error: ${msg}`);
            }
         };

         ws.on('message', (message: Buffer) => {
            if (!docRef) {
               messageBuffer?.push(message);
            } else {
               processMessage(message, docRef);
            }
         });

         ws.on('close', async () => {
            if (decodedUser?.id && workspaceId) {
               releaseWorkspaceContainer(decodedUser.id, workspaceId)?.catch(() => {});
            }

            if (!docRef) return;
            const doc = docRef;
            const controlledIds = doc.conns.get(ws);
            doc.conns.delete(ws);
            if (controlledIds) {
               awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds), null);
            }
            
            if (doc.conns.size === 0 && (pendingConns.get(docNameRef) || 0) === 0) {
               try {
                  await doc.performFinalSave();
               } finally {
                  if (doc.conns.size === 0 && (pendingConns.get(docNameRef) || 0) === 0) {
                     docs.delete(docNameRef);
                     doc.destroy();
                     log('🔒 CLOSE', `Document memory reclaimed for doc=${docNameRef}`);
                  }
               }
            }
         });

         const wsResult = await getPool().query('SELECT owner_id, is_public FROM workspaces WHERE id = $1', [workspaceId]);
         if (!wsResult.rows.length) return ws.close(4044, 'Workspace not found');

         role = wsResult.rows[0].owner_id === decodedUser.id ? 'admin' : null;
         if (!role) {
            const collabRes = await getPool().query('SELECT role FROM workspace_collaborators WHERE workspace_id = $1 AND user_id = $2', [workspaceId, decodedUser.id]);
            role = collabRes.rows.length ? collabRes.rows[0].role : (wsResult.rows[0].is_public ? 'viewer' : null);
         }
         if (!role) return ws.close(4403, 'Forbidden');

         pendingConns.set(docName, (pendingConns.get(docName) || 0) + 1);

         let doc: WSSharedDoc;
         try {
            doc = await getOrCreateDoc(docName);
         } finally {
            const remaining = (pendingConns.get(docName) || 1) - 1;
            if (remaining <= 0) {
               pendingConns.delete(docName);
            } else {
               pendingConns.set(docName, remaining);
            }
         }
         
         docRef = doc;

         if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
            doc.conns.set(ws, new Set());
            ws.emit('close');
            return;
         }

         doc.conns.set(ws, new Set());
         
         const encoder = encoding.createEncoder();
         encoding.writeVarUint(encoder, 0);
         syncProtocol.writeSyncStep1(encoder, doc);
         ws.send(encoding.toUint8Array(encoder));

         const awarenessStates = doc.awareness.getStates();
         if (awarenessStates.size > 0) {
            const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(awarenessStates.keys()));
            const encoderAwareness = encoding.createEncoder();
            encoding.writeVarUint(encoderAwareness, 1);
            encoding.writeVarUint8Array(encoderAwareness, awarenessUpdate);
            ws.send(encoding.toUint8Array(encoderAwareness));
         }

         if (messageBuffer) {
            for (const msg of messageBuffer) {
               processMessage(msg, docRef);
            }
            messageBuffer = null;
         }

      } catch {
         ws.close(4500, 'Internal Server Error');
      }
   });

   return wss;
}
