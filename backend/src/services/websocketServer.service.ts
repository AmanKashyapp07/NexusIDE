/**
 * Purpose: Low-level WebSocket server factory and connection broker.
 * High-Level Architecture: Intercepts Node.js HTTP 'upgrade' events to route incoming WebSockets to the correct subsystem (Yjs Collaboration Engine, Docker Terminal PTY, or Language Server Protocol LSP).
 * Primary Trade-offs: Out-of-band JWT authentication over URL query parameters allows native browser WebSocket connections without header manipulation.
 * Complexity: O(1) connection setup and message routing per packet.
 */

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

// =============================================================================
// WEBSOCKET SERVER INITIALIZATION & UPGRADE MULTIPLEXING
// =============================================================================

// INTENT: Instantiate and attach a multi-protocol WebSocket server to an existing Node.js HTTP server.
// WHY: Shares port 4000 across REST APIs, Socket.IO, Terminal PTY streams, LSP endpoints, and Yjs CRDT rooms.
// INTERVIEW NOTES: `noServer: true` hands explicit control of HTTP upgrade handshakes back to custom routing logic.
export function setupWebSocketServer(server: http.Server): WebSocketServer {
   const wss = new WebSocketServer({ noServer: true });

   // INTENT: Multiplex incoming HTTP upgrade requests by pathname pattern.
   // WHY: Socket.IO handles its own upgrade protocol. Non-Socket.IO requests are handed over to this WebSocketServer instance.
   // EDGE CASE: Avoid intercepting `/socket.io/` paths to prevent breaking Socket.IO handshakes.
   server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
      if (url.pathname.startsWith('/socket.io/')) return; 
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
   });

   // =============================================================================
   // CONNECTION LIFECYCLE & YJS ROOM AUTHORIZATION
   // =============================================================================

   // INTENT: Authenticate, authorize, and connect a WebSocket client to the target room document.
   // WHY: Ensures strict RBAC (Viewer, Editor, Admin) before granting document read/write access.
   wss.on('connection', async (ws: WebSocket, req: http.IncomingMessage) => {
      try {
         const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
         
         // INTENT: Delegate terminal PTY and LSP requests to their specialized handlers.
         // WHY: Isolates stream-based terminal/LSP protocols from Yjs binary CRDT sync protocol.
         if (url.pathname.startsWith('/terminal/')) return await handleTerminalConnection(ws, req);
         if (url.pathname.startsWith('/ws/lsp/') || url.pathname.startsWith('/lsp/')) return await handleLspConnection(ws, req);

         // INTENT: Extract and verify JWT authorization token from query params.
         // WHY: Standard browser WebSocket API does not support custom headers during initial handshake.
         // EDGE CASE: If token is missing or invalid, immediately close socket with 4401 closure code to avoid dangling connections.
         const token = url.searchParams.get('token');
         if (!token) return ws.close(4401, 'Unauthorized');

         let decodedUser: DecodedUser;
         try { 
            decodedUser = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret') as DecodedUser; 
         } catch { 
            return ws.close(4401, 'Invalid token'); 
         }

         // INTENT: Parse workspace and document room identifiers from URL path.
         // WHY: Format convention is `<workspaceId>-<fileId>` or `workspace-<workspaceId>`.
         const docName = url.pathname.slice(1);
         if (!docName || docName === 'default') return ws.close(4000, 'Invalid room format');

         const match = docName.match(/^([0-9a-fA-F-]{36})(-.*)?$/) || docName.match(/^workspace-([0-9a-fA-F-]{36})$/);
         if (!match || !match[1]) return ws.close(4000, 'Invalid room format');
         
         const workspaceId = match[1];

         let role: string | null = null;
         let docRef: WSSharedDoc | null = null;
         const docNameRef: string = docName;
         let messageBuffer: Buffer[] | null = [];

         // =============================================================================
         // BINARY CRDT & AWARENESS PACKET PROCESSING
         // =============================================================================

         // INTENT: Demux and process binary Yjs protocol updates (SyncStep1, SyncStep2, Awareness).
         // WHY: Decodes varints using `lib0` encoding/decoding utilities to apply binary state updates directly to Y.Doc memory.
         // EDGE CASE: Enforces Read-Only protection for 'viewer' role by dropping incoming SyncStep2 update packets.
         // INTERVIEW NOTES: Dropping write packets at the server border preserves zero-trust security without needing client-side trust.
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

         // INTENT: Buffer incoming binary messages while room allocation completes asynchronously.
         // WHY: Prevents client update drop when packets arrive before the database authorization promise resolves.
         ws.on('message', (message: Buffer) => {
            if (!docRef) {
               messageBuffer?.push(message);
            } else {
               processMessage(message, docRef);
            }
         });

         // INTENT: Clean up socket tracking, awareness state, and trigger final document database persistence on disconnect.
         // WHY: When all clients disconnect from a room, perform final database commit and destroy Y.Doc instance to reclaim RAM.
         // EDGE CASE: Concurrent connection attempts during cleanup are safe because `pendingConns` tracking prevents premature eviction.
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

         // INTENT: Database permission verification for workspace owner and collaborators.
         const wsResult = await getPool().query('SELECT owner_id, is_public FROM workspaces WHERE id = $1', [workspaceId]);
         if (!wsResult.rows.length) return ws.close(4044, 'Workspace not found');

         role = wsResult.rows[0].owner_id === decodedUser.id ? 'admin' : null;
         if (!role) {
            const collabRes = await getPool().query('SELECT role FROM workspace_collaborators WHERE workspace_id = $1 AND user_id = $2', [workspaceId, decodedUser.id]);
            role = collabRes.rows.length ? collabRes.rows[0].role : (wsResult.rows[0].is_public ? 'viewer' : null);
         }
         if (!role) return ws.close(4403, 'Forbidden');

         // INTENT: Track in-flight pending connections to guarantee atomic document acquisition.
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
         
         // INTENT: Perform initial Yjs SyncStep1 handshake and transmit current room state vector.
         const encoder = encoding.createEncoder();
         encoding.writeVarUint(encoder, 0);
         syncProtocol.writeSyncStep1(encoder, doc);
         ws.send(encoding.toUint8Array(encoder));

         // INTENT: Transmit current peer presence/cursor awareness state vector to newly connected client.
         const awarenessStates = doc.awareness.getStates();
         if (awarenessStates.size > 0) {
            const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(awarenessStates.keys()));
            const encoderAwareness = encoding.createEncoder();
            encoding.writeVarUint(encoderAwareness, 1);
            encoding.writeVarUint8Array(encoderAwareness, awarenessUpdate);
            ws.send(encoding.toUint8Array(encoderAwareness));
         }

         // INTENT: Flush buffered messages received during async authorization.
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
