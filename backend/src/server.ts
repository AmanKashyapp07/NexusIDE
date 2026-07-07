import './disable-logs.js';
import dotenv from 'dotenv';
dotenv.config();

// =============================================================================
// [OBSERVABILITY] Debug Logger for Collaboration Engine
// =============================================================================
const LOG_ENABLED = process.env.LOG_LEVEL !== 'silent';
const _origLog = console.log;

function log(prefix: string, ...args: any[]) {
  if (!LOG_ENABLED) return;
  const ts = new Date().toISOString().slice(11, 23);
  _origLog(`[${ts}] ${prefix}`, ...args);
}


import express from 'express';
import http from 'http';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

import workspaceRoutes from './routes/workspace';
import authRoutes from './routes/auth';
import { requireAuth } from './middleware/auth';
import { setIO, getIO } from './socket';
import { getPool } from './db';
import { warmPoolManager } from './sandbox/pool';
import { handleTerminalConnection, syncFileToTerminal } from './terminal/terminalHandler';
import { handleLspConnection } from './terminal/lspHandler';
import { cleanupAllWorkspaceContainers, releaseWorkspaceContainer } from './sandbox/workspaceContainer';
import { getDocsMap } from './docsRegistry.js';

const app = express();
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  if (req.path.startsWith('/api/workspace')) return next();
  const referer = req.headers.referer;
  if (referer) {
    const match = referer.match(/\/api\/workspace\/([^\/]+)\/preview/);
    if (match) {
      return res.redirect(`/api/workspace/${match[1]}/preview${req.originalUrl}`);
    }
  }
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/workspace', requireAuth, workspaceRoutes);

const server = http.createServer(app);

// =============================================================================
// [ARCHITECTURE] DETERMINISTIC SYNCHRONIZATION ENGINE
// =============================================================================

class WSSharedDoc extends Y.Doc {
  name: string;
  workspaceId: string;
  fileId: string;
  awareness: awarenessProtocol.Awareness;
  conns: Map<WebSocket, Set<number>>;
  dbLoaded: boolean;
  saveTimeout: NodeJS.Timeout | null;
  isSaving: boolean;
  // [AUTHOR ATTRIBUTION] Persistent clientID → user info mapping.
  // Accumulated across all sessions — once a clientID is mapped to a user it
  // stays, even after the user disconnects. On reconnect the user gets a new
  // clientID which gets its own entry. This gives the timelapse replayer a
  // stable lookup of "who typed each character" for the lifetime of the file.
  authorMap: Map<number, { userId: string; username: string; color: string }>;

