import dotenv from 'dotenv';
dotenv.config();

// [OBSERVABILITY] Global Log Suppression
// In production, you typically replace this with a structured logger (like Pino/Winston) 
// to prevent noisy dependency logs from flooding stdout and increasing cloud logging costs.
console.log = () => {}; console.error = () => {}; console.warn = () => {}; console.info = () => {};

import express from 'express';
import http from 'http';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import * as Y from 'yjs';
// @ts-ignore
import { setupWSConnection, setPersistence } from 'y-websocket/bin/utils';
import workspaceRoutes from './routes/workspace';
import authRoutes from './routes/auth';
import { requireAuth } from './middleware/auth';
import { setIO } from './socket';
import { getPool } from './db';
import { warmPoolManager } from './sandbox/pool';
import { handleTerminalConnection, syncFileToTerminal } from './terminal/terminalHandler';
import { handleLspConnection } from './terminal/lspHandler';
import { cleanupAllWorkspaceContainers } from './sandbox/workspaceContainer';

const app = express();
app.use(cors());
app.use(express.json());

// Universal transparent routing for sandbox preview
// This intercepts ANY stray absolute path requests (e.g. fetch('/api/message'), <script src="/main.js">)
// originating from the preview iframe and automatically reroutes them into the sandbox container.
app.use((req, res, next) => {
  // Ignore requests already correctly routed to the workspace API
  if (req.path.startsWith('/api/workspace')) return next();
  
  const referer = req.headers.referer;
  if (referer) {
    const match = referer.match(/\/api\/workspace\/([^\/]+)\/preview/);
    if (match) {
      // Request originated from a workspace preview! Redirect to the sandbox proxy path.
      return res.redirect(`/api/workspace/${match[1]}/preview${req.originalUrl}`);
    }
  }
  next();
});

// REST HTTP Routes
app.use('/api/auth', authRoutes);
app.use('/api/workspace', requireAuth, workspaceRoutes);

// We wrap Express in a raw Node HTTP server so we can manually intercept protocol upgrades.
const server = http.createServer(app);

// =============================================================================
// [ARCHITECTURE] CRDT PERSISTENCE LAYER (Yjs)
// =============================================================================
// INTERVIEW KEY: Why CRDT over Operational Transformation (OT like Google Docs)?
// OT requires a central server to strictly order every operation. CRDTs are decentralized; 
// peers can apply edits in any order, and math guarantees they all converge to the exact same state.
// We store the Yjs state as `BYTEA` (binary) in Postgres because it contains the entire edit history 
// and logical Lamport timestamps required for conflict resolution, not just the final string.
setPersistence({
  bindState: async (docName: string, ydoc: Y.Doc) => {
    const match = docName.match(/^([0-9a-fA-F-]{36})-([0-9a-fA-F-]{36})$/);
    if (!match) return;
    const workspaceId = match[1]!;
    const fileId = match[2]!;

    try {
      const res = await getPool().query('SELECT content, yjs_state FROM files WHERE id = $1', [fileId]);
      if (res.rows.length > 0) {
        if (res.rows[0].yjs_state) Y.applyUpdate(ydoc, res.rows[0].yjs_state); // Merge saved binary history
        else if (res.rows[0].content) ydoc.getText('monaco').insert(0, res.rows[0].content); // Legacy fallback
      }
    } catch (err) {}

    // [PERFORMANCE] Write Throttling / Debouncing
    // Yjs emits an update for every single keystroke. Writing to Postgres on every keystroke 
    // would immediately overload the DB connections. We debounce writes by 400ms.
    let saveTimeout: NodeJS.Timeout | null = null;
    ydoc.on('update', () => {
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(async () => {
        try {
          const state = Buffer.from(Y.encodeStateAsUpdate(ydoc));
          const content = ydoc.getText('monaco').toString();
          await getPool().query('UPDATE files SET yjs_state = $1, content = $2 WHERE id = $3', [state, content, fileId]);
          syncFileToTerminal(workspaceId, fileId, content).catch(() => {});
        } catch (err) {}
      }, 400);
    });
  },

  writeState: async (docName: string, ydoc: Y.Doc) => {
    // Authoritative final save when the last client disconnects from the file.
    const match = docName.match(/^([0-9a-fA-F-]{36})-([0-9a-fA-F-]{36})$/);
    if (!match) return;
    const workspaceId = match[1]!;
    const fileId = match[2]!;
    try {
      const content = ydoc.getText('monaco').toString();
      await getPool().query('UPDATE files SET yjs_state = $1, content = $2 WHERE id = $3', [Buffer.from(Y.encodeStateAsUpdate(ydoc)), content, fileId]);
      syncFileToTerminal(workspaceId, fileId, content).catch(() => {});
    } catch (err) {}
  }
});

