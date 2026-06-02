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

// when user opens a code workspace, the browser establishes a WebSocket connection to the backend's y-websocket server, specifying the document name (which is based on the file ID). The y-websocket server then uses the bindState function to load any existing Yjs state for that document from the database and initializes a Y.Doc instance with that state. As the user makes changes to the code, those changes are synced in real-time with the backend using Yjs's CRDT algorithm. Whenever there are updates to the Y.Doc (either from the user or from other connected clients), the writeState function is called to persist the current state back to the database, ensuring that all changes are saved and can be restored later when clients reconnect or new clients join.

// yjs_state column in the database is used to store the full Yjs state of a document as a binary update. This allows us to efficiently save and restore the entire document state, including all concurrent changes made by different users. When a client connects to a Yjs document, we check if there is a saved yjs_state for that document in the database. If there is, we load it into the Y.Doc instance using Y.applyUpdate, which ensures that the client syncs with the most up-to-date state of the document. Whenever there are changes to the Y.Doc (either from the user or from other connected clients), we encode the full state as a binary update and save it back to the yjs_state column in the database. This way, we can restore the document state later when clients reconnect or new clients join, ensuring that all changes are preserved and consistent across all clients, so basically, yjs_state holds history of changes and allows us to restore the document to its current state whenever needed, enabling robust real-time collaboration.

//if we only save content without the yjs_state, we would lose the ability to restore the document to its current state when clients reconnect or new clients join. This is because the plain text content does not capture the full history of changes and concurrent edits made by different users. Without the yjs_state, we would only have the latest content, and any changes made by other users that haven't been saved as plain text would be lost. This would lead to inconsistencies and potential data loss in a collaborative editing scenario, as clients would not be able to sync with the most up-to-date state of the document. By saving the full Yjs state as a binary update in the yjs_state column, we ensure that all changes are preserved and can be restored later, enabling robust real-time collaboration.

//we can't pull content every second because it would be inefficient and could lead to performance issues, especially as the number of clients and changes increases. Instead, we rely on Yjs's CRDT algorithm to sync changes in real-time between clients and the backend. Whenever there are updates to the Y.Doc (either from the user or from other connected clients), we call the writeState function to persist the current state back to the database. This way, we only save changes when they occur, rather than continuously pulling content, which allows for efficient and scalable real-time collaboration without overwhelming the server or database with unnecessary requests.

//when 2nd user updates a file content, yjs_state changes, then writeState is called, which saves the new yjs_state to the database. When the 1st user makes another change, their client syncs with the backend and receives the updated yjs_state, which includes the changes made by the 2nd user. This ensures that both users see a consistent and up-to-date view of the document, allowing for seamless real-time collaboration without conflicts or data loss.

// when user-2 types x at end of line, there will be changes in two phases:
// 1. user-2's client updates its local Y.Doc with the new change (inserting 'x' at the end of the line). This triggers an update event in the Y.Doc, which causes the writeState function to be called. The writeState function encodes the full Yjs state as a binary update and saves it to the yjs_state column in the database, along with the updated plain text content, also, raw binary byte stream is fired to the backend, which is received by the y-websocket server and applied to the Y.Doc instance on the server side. This ensures that the server has the most up-to-date state of the document, including the change made by user-2.
// 2. user-1's client is subscribed to changes in the Y.Doc and receives the updated yjs_state from the backend. The client applies this update to its local Y.Doc instance, which incorporates the change made by user-2 (inserting 'x' at the end of the line). As a result, user-1 sees the new character 'x' appear in their editor in real-time, reflecting the change made by user-2 without any conflicts or data loss.  This seamless syncing of changes between clients is made possible by Yjs's CRDT algorithm, which ensures that all changes are preserved and merged correctly, allowing for robust real-time collaboration even in scenarios with many concurrent edits and network latency.

// Y.Doc is the core data structure in Yjs that represents a shared document. It is a CRDT (Conflict-free Replicated Data Type) that allows for concurrent updates without conflicts. The Y.Doc instance maintains the state of the document and handles syncing changes between clients and the backend. When a client makes changes to the document, those changes are applied to the Y.Doc instance, which then triggers events that allow us to persist the updated state to the database and sync it with other connected clients in real-time. The Y.Doc provides an efficient way to manage collaborative editing scenarios, ensuring that all changes are preserved and merged correctly across all clients.