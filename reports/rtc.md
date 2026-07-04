<!-- MERGED FROM: real_time_collaboration_deep_dive.md -->

# Deep Dive: Real-Time Collaboration in the Sandbox IDE

To build a "Google Docs for Code" experience, the application must handle multiple users typing in the exact same file at the exact same millisecond. This document explores the deep technical details of how we achieve this using **Yjs** and **CRDTs**.

---

## 1. The Core Problem: Concurrent Editing

Imagine User A and User B both have the file `server.ts` open.
- The file contains the string: `const port = 3000;`
- User A deletes `3000` and types `4000`.
- User B (simultaneously) changes `const` to `let`.

If we just used plain WebSockets to send the entire file state back and forth, one user's version would completely overwrite the other's, destroying data. If we sent indices (e.g., "insert 'let' at index 0"), network latency could mean the indices shift by the time the message arrives, corrupting the code.

---

## 2. The Contenders: OT vs. CRDTs

Historically, there are two ways to solve this synchronization problem:

### Operational Transformation (OT)
Used famously by Google Docs.
- **How it works:** It requires a central server. When two operations collide, the server actively "transforms" the operations mathematically before sending them back to the clients so that indices match up.
- **The flaw:** It is incredibly complex to build, requires a heavy central server to dictate the "truth," and struggles if users go offline for long periods and try to reconnect.

### Conflict-Free Replicated Data Types (CRDTs)
This is what **Yjs** uses, and it represents the modern standard for collaborative apps (Figma, Notion, VS Code Live Share).
- **How it works:** The math is embedded into the data structure itself. Instead of relying on a central server to mediate conflicts, CRDT algorithms guarantee that as long as two clients receive the same set of updates (in *any* order), their documents will perfectly converge to the exact same state.
- **Why we chose it:** It is decentralized (peer-to-peer capable), natively supports offline editing (when a user reconnects, the missing updates just merge flawlessly), and is much lighter on our backend infrastructure.

---

## 3. How Yjs Works Under the Hood

When you create a `Y.Text` object in Yjs (representing the source code in Monaco Editor), it is not just a standard string.

### The Linked List Model
Under the hood, Yjs represents the text document as a highly optimized **Doubly-Linked List**. 
Instead of treating "Hello" as a 5-character string, it treats it as a list of individually identifiable characters: `[H] <-> [e] <-> [l] <-> [l] <-> [o]`.

Every single character inserted into the document is assigned a **unique ID**, which consists of:
1. **Client ID:** A unique number identifying the specific user who typed it.
2. **Clock:** A logical timestamp (an incrementing counter) for that client.

### Resolving Conflicts
If two users try to insert a character at the exact same location (e.g., both hit `Enter` at the end of a line simultaneously), Yjs uses a deterministic algorithm to decide which character goes first. Because every client follows the exact same algorithm using the unique Client IDs, everyone's screen resolves the conflict in the exact same way. Nobody's data is lost; it might just be placed sequentially.

---

## 4. Our IDE Architecture: Yjs + y-websocket

Here is how the collaboration flows in our architecture:

1. **The Client (Monaco Editor):**
   We use a binding library (`y-monaco`) that connects the Monaco Editor instance to a `Y.Text` type. Every time you hit a key, `y-monaco` instantly translates that keystroke into a Yjs update and applies it locally.

2. **The Network (`y-websocket`):**
   The moment the local `Y.Text` changes, the `y-websocket` provider calculates a binary "delta" (only the exact characters that changed, not the whole file). It sends this tiny binary message over a WebSocket to our Node.js server.

3. **The Server (`backend/src/server.ts`):**
   Our Express server runs a WebSocket server. When it receives a binary update from User A, it doesn't even need to understand what the code is! It simply acts as a **dumb router**, broadcasting that exact binary message to User B, User C, and anyone else in the same "room" (the file's room).

4. **Persistence (PostgreSQL):**
   When the last person leaves the room (or periodically), the server takes the fully merged Yjs document state and saves it into our PostgreSQL database in the `files` table under the `yjs_state` column. It is saved as `BYTEA` (binary data) rather than plain text. This ensures that the next time someone opens the file, they load the entire CRDT history, preserving the ability to merge future offline edits seamlessly.


<!-- MERGED FROM: server.md -->

# Server Deep Dive: Yjs Persistence & WebSockets

