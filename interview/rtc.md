# Real-Time Collaboration & Conflict Resolution: Deep Dive & First Principles

This document provides a highly technical, first-principles architectural breakdown of the Real-Time Collaboration (RTC) and Conflict Resolution engine built for this collaborative IDE. It acts as an advanced study guide for technical interviews, focusing on Yjs, WebSockets, CRDTs, and state synchronization.

---

## 1. Conflict Resolution: OT vs. CRDTs

When multiple users edit the same document concurrently, the system must guarantee **Strong Eventual Consistency (SEC)**: all users must converge on the exact same document state once all modifications are propagated.

Two main paradigms exist for conflict resolution in distributed collaborative systems: **Operational Transformation (OT)** and **Conflict-free Replicated Data Types (CRDTs)**.

### A. Operational Transformation (OT)
Historically used by Google Docs and Apache Wave.
*   **Mechanism**: Operations (e.g., `insert(index, char)`) are sent to a central server. If client A inserts `'x'` at index 3 while client B deletes the character at index 3 concurrently, the server "transforms" Client B's operation index relative to Client A's operation to make sure they match.
*   **Mathematical Constraint**: Requires satisfying the **Transformation Properties (TP1 & TP2)**:
    - **TP1**: For any two operations $O_1$ and $O_2$, $O_1 \circ T(O_2, O_1) \equiv O_2 \circ T(O_1, O_2)$.
    - **TP2**: If three concurrent operations are executed, the sequence of transformations must commute.
*   **Drawbacks**: 
    - TP2 is notoriously complex to implement correctly. Almost all OT implementations require a **centralized server** to act as the single source of truth and order operations.
    - OT does not easily scale to decentralized (peer-to-peer) or serverless architectures.

