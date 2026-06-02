import dotenv from 'dotenv'; // Load environment variables from .env file into process.env
dotenv.config();

import express from 'express';
import http from 'http';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { getPool } from './db';
import * as Y from 'yjs';
// y-websocket utility functions for handling Yjs document connections
// yjs is basically a CRDT library for real-time collaboration, and y-websocket is a simple WebSocket server that syncs Yjs documents between clients. We use its built-in persistence hooks to save/load document state from our PostgreSQL database.
// @ts-ignore - No types available for y-websocket's utils module, so we ignore TypeScript errors here
import { setupWSConnection, setPersistence } from 'y-websocket/bin/utils';
import workspaceRoutes from './routes/workspace';
import authRoutes from './routes/auth';
import { requireAuth } from './middleware/auth';

const app = express(); // Basic middleware
// express() creates an Express application, which is a web server framework for Node.js. We use it to define our API routes and middleware. The app will handle HTTP requests, while the WebSocket server will handle real-time communication for document syncing.

app.use(cors());
// cors() enables Cross-Origin Resource Sharing, allowing our frontend (which may be served from a different origin) to make API requests to this backend without being blocked by the browser's same-origin policy.

app.use(express.json());
// express.json() is built-in middleware that parses incoming JSON request bodies and makes them available on req.body. This is essential for our API routes, which expect JSON input for things like authentication and workspace management.

// API routes
app.use('/api/auth', authRoutes);
// Protect workspace routes with authentication middleware
app.use('/api/workspace', requireAuth, workspaceRoutes);

// Create HTTP server to attach WebSocket server to
const server = http.createServer(app);

// Configure persistence handlers for Yjs documents
// `bindState` loads persisted state (Yjs update or raw content) into the Y.Doc, which basically means when a client connects to a Yjs document, we check if we have a saved state for that document in the database. If we do, we load it into the Y.Doc instance so the client can sync with it. We support both the full Yjs binary state (if available) and fallback to plain text content for older documents that haven't been updated since we added Yjs support.
// `writeState` saves the current Yjs state and plain content back to the DB, which basically means whenever a client makes changes to a Yjs document, we encode the full state as a binary update and also save the plain text content to the database. This way we can restore the document state later when clients reconnect or new clients join.
setPersistence({
  bindState: async (docName: string, ydoc: Y.Doc) => {
    const match = docName.match(/^([0-9a-fA-F-]{36})-([0-9a-fA-F-]{36})$/);
    if (match) {
      const fileId = match[2];
      try {
        const res = await getPool().query('SELECT content, yjs_state FROM files WHERE id = $1', [fileId]);
        if (res.rows.length > 0) {
          const { content, yjs_state } = res.rows[0];
          // Prefer Yjs binary state if available, otherwise seed with plain text
          if (yjs_state) {
            Y.applyUpdate(ydoc, yjs_state);
          } else if (content) {
            ydoc.getText('monaco').insert(0, content);
          }
        }
      } catch (err) {
        console.error('Error loading state from DB:', err);
      }
    }
  },
  writeState: async (docName: string, ydoc: Y.Doc) => {
    const match = docName.match(/^([0-9a-fA-F-]{36})-([0-9a-fA-F-]{36})$/);
    if (match) {
      const fileId = match[2];
      try {
        // Encode full Yjs state as an update and also persist the plain text
        const state = Y.encodeStateAsUpdate(ydoc);
        const content = ydoc.getText('monaco').toString();
        await getPool().query(
          'UPDATE files SET yjs_state = $1, content = $2 WHERE id = $3',
          [Buffer.from(state), content, fileId]
        );
      } catch (err) {
        console.error('Error writing state to DB:', err);
      }
    }
  }
});

// WebSocket server used by y-websocket to sync Yjs documents in real-time
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  // Extract the Yjs document name from the request URL (strip leading '/')
  const docName = req.url?.slice(1).split('?')[0] || 'default';
  // Delegate the socket to y-websocket's connection handler
  setupWSConnection(ws, req, { docName });
});  

const PORT = process.env.PORT || 4000;

// Start HTTP (and WebSocket) server
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  // Quick sanity-check: ensure DB connection works
  getPool().query('SELECT NOW()', (err, res) => {
    if (err) {
      console.error('❌ Failed to connect to PostgreSQL Database:', err.message);
    } else {
      console.log('✅ Successfully connected to PostgreSQL Database!');
    }
  });
});

// if we just use plain web sockets without y-websocket, we would have to implement all the logic for syncing document state between clients, handling conflicts, and persisting changes ourselves. By using y-websocket, we can leverage its built-in CRDT-based syncing and persistence hooks, which simplifies our implementation and ensures robust real-time collaboration with minimal custom code.

// if we sent indices instead of the full Yjs state, we would have to implement additional logic to track and manage those indices across clients, which can get complex and error-prone. By sending the full Yjs state as a binary update, we can rely on Yjs's efficient encoding and conflict resolution mechanisms to handle syncing between clients without worrying about index management.

// so to solve this problem, we have two solutions OT and CRDT. OT (Operational Transformation) is a technique that transforms operations based on the context of other operations, while CRDT (Conflict-free Replicated Data Type) is a data structure that allows for concurrent updates without conflicts. Yjs uses CRDTs to enable real-time collaboration without the need for complex transformation logic, making it easier to implement and maintain, making these ourselves is way more complex and error-prone, especially as the number of clients and operations increases. By using Yjs and y-websocket, we can leverage their built-in CRDT-based syncing and persistence hooks, which simplifies our implementation and ensures robust real-time collaboration with minimal custom code.

// OT - used by google docs, it is basically a way to transform operations based on the context of other operations. For example, if two users are editing the same document at the same time, OT would transform their operations so that they can be applied in a consistent order. However, OT can get complex and error-prone as the number of clients and operations increases, especially when dealing with network latency and conflicts. for knowledge, when two operations conflict (e.g., two users insert text at the same position), OT would transform one of the operations to ensure that both changes are preserved and the document remains consistent. This can lead to complex transformation logic, especially in scenarios with many concurrent edits. For eg if user A inserts "Hello" at position 0 and user B inserts "World" at position 0 at the same time, OT would transform one of the operations (e.g., user B's insert) to position 5, resulting in a consistent document state of "HelloWorld" regardless of the order in which the operations are received. However, as the number of clients and operations increases, managing these transformations can become increasingly complex and error-prone. Major flaw is that it relies on a central server to manage the transformations, which can become a bottleneck and single point of failure in large-scale applications.

// CRDT - used by yjs, it is a data structure that allows for concurrent updates without conflicts. Each client maintains its own copy of the document and can make changes independently. When clients sync with each other, they exchange their changes and merge them using the CRDT algorithm, which ensures that all changes are preserved and the document remains consistent across all clients. This approach eliminates the need for complex transformation logic and allows for robust real-time collaboration even in scenarios with many concurrent edits and network latency. For eg if user A inserts "Hello" at position 0 and user B inserts "World" at position 0 at the same time, both changes would be preserved in the CRDT, resulting in a consistent document state of "HelloWorld" regardless of the order in which the operations are received. Additionally, since each client maintains its own copy of the document, there is no reliance on a central server to manage transformations, making CRDTs more scalable and resilient in large-scale applications.

// for interview questions, just remember that CRDT is a data structure that allows for concurrent updates without conflicts, while OT is a technique that transforms operations based on the context of other operations. Yjs uses CRDTs to enable real-time collaboration without the need for complex transformation logic, making it easier to implement and maintain