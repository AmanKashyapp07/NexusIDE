import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import http from 'http';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { getPool } from './db';
// @ts-ignore
import { setupWSConnection } from 'y-websocket/bin/utils';
import workspaceRoutes from './routes/workspace';
import authRoutes from './routes/auth';
import { requireAuth } from './middleware/auth';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/workspace', requireAuth, workspaceRoutes);

const server = http.createServer(app);

// WebSocket server for Yjs
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  // Extract docName from the URL
  const docName = req.url?.slice(1).split('?')[0] || 'default';
  setupWSConnection(ws, req, { docName });
});

const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  // Test Database Connection
  getPool().query('SELECT NOW()', (err, res) => {
    if (err) {
      console.error('❌ Failed to connect to PostgreSQL Database:', err.message);
    } else {
      console.log('✅ Successfully connected to PostgreSQL Database!');
    }
  });
});