### B. Conflict-Free Replicated Data Types (CRDTs)
Used by this project (via Yjs).
*   **Mechanism**: Instead of transforming operations, the document state itself is modeled as a mathematical structure where concurrent operations naturally commute, associate, and are idempotent.
*   **Mathematical Constraint (Lattice Theory)**: A state-based CRDT represents a **Bounded Join-Semilattice**. A merge operation ($\sqcup$) combines states $X$ and $Y$ and must satisfy:
    1.  **Commutativity**: $X \sqcup Y = Y \sqcup X$ (Order of updates doesn't matter).
    2.  **Associativity**: $(X \sqcup Y) \dots \sqcup Z = X \sqcup (Y \dots \sqcup Z)$ (Grouping of updates doesn't matter).
    3.  **Idempotency**: $X \sqcup X = X$ (Duplicate delivery of updates doesn't affect state).
*   **How Yjs Implements CRDTs**: 
    Yjs models the text document as a double-linked list of **Item blocks**. Each character or text block is assigned a unique identifier consisting of a `(client, clock)` tuple (where `client` is a unique user ID and `clock` is an incrementing logical timestamp).
    - When User A inserts text, Yjs inserts a block referencing the ID of the block directly preceding it.
    - If User B concurrently inserts text after the same block, Yjs resolves the conflict deterministically by comparing the `client` identifiers (higher client ID wins the left-to-right sorting order).
    - Blocks are never truly deleted from the CRDT history; they are marked as "tombstones" so references don't break, and are compressed dynamically.

---

## 2. State Vector Synchronization & Storage

Sending the entire document state on every keystroke is highly inefficient. Yjs uses **State Vectors** and **Update Diffs** to keep traffic light.

### A. State Vectors & Diffs
A **State Vector** is a dictionary mapping each active client to its highest acknowledged logical clock:
$$\text{State Vector} = \{ \text{Client}_1: \text{Clock}_1, \text{Client}_2: \text{Clock}_2, \dots \}$$

When a client establishes a connection to sync a document:
1.  **Handshake**: Client sends its local State Vector to the server.
2.  **Diff Computation**: The server compares the client's vector against its own. For instance, if the server has $\{ A: 10, B: 5 \}$ and the client sent $\{ A: 8, B: 5 \}$, the server knows the client is missing operations $9$ and $10$ from Client A.
3.  **Update Generation**: The server generates a binary update containing *only* the missing items and streams it to the client.
4.  **Application**: The client applies the binary update. The CRDT states merge cleanly.

### B. PostgreSQL Persistence (`yjs_state BYTEA`)
To maintain persistence without losing CRDT integrity:
- **Binary Format (`BYTEA`)**: We store the raw serialized Yjs document update as a binary array (`BYTEA`) under the `yjs_state` column of the `files` table.
- **Bootstrapping**: When the first client connects to a file, the Node.js server queries the DB:
  ```sql
  SELECT content, yjs_state FROM files WHERE id = $1
  ```
  If `yjs_state` is present, it initializes a memory-based `Y.Doc` using:
  ```typescript
  Y.applyUpdate(ydoc, yjs_state);
  ```
- **Debounced / Teardown Persist**: While editing is hot, updates are buffered in memory for performance. When the last client disconnects from the WebSocket connection, the final `Y.Doc` state is serialized to a Uint8Array buffer and committed back to the database:
  ```typescript
  const stateUpdate = Y.encodeStateAsUpdate(ydoc);
  // UPDATE files SET yjs_state = $1, content = $2 WHERE id = $3
  ```

---

## 3. WebSocket Protocol & Presence Management

WebSockets provide the low-latency, full-duplex TCP transport layer required for real-time interaction. In this project, we wrap our Express server to upgrade WebSocket connections for custom namespaces.

```
Client (WebsocketProvider)                              Server (server.ts)
           │                                                    │
           ├──────────── HTTP UPGRADE REQUEST ─────────────────→│
           │        Headers: Connection: Upgrade, etc.          │
           │                                                    │
           │←─────────── 101 SWITCHING PROTOCOLS ───────────────┤ (Handshake Complete)
           │                                                    │
           │                                                    │
           ├──────────── y-websocket Sync Protocol ─────────────→│
           │  1. Send Local State Vector                        │
           │                                                    │
           │←─────────── 2. Reply with missing diffs ───────────┤
           │                                                    │
           ├──────────── 3. Send Awareness State ───────────────→│ (Cursor / Colors)
           │                                                    │
```

### A. Connection Upgrades
When clients hit the backend, we capture the HTTP Upgrade socket. If the path matches `/workspace/:id`, the connection is routed to the Yjs websocket provider:
```typescript
setupWSConnection(ws, req, { docName });
```
This binds the WebSocket to a specific room (`docName` = file ID), multiplexing collaboration events.

### B. Heartbeats (Ping/Pong) & Resiliency
WebSockets run over TCP, which does not immediately report half-open connections (where a client drops off the grid due to a network disconnect without closing the socket).
- **Ping/Pong Heartbeats**: The server periodically streams a ping frame to all connected sockets.
- **Stale Cleanups**: If a socket fails to respond to a ping within a timeout interval, the server terminates the socket, cleans up associated system descriptors, and marks the user's cursor presence as offline.
- **Reconnection**: Clients retry connections with exponential backoff if the socket disconnects. Once re-established, they exchange State Vectors to catch up on offline edits.

### C. Awareness & Ephemeral Cursor States
Cursors, selection ranges, and usernames are **ephemeral**—they do not belong in the persistent database, nor do they need to be stored in the permanent CRDT transaction log.
- **Yjs Awareness Protocol**: Yjs includes an out-of-band state distribution mechanism specifically for temporal metadata.
- Each client maintains a local JSON map containing their coordinate state:
  ```json
  {
    "user": { "name": "Aman", "color": "#ff0000" },
    "cursor": { "anchor": 12, "head": 15 }
  }
  ```
- This state is broadcasted over WebSockets to all connected peers in the same document room. When a client closes their socket, their awareness entry is immediately deleted on all peers, cleaning up their cursor from the UI.