// =============================================================================
// [PROTOCOL MULTIPLEXING] THE UPGRADE EVENT
// =============================================================================
// INTERVIEW KEY: How do you serve REST, Socket.IO, and Raw WebSockets on Port 4000?
// All WebSocket connections start as HTTP GET requests with an "Upgrade: websocket" header.
// We intercept this at the TCP level. If the URL is Socket.IO, we ignore it (letting IO handle it).
// Otherwise, we pass the socket to our raw `ws` server for Yjs, LSP, and Terminal streams.
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/socket.io/')) return; // Yield to Socket.IO
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
});

// =============================================================================
// [SECURITY & ROUTING] RAW WEBSOCKET HANDLER
// =============================================================================
wss.on('connection', async (ws, req) => {
  try {
    const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    
    // Route 1 & 2: Stateful Docker Containers (Terminal & Language Server)
    if (url.pathname.startsWith('/terminal/')) return await handleTerminalConnection(ws, req);
    if (url.pathname.startsWith('/ws/lsp/')) return await handleLspConnection(ws, req);

    // Route 3: Yjs Collaborative Editing
    const token = url.searchParams.get('token');
    if (!token) return ws.close(4401, 'Unauthorized');

    let decodedUser: any;
    try { decodedUser = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret'); } 
    catch (e) { return ws.close(4401, 'Invalid token'); }

    const docName = url.pathname.slice(1);
    if (!docName || docName === 'default') return setupWSConnection(ws, req, { docName });

    const match = docName.match(/^([0-9a-fA-F-]{36})(-.*)?$/) || docName.match(/^workspace-([0-9a-fA-F-]{36})$/);
    if (!match) return ws.close(4000, 'Invalid room format');
    const workspaceId = match[1];

    const wsResult = await getPool().query('SELECT owner_id, is_public FROM workspaces WHERE id = $1', [workspaceId]);
    if (!wsResult.rows.length) return ws.close(4044, 'Workspace not found');

    let role = wsResult.rows[0].owner_id === decodedUser.id ? 'admin' : null;
    if (!role) {
      const collabRes = await getPool().query('SELECT role FROM workspace_collaborators WHERE workspace_id = $1 AND user_id = $2', [workspaceId, decodedUser.id]);
      role = collabRes.rows.length ? collabRes.rows[0].role : (wsResult.rows[0].is_public ? 'viewer' : null);
    }
    if (!role) return ws.close(4403, 'Forbidden');

    // [SECURITY] CRDT Read-Only Enforcement
    // Viewers shouldn't be able to edit code. We intercept incoming WS messages at the byte level.
    // In Yjs protocol: MessageType 0 is a Sync message. Message[1] === 0 is "SyncStep1" (requesting state vector).
    // We allow SyncStep1 so they can read, but silently drop all other binary updates.
    if (role === 'viewer') {
      const originalOn = ws.on.bind(ws);
      ws.on = (event: string, listener: any) => {
        if (event === 'message') {
          return originalOn(event, (msg: any, isBin: boolean) => {
            if (isBin && msg.length > 1 && msg[0] === 0 && msg[1] !== 0) return; // Drop edits
            listener(msg, isBin);
          });
        }
        return originalOn(event, listener);
      };
    }

    setupWSConnection(ws, req, { docName });
  } catch (error) { ws.close(4500, 'Internal Server Error'); }
});

// =============================================================================
// [REAL-TIME ARCHITECTURE] SOCKET.IO (PRESENCE & WEBRTC SIGNALING)
// =============================================================================
// INTERVIEW KEY: Why use Socket.IO here but raw WebSockets above?
// Socket.IO provides built-in "Rooms" and pub/sub semantics, perfect for chat/presence.
// The raw WebSockets above are required because Yjs and XTerm.js strictly expect standard binary WS streams.
const io = new SocketIOServer(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
setIO(io);

io.use((socket, next) => {
  try {
    socket.data.user = jwt.verify(socket.handshake.auth.token, process.env.JWT_SECRET || 'fallback_secret');
    next();
  } catch { next(new Error('Auth error')); }
});

// [STATE MANAGEMENT] In-Memory Presence
// Ephemeral state. It doesn't belong in Postgres because it changes constantly and is irrelevant if the server crashes.
const workspacePresence = new Map<string, Map<string, any>>();
const PRESENCE_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899'];
const getColor = (u: string) => PRESENCE_COLORS[Math.abs([...u].reduce((h, c) => c.charCodeAt(0) + ((h << 5) - h), 0)) % PRESENCE_COLORS.length];

const broadcastPresence = (wsId: string) => io.to(`presence-${wsId}`).emit('workspace-presence-update', Array.from(workspacePresence.get(wsId)?.values() || []));

io.on('connection', (socket) => {
  // Presence Events
  socket.on('join-workspace', ({ workspaceId }) => {
    if (!socket.data.user || !workspaceId) return;
    socket.data.presenceWorkspaceId = workspaceId;
    socket.join(`presence-${workspaceId}`);
    
    if (!workspacePresence.has(workspaceId)) workspacePresence.set(workspaceId, new Map());
    workspacePresence.get(workspaceId)!.set(socket.id, { userId: socket.data.user.id, username: socket.data.user.username || 'unknown', color: getColor(socket.data.user.username || 'unknown'), activeFileId: null });
    broadcastPresence(workspaceId);
  });

  socket.on('active-file-change', ({ activeFileId }) => {
    const wsId = socket.data.presenceWorkspaceId;
    const member = workspacePresence.get(wsId)?.get(socket.id);
    if (member) { member.activeFileId = activeFileId; broadcastPresence(wsId); }
  });

  // [NETWORK ARCHITECTURE] WebRTC Signaling Relay
  // INTERVIEW KEY: Our server does NOT process audio data. We are simply a signaling broker.
  // We relay SDP Offers, Answers, and ICE Candidates between peers. Once established, audio flows P2P, saving massive bandwidth.
  socket.on('join-voice-room', async ({ workspaceId }) => {
    // Auth check omitted for brevity in summary, assumes identical logic to Yjs
    socket.join(workspaceId);
    socket.data.workspaceId = workspaceId;
    socket.to(workspaceId).emit('user-joined-voice', { socketId: socket.id, user: socket.data.user });
    socket.emit('existing-voice-users', (await io.in(workspaceId).fetchSockets()).filter(s => s.id !== socket.id).map(s => ({ socketId: s.id, user: s.data.user })));
  });

  socket.on('webrtc-offer', ({ offer, to, user }) => socket.to(to).emit('webrtc-offer', { offer, from: socket.id, user }));
  socket.on('webrtc-answer', ({ answer, to }) => socket.to(to).emit('webrtc-answer', { answer, from: socket.id }));
  socket.on('webrtc-ice-candidate', ({ candidate, to }) => socket.to(to).emit('webrtc-ice-candidate', { candidate, from: socket.id }));

  // Cleanup
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

// =============================================================================
// [LIFECYCLE] SERVER BOOT & GRACEFUL TEARDOWN
// =============================================================================
const PORT = process.env.PORT || 4000;
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    warmPoolManager.initializePools().catch(() => {});
    getPool().query('SELECT NOW()', (err) => console.log(err ? '❌ DB Connection Failed' : '✅ DB Connected'));
  });
}

// INTERVIEW KEY: Graceful Shutdown
// Trapping SIGINT/SIGTERM ensures that if Kubernetes or Docker restarts the backend, 
// we synchronously tear down all active Docker execution containers to prevent zombie resource leaks.
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

export { app, server };