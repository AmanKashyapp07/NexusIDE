import express from 'express';
import http from 'http';
import cors from 'cors';
import { WebSocketServer } from 'ws';
// @ts-ignore
import { setupWSConnection } from 'y-websocket/bin/utils';
import workspaceRoutes from './routes/workspace';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/workspace', workspaceRoutes);

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
});
