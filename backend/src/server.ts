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

const app = express();
app.use(cors());
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
const docs = getDocsMap();

setupWebSocketServer(server);

const io = new SocketIOServer(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
setIO(io);

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

const gracefulShutdown = async (): Promise<void> => {
   if (process.env.NODE_ENV !== 'test') {
      await Promise.all([
         warmPoolManager.cleanup().catch(() => {}),
         cleanupAllWorkspaceContainers().catch(() => {})
      ]);
      process.exit(0);
   }
};
process.on('SIGINT', () => { gracefulShutdown().catch(() => {}); });
process.on('SIGTERM', () => { gracefulShutdown().catch(() => {}); });

export { app, server, docs };