  constructor(name: string, workspaceId: string, fileId: string) {
    // gc:false preserves tombstoned (deleted) items in yjs_state so the
    // timelapse replayer can reconstruct the full editing history including
    // characters that were typed and later deleted.
    super({ gc: false });
    this.name = name;
    this.workspaceId = workspaceId;
    this.fileId = fileId;
    this.awareness = new awarenessProtocol.Awareness(this);
    this.awareness.setLocalState(null);
    this.conns = new Map();
    this.dbLoaded = false;
    this.saveTimeout = null;
    this.isSaving = false;
    this.authorMap = new Map();

    this.on('update', this.handleDocumentUpdate.bind(this));
    
    this.awareness.on('update', ({ added, updated, removed }: any, conn: WebSocket | null) => {
      const changedClients = added.concat(updated, removed);
      if (conn !== null) {
        const connControlledIDs = this.conns.get(conn);
        if (connControlledIDs !== undefined) {
          added.forEach((clientID: number) => { connControlledIDs.add(clientID); });
          removed.forEach((clientID: number) => { connControlledIDs.delete(clientID); });
        }
      }

      // [AUTHOR ATTRIBUTION] When a client sets its awareness user field,
      // record clientID → { userId, username, color } in authorMap.
      // We check added + updated (not removed) since we want to keep the mapping
      // permanently even after the client disconnects.
      [...added, ...updated].forEach((clientID: number) => {
        const state = this.awareness.getStates().get(clientID) as any;
        if (state?.user?.id && state?.user?.name) {
          this.authorMap.set(clientID, {
            userId:   state.user.id,
            username: state.user.name,
            color:    state.user.color || '#6366f1',
          });
        }
      });

      const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 1);
      encoding.writeVarUint8Array(encoder, awarenessUpdate);
      const buff = encoding.toUint8Array(encoder);
      this.conns.forEach((_, c) => this.send(c, buff));
    });
  }

  send(conn: WebSocket, m: Uint8Array) {
    if (conn.readyState !== WebSocket.CONNECTING && conn.readyState !== WebSocket.OPEN) return;
    try {
      conn.send(m);
    } catch (e) {
      conn.close();
    }
  }

  handleDocumentUpdate(update: Uint8Array, origin: any) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);
    this.conns.forEach((_, conn) => this.send(conn, message));

    if (!this.dbLoaded) return;

    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(async () => {
      if (this.isSaving) return;
      this.isSaving = true;
      try {
        const state = Buffer.from(Y.encodeStateAsUpdate(this));
        const content = this.getText('monaco').toString();
        // Serialise authorMap as a plain JSON object keyed by clientID string
        const authorMapJson = Object.fromEntries(
          Array.from(this.authorMap.entries()).map(([k, v]) => [String(k), v])
        );
        log('💾 SAVE', `Debounced save doc=${this.name} (${content.length} chars, ${this.authorMap.size} authors)`);
        await getPool().query(
          'UPDATE files SET yjs_state = $1, content = $2, author_map = $3 WHERE id = $4',
          [state, content, JSON.stringify(authorMapJson), this.fileId]
        );
        syncFileToTerminal(this.workspaceId, this.fileId, content).catch(() => {});
        getIO()?.to(`presence-${this.workspaceId}`).emit('file-saved', { fileId: this.fileId });
      } catch (err: any) {
        log('💾 SAVE', `❌ DB save error: ${err.message}`);
      } finally {
        this.isSaving = false;
      }
    }, 800);
  }

  async performFinalSave() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    try {
      const state = Buffer.from(Y.encodeStateAsUpdate(this));
      const content = this.getText('monaco').toString();
      const authorMapJson = Object.fromEntries(
        Array.from(this.authorMap.entries()).map(([k, v]) => [String(k), v])
      );
      log('🔒 CLOSE', `Final save doc=${this.name} (${content.length} chars)`);
      await getPool().query(
        'UPDATE files SET yjs_state = $1, content = $2, author_map = $3 WHERE id = $4',
        [state, content, JSON.stringify(authorMapJson), this.fileId]
      );
      syncFileToTerminal(this.workspaceId, this.fileId, content).catch(() => {});
    } catch (err: any) {
      log('🔒 CLOSE', `❌ Final save error: ${err.message}`);
    }
  }
}

// Centralized registry: Map of document names to Promises
const docs = getDocsMap();
const pendingConns = new Map<string, number>();

async function getOrCreateDoc(docName: string): Promise<WSSharedDoc> {
  if (docs.has(docName)) {
    return docs.get(docName)!;
  }

  const loadPromise = (async () => {
    const match = docName.match(/^([0-9a-fA-F-]{36})-([0-9a-fA-F-]{36})$/);
    if (!match || !match[1] || !match[2]) throw new Error("Invalid doc name");
    
    const doc = new WSSharedDoc(docName, match[1], match[2]);
    
    try {
      const res = await getPool().query('SELECT content, yjs_state, author_map FROM files WHERE id = $1', [doc.fileId]);
      if (res.rows.length > 0) {
        if (res.rows[0].yjs_state) {
          Y.applyUpdate(doc, res.rows[0].yjs_state);
        } else if (res.rows[0].content) {
          doc.getText('monaco').insert(0, res.rows[0].content);
        }
        // [AUTHOR ATTRIBUTION] Restore the previously accumulated clientID→user
        // map from DB so timelapse history always has full attribution even for
        // characters written in previous server sessions.
        const storedMap = res.rows[0].author_map;
        if (storedMap && typeof storedMap === 'object') {
          for (const [clientIdStr, info] of Object.entries(storedMap)) {
            const clientId = Number(clientIdStr);
            if (!isNaN(clientId) && info && typeof info === 'object') {
              doc.authorMap.set(clientId, info as { userId: string; username: string; color: string });
            }
          }
        }
      }
      doc.dbLoaded = true;
      log('📄 BIND', `Database loaded for doc=${docName}`);
    } catch (err: any) {
      log('📄 BIND', `❌ DB error loading file: ${err.message}`);
    }
    return doc;
  })();

  docs.set(docName, loadPromise);
  return loadPromise;
}

