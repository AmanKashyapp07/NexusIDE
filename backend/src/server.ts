/**
 * Purpose: Main application entry point for the NexusIDE backend server.
 * High-Level Architecture: Operates as an HTTP/REST server (Express) and WebSockets/Socket.IO broker, orchestrating live collaboration, proxying, container pool warming, and database connection verification.
 * Primary Trade-offs: Decoupled transport layers (Socket.IO for ephemeral presence/cursor sync, Raw WebSockets for Yjs CRDTs & PTY streams) to isolate real-time state machine overhead from low-latency event channels.
 * Complexity: O(1) boot and routing overhead per connection request.
 */

import './disable-logs.js';
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import http from 'http';
import cors from 'cors';
import compression from 'compression';
import { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';

import workspaceRoutes from './routes/workspace.js';
import authRoutes from './routes/auth.js';
import { requireAuth } from './middleware/auth.js';
import { setIO } from './socket.js';
import { getPool } from './db.js';
import { warmPoolManager } from './sandbox/pool.js';
import { cleanupAllWorkspaceContainers } from './sandbox/workspaceContainer.js';
import { getDocsMap } from './docsRegistry.js';
import { log } from './services/logger.service.js';
import { setupSocketPresenceHandlers } from './services/socketPresence.service.js';
import { setupWebSocketServer } from './services/websocketServer.service.js';
import { initializeRedisCollaborationMesh } from './services/redisAdapter.service.js';
import { crdtWriteBehindService } from './services/crdtWriteBehind.service.js';

// =============================================================================
// EXPRESS APPLICATION INITIALIZATION & MIDDLEWARE SETUP
// =============================================================================

// INTENT: Initialize Express server instance with production-grade middleware.
// WHY: Middlewares handle cross-origin resource sharing, payload compression, and authentication pre-flighting.
// INTERVIEW NOTES: Compression level 6 strikes an optimal CPU-to-bandwidth trade-off for text-heavy JSON payloads.
const app = express();
app.use(cors());

// INTENT: Configure response compression with explicit WebSockets upgrade bypass.
// WHY: Compressing WebSocket handshakes or upgraded connections can corrupt framing headers or cause unnecessary buffer delays.
// EDGE CASE: If a connection header contains 'upgrade', bypass compression entirely to prevent socket upgrade failure.
app.use(compression({
   level: 6,
   threshold: 1024,
   filter: (req: unknown, res: unknown) => {
      const expressReq = req as { headers?: Record<string, string> };
      if (expressReq.headers?.['upgrade']) return false;
      return compression.filter(req as express.Request, res as express.Response);
   }
}));
app.use(express.json());

// INTENT: Reverse-proxy asset redirection for sandbox preview URLs.
// WHY: Allows relative asset fetches within embedded preview iFrames to route back to the sandbox host container port.
// EDGE CASE: Preserves original URL query parameters while matching workspace preview path tokens.
app.use((req, res, next) => {
   if (req.path.startsWith('/api/workspace')) return next();
   const referer = req.headers.referer;
   if (referer) {
      const match = referer.match(/\/api\/workspace\/([^\/]+)\/preview/);
      if (match) {
         const prefix = referer.includes('/ide/') ? '/ide' : '';
         return res.redirect(`${prefix}/api/workspace/${match[1]}/preview${req.originalUrl}`);
      }
   }
   next();
});

// =============================================================================
// REST API ROUTE REGISTRATION
// =============================================================================

// INTENT: Mount authentication and workspace resource controllers.
// WHY: Isolates unauthenticated OAuth/login routes from JWT-protected workspace resources.
app.use(['/auth', '/api/auth', '/ide/api/auth'], authRoutes);
app.use(['/workspace', '/api/workspace', '/ide/api/workspace'], requireAuth, workspaceRoutes);

// =============================================================================
// HTTP & WEBSOCKET SERVER CREATION & ROUTING SETUP
// =============================================================================

// INTENT: Create shared underlying Node.js HTTP server.
// WHY: Allows Express REST routes and raw WebSocket upgrade listeners to share a single TCP port.
// INTERVIEW NOTES: Single-port multiplexing simplifies firewall rules and reverse proxy deployments (Nginx/Traefik).
const server = http.createServer(app);
const docs = getDocsMap();

// INTENT: Attach raw WebSocket server handlers for Yjs CRDTs, terminal PTYs, and LSP language server connections.
setupWebSocketServer(server);

// =============================================================================
// SOCKET.IO REAL-TIME PRESENCE CHANNEL SETUP
// =============================================================================

// INTENT: Initialize Socket.IO instance for lightweight, low-latency awareness & presence events.
// WHY: Socket.IO handles automatic fallback, reconnection buffering, and room broadcast channels for user cursors and file tree updates.
const io = new SocketIOServer(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
setIO(io);

// INTENT: Enforce JWT authentication on incoming Socket.IO handshake packets.
// WHY: Prevents unauthorized clients from joining presence channels or sniffing user active status.
// EDGE CASE: Invalid tokens immediately reject socket connection with an authentication error prior to socket listener attachment.
io.use((socket, next) => {
   try {
      socket.data.user = jwt.verify(socket.handshake.auth.token as string, process.env.JWT_SECRET || 'fallback_secret');
      next();
   } catch { 
      next(new Error('Auth error')); 
   }
});

io.on('connection', (socket) => {
   setupSocketPresenceHandlers(io, socket);
});

// =============================================================================
// SERVER BOOTSTRAPPING & PROCESS LIFECYCLE MANAGEMENT
// =============================================================================

// INTENT: Bootstrap HTTP server, verify database connectivity, and pre-warm container sandbox pools.
// WHY: Async pre-warming container pools during server boot eliminates cold-start latency for the first user workspace allocation.
// INTERVIEW NOTES: Non-blocking boot cycle guarantees fast server readiness; pool initialization occurs in background promises.
const PORT = process.env.PORT || 4000;
if (process.env.NODE_ENV !== 'test') {
   server.listen(PORT, () => {
      log('🚀 BOOT', `Server listening on port ${PORT}`);
      initializeRedisCollaborationMesh();
      crdtWriteBehindService.startWriteBehindWorker(1000);
      warmPoolManager.initializePools().catch(() => {});
      getPool().query('SELECT NOW()', (err) => {
         log('🚀 BOOT', err ? '❌ DB Connection Failed' : '✅ DB Connected');
      });
   });
}

// INTENT: Execute graceful shutdown sequence upon process termination signals (SIGINT/SIGTERM).
// WHY: Prevents container leaks, tears down active Docker containers, flushes Redis write-behind buffers, and flushes database pool handles cleanly.
const gracefulShutdown = async (): Promise<void> => {
   if (process.env.NODE_ENV !== 'test') {
      crdtWriteBehindService.stopWriteBehindWorker();
      await Promise.all([
         crdtWriteBehindService.flushAllDirtyBuffers().catch(() => {}),
         warmPoolManager.cleanup().catch(() => {}),
         cleanupAllWorkspaceContainers().catch(() => {})
      ]);
      process.exit(0);
   }
};
process.on('SIGINT', () => { gracefulShutdown().catch(() => {}); });
process.on('SIGTERM', () => { gracefulShutdown().catch(() => {}); });

export { app, server, docs };