This report breaks down the complex block of code in `server.ts` that handles real-time collaboration and database persistence. We'll explore it from first principles.

## 1. The Core Infrastructure

```javascript
// Create HTTP server to attach WebSocket server to
const server = http.createServer(app);
```

**First Principle:** WebSockets don't exist in a vacuum. They start as standard HTTP requests.
Normally, your Express `app` handles HTTP requests (GET, POST, etc.). By wrapping `app` in `http.createServer`, we gain access to the raw underlying Node.js server. We need this raw server so we can listen for "Upgrade" requests—the moment when a browser says, "I don't want to talk HTTP anymore; let's switch to a continuous WebSocket connection."

---

## 2. The Persistence Layer (Saving Data)

Yjs is an in-memory data structure (a CRDT). If your server crashes or restarts, all data in RAM is wiped out. `setPersistence` tells the `y-websocket` utility how to interact with a permanent hard drive (your PostgreSQL database) so data survives restarts.

### Part A: `bindState` (Loading Data)

```javascript
bindState: async (docName: string, ydoc: Y.Doc) => {
  const match = docName.match(/^([0-9a-fA-F-]{36})-([0-9a-fA-F-]{36})$/);
  // ... (Database loading logic)
}
```

**What happens here?**
When the *very first user* connects to a specific file (e.g., `workspaceId-fileId`), `y-websocket` creates a fresh, empty Yjs document (`ydoc`) in the server's memory. Before anyone can type, the server needs to load the saved code from the database into this empty document. 

1. **Extracting IDs:** The `docName` is the name of the WebSocket room (which we set up later to be `${workspaceId}-${fileId}`). We use a Regex match to extract the specific UUID of the file.
2. **Querying the DB:** We ask Postgres for both `content` (plain text) and `yjs_state` (the binary CRDT history).
3. **Hydrating the Document:**
   - **If `yjs_state` exists:** We use `Y.applyUpdate`. This restores the exact, mathematically perfect history of the document so users can keep collaborating seamlessly.
   - **If only `content` exists:** (Like when a file is newly created), we manually insert the raw text into the document using `ydoc.getText('monaco').insert(0, content)`.

### Part B: `writeState` (Saving Data)

```javascript
writeState: async (docName: string, ydoc: Y.Doc) => {
  // ... (Regex extraction)
  const state = Y.encodeStateAsUpdate(ydoc);
  const content = ydoc.getText('monaco').toString();
  await getPool().query(
    'UPDATE files SET yjs_state = $1, content = $2 WHERE id = $3',
    [Buffer.from(state), content, fileId]
  );
}
```

**What happens here?**
Whenever a user types a character, `y-websocket` calls `writeState` to save the change.

1. **`Y.encodeStateAsUpdate(ydoc)`:** This squashes the entire Yjs memory structure into an optimized, highly-compressed binary format (represented by `Uint8Array`).
2. **`ydoc.getText('monaco').toString()`:** This extracts the human-readable plain text version of the code. 
3. **Database Update:** We save *both* fields to Postgres. We save the binary `state` into the `yjs_state` column (using `Buffer.from` to convert it to Postgres `BYTEA`), and the plain text into the `content` column. 

> [!TIP]
> **Why save both?** We save the binary state so Yjs can perfectly reconstruct the collaboration history. We save the plain text `content` so we can easily read the code from the database later (for example, if we want to run the code via the execute endpoint without booting up a Yjs instance).

---

## 3. The WebSocket Server

```javascript
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const docName = req.url?.slice(1).split('?')[0] || 'default';
  setupWSConnection(ws, req, { docName });
}); 
```

**First Principle:** WebSockets are persistent, two-way pipes.

1. **`new WebSocketServer({ server })`:** This creates the WebSocket listener and attaches it to the raw Node.js HTTP server we created in Step 1. It is now listening for those "Upgrade" requests.
2. **`wss.on('connection', ...)`:** This event fires the exact millisecond a user's browser successfully opens a WebSocket connection.
3. **Synchronized URLs:** The browser URL and the WebSocket URL are now tightly synchronized to prevent confusion and allow direct file sharing:
   - **Your Browser URL:** `http://localhost:5173/ide/workspaceId/fileId`
   - **The WebSocket URL:** When you navigate to that browser URL, `CodeEditor.tsx` extracts the IDs and opens a WebSocket connection to `ws://localhost:4000/workspaceId-fileId`.
   - On the backend, `req.url` looks like `"/workspaceId-fileId"`.
   - `.slice(1)` removes the leading slash, leaving `"workspaceId-fileId"`. This becomes our `docName` (the isolated room name just for that specific file).