// =============================================================================
// [PROTOCOL MULTIPLEXING] THE UPGRADE EVENT
// =============================================================================

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/socket.io/')) return; 
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
});

// =============================================================================
// [SECURITY & ROUTING] RAW WEBSOCKET HANDLER
// =============================================================================
wss.on('connection', async (ws, req) => {
  try {
    const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    
    if (url.pathname.startsWith('/terminal/')) return await handleTerminalConnection(ws, req);
    if (url.pathname.startsWith('/ws/lsp/')) return await handleLspConnection(ws, req);

    const token = url.searchParams.get('token');
    if (!token) return ws.close(4401, 'Unauthorized');

    let decodedUser: any;
    try { decodedUser = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret'); } 
    catch (e) { return ws.close(4401, 'Invalid token'); }

    const docName = url.pathname.slice(1);
    if (!docName || docName === 'default') return ws.close(4000, 'Invalid room format');

    const match = docName.match(/^([0-9a-fA-F-]{36})(-.*)?$/) || docName.match(/^workspace-([0-9a-fA-F-]{36})$/);
    if (!match || !match[1]) return ws.close(4000, 'Invalid room format');
    
    const workspaceId = match[1];

    // -------------------------------------------------------------------------
    // [CRITICAL] Attach the message listener + buffer BEFORE any async work.
    //
    // y-websocket clients send their SyncStep1 immediately on WS `open`. If the
    // server only attaches `ws.on('message')` AFTER its auth/doc-load awaits,
    // that SyncStep1 arrives during the gap and is dropped by the `ws` library
    // (emitted to zero listeners). The server then never replies with SyncStep2,
    // so the client's `synced` never flips true and its `sync` event never fires
    // — leaving the editor unbound/empty. This manifests intermittently under
    // rapid reconnection (rapid file switching). Buffering from the very start
    // and replaying once the doc is ready guarantees no initial message is lost.
    // -------------------------------------------------------------------------
    let role: string | null = null;
    let docRef: WSSharedDoc | null = null;
    const docNameRef: string = docName;
    let messageBuffer: Buffer[] | null = [];

    const processMessage = (message: Buffer, targetDoc: WSSharedDoc) => {
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
      } catch (err: any) {
        log('🔌 WS', `Message processing error: ${err.message}`);
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
      // Release the workspace container when the editor tab closes/navigates away.
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

    // Authorization (awaits). Any client messages arriving during these queries
    // are safely captured by the buffering listener attached above.
    const wsResult = await getPool().query('SELECT owner_id, is_public FROM workspaces WHERE id = $1', [workspaceId]);
    if (!wsResult.rows.length) return ws.close(4044, 'Workspace not found');

    role = wsResult.rows[0].owner_id === decodedUser.id ? 'admin' : null;
    if (!role) {
      const collabRes = await getPool().query('SELECT role FROM workspace_collaborators WHERE workspace_id = $1 AND user_id = $2', [workspaceId, decodedUser.id]);
      role = collabRes.rows.length ? collabRes.rows[0].role : (wsResult.rows[0].is_public ? 'viewer' : null);
    }
    if (!role) return ws.close(4403, 'Forbidden');

    // Track pending connection to prevent cleanups from destroying this doc during load/await
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
    
    // Sync Step 1
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


  } catch (error: any) {
    ws.close(4500, 'Internal Server Error');
  }
});

// =============================================================================
// [REAL-TIME ARCHITECTURE] SOCKET.IO
// =============================================================================
const io = new SocketIOServer(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
setIO(io);

io.use((socket, next) => {
  try {
    socket.data.user = jwt.verify(socket.handshake.auth.token, process.env.JWT_SECRET || 'fallback_secret');
    next();
  } catch { next(new Error('Auth error')); }
});

const workspacePresence = new Map<string, Map<string, any>>();
const PRESENCE_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899'];
const getColor = (u: string) => PRESENCE_COLORS[Math.abs([...u].reduce((h, c) => c.charCodeAt(0) + ((h << 5) - h), 0)) % PRESENCE_COLORS.length];

const broadcastPresence = (wsId: string) => io.to(`presence-${wsId}`).emit('workspace-presence-update', Array.from(workspacePresence.get(wsId)?.values() || []));

io.on('connection', (socket) => {
  socket.on('join-workspace', ({ workspaceId }) => {
    if (!socket.data.user || !workspaceId) return;
    socket.data.presenceWorkspaceId = workspaceId;
    socket.join(`presence-${workspaceId}`);
    
    if (!workspacePresence.has(workspaceId)) workspacePresence.set(workspaceId, new Map());
    workspacePresence.get(workspaceId)!.set(socket.id, { userId: socket.data.user.id, username: socket.data.user.username || 'unknown', color: getColor(socket.data.user.username || 'unknown'), activeFileId: null });
    broadcastPresence(workspaceId);

    // [PRODUCTION FIX] Push the current file tree state immediately to the
    // joining socket. On a real network, there is a race between when the
    // client's Socket.IO connects and when broadcast events fire from other
    // users' actions. A 'file-tree-update' emitted to the room while this
    // socket was still connecting is permanently lost. Pushing it here on
    // join guarantees this socket always fetches the latest file list,
    // regardless of when it connected relative to any broadcast.
    socket.emit('file-tree-update');
  });

  socket.on('active-file-change', ({ activeFileId }) => {
    const wsId = socket.data.presenceWorkspaceId;
    const member = workspacePresence.get(wsId)?.get(socket.id);
    if (member) { member.activeFileId = activeFileId; broadcastPresence(wsId); }
  });

  socket.on('broadcast-file-tree', ({ workspaceId }) => {
    if (!socket.data.user || !workspaceId) return;
    io.to(`presence-${workspaceId}`).emit('file-tree-update');
  });

  socket.on('user-typing', ({ workspaceId }) => {
    if (!socket.data.user || !workspaceId) return;
    socket.to(`presence-${workspaceId}`).emit('user-typing', { userId: socket.data.user.id });
  });

  socket.on('leave-workspace', () => {
    const wsId = socket.data.presenceWorkspaceId;
    if (wsId) {
      socket.leave(`presence-${wsId}`);
      workspacePresence.get(wsId)?.delete(socket.id);
      if (workspacePresence.get(wsId)?.size === 0) workspacePresence.delete(wsId);
      broadcastPresence(wsId);
      socket.data.presenceWorkspaceId = undefined;
    }
  });

  socket.on('join-voice-room', async ({ workspaceId }) => {
    socket.join(workspaceId);
    socket.data.workspaceId = workspaceId;
    socket.to(workspaceId).emit('user-joined-voice', { socketId: socket.id, user: socket.data.user });
    socket.emit('existing-voice-users', (await io.in(workspaceId).fetchSockets()).filter(s => s.id !== socket.id).map(s => ({ socketId: s.id, user: s.data.user })));
  });

  socket.on('webrtc-offer', ({ offer, to, user }) => socket.to(to).emit('webrtc-offer', { offer, from: socket.id, user }));
  socket.on('webrtc-answer', ({ answer, to }) => socket.to(to).emit('webrtc-answer', { answer, from: socket.id }));
  socket.on('webrtc-ice-candidate', ({ candidate, to }) => socket.to(to).emit('webrtc-ice-candidate', { candidate, from: socket.id }));

  socket.on('disconnect', () => {
    if (socket.data.workspaceId) io.to(socket.data.workspaceId).emit('user-left-voice', socket.id);
    const wsId = socket.data.presenceWorkspaceId;
    if (wsId) {
      workspacePresence.get(wsId)?.delete(socket.id);
      if (workspacePresence.get(wsId)?.size === 0) workspacePresence.delete(wsId);
      broadcastPresence(wsId);
    }
  });
});

const PORT = process.env.PORT || 4000;
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    log('🚀 BOOT', `Server listening on port ${PORT}`);
    warmPoolManager.initializePools().catch(() => {});
    getPool().query('SELECT NOW()', (err) => {
      log('🚀 BOOT', err ? '❌ DB Connection Failed' : '✅ DB Connected');
    });
  });
}

const gracefulShutdown = async (signal: string) => {
  if (process.env.NODE_ENV !== 'test') {
    await Promise.all([
      warmPoolManager.cleanup().catch(() => {}),
      cleanupAllWorkspaceContainers().catch(() => {})
    ]);
    process.exit(0);
  }
};
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

export { app, server, docs };