4. **`setupWSConnection`:** This is a magic function provided by the `y-websocket` library. It takes over from here. It puts the user into the `docName` room, triggers the `bindState` function if they are the first user to arrive, and starts bouncing their keystrokes to anyone else in the same room.


<!-- MERGED FROM: websockets.md -->

# Deep Dive: WebSockets in the Sandbox IDE

To build a real-time Collaborative Cloud IDE, we need a way for the server and multiple clients to talk to each other instantly. Traditional web requests (HTTP) are not fast or efficient enough for this. This document explores the mechanics of **WebSockets** and how they power our application.

---

## 1. The Problem with HTTP (Polling)

The standard protocol of the web is **HTTP**. HTTP is strictly a **Request-Response** protocol:
1. The client (browser) asks a question: *"Give me the latest file content."*
2. The server answers: *"Here is the content."*
3. The connection immediately closes.

If User A types a character, the server knows about it. But User B won't see it until User B's browser explicitly asks the server for updates. 

Historically, apps used **Short Polling** (asking the server every 1 second, "Any updates?") or **Long Polling** (holding the request open). 
* **The Flaw:** This is incredibly inefficient. It creates massive network overhead because every HTTP request requires opening a new TCP connection, sending heavy HTTP headers (cookies, user-agents), and parsing the response. It introduces unacceptable latency for real-time typing.

---

## 2. The Solution: WebSockets (Full-Duplex)

**WebSockets (ws:// or wss://)** solve this by providing a **persistent, full-duplex communication channel** over a single TCP connection.

* **Persistent:** The connection stays open indefinitely until the client or server explicitly closes it.
* **Full-Duplex:** Both the client and the server can send messages to each other at the exact same time, independently. The server can *push* data to the client without the client ever asking for it.
* **Low Overhead:** Once established, messages are sent as tiny binary or text frames (often just a few bytes) without the heavy HTTP headers.

### The Handshake (How a WebSocket Starts)
WebSockets actually start their life as a standard HTTP request! 
1. The browser sends an HTTP `GET` request to the server with a special header: `Connection: Upgrade` and `Upgrade: websocket`.
2. If the server supports WebSockets, it replies with an `HTTP 101 Switching Protocols` status code.
3. The HTTP protocol is stripped away, and the underlying TCP socket is kept alive and handed over to the WebSocket protocol.

---

## 3. Why WebSockets are Critical for Our IDE

We rely on WebSockets for two massive features in our Sandbox IDE:

### A. Real-Time Collaboration (Yjs)
As discussed in the CRDT deep dive, when you type, your browser calculates a tiny binary "delta" representing your keystroke. 
Instead of making an HTTP `POST` request for every single keystroke, the binary delta is pushed instantly over the WebSocket. The server receives it and instantly pushes it down the WebSockets of all other users in the same room. This results in sub-50ms synchronization, making it feel like everyone is typing on the same computer.

### B. The Remote Terminal (Docker Integration)
When you open the terminal in the IDE, you are actually typing into a bash shell running inside an isolated Docker container on our backend.
* When you press `ls` and hit Enter, those characters are streamed over a WebSocket to the server, which pipes them into the Docker container's `stdin`.
* When the Docker container spits out the directory list, the server captures that `stdout`, pipes it back over the WebSocket, and `Xterm.js` renders it on your screen.
* WebSockets are the *only* way to stream this continuous flow of I/O efficiently.

---

## 4. Implementation in our Backend

In our Node.js backend, we use the `ws` library (a fast, unopinionated WebSocket implementation).

Here is conceptually how it integrates with our Express server (`backend/src/server.ts`):

1. We create a standard HTTP server using Express to handle our REST API (e.g., login, fetching the file tree).
2. We create a `WebSocket.Server` instance.
3. We "attach" the WebSocket server to the same underlying HTTP server. This allows them to share the same port (e.g., Port 4000). 
4. When a request comes in on Port 4000, Node.js checks: "Is this an HTTP Upgrade request?" 
   * If yes, it hands it to the WebSocket server (`ws`).
   * If no, it hands it to the Express router to process as a normal REST API request.