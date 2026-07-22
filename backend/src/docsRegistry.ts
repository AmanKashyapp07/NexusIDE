import type { WebSocket } from 'ws';

const docs = new Map<string, Promise<any>>();

/**
 * Purpose: Provides access to the centralized, in-memory Yjs document promise registry.
 * Under the Hood: Returns the static Map containing file IDs mapped to their loading document promises.
 * Design Decisions: This registry is isolated into this module to resolve circular dependency paths
 *                   between server.ts and workspace.ts route controllers.
 * Complexity: Time Complexity O(1), Space Complexity O(1).
 * Security & Failure Cases: Safe read accessor, returns the live Map instance.
 */
export function getDocsMap(): Map<string, Promise<any>> {
  return docs;
}

/**
 * Purpose: Cancels pending save operations and evicts document rooms belonging to a target workspace.
 * Under the Hood: 
 *   1. Iterates over active registry entries to filter documents matching the workspace ID prefix.
 *   2. Awaits the document loading promise.
 *   3. Clears pending debounced save timeouts to prevent overwriting database states.
 *   4. Iterates over WebSocket connections and closes them with code 4100 (Snapshot restored).
 *   5. Removes the workspace entry from the registry map and destroys the internal document instance.
 * Design Decisions: Timer cancellation must happen before WebSocket closure to avoid race conditions 
 *                   where client socket termination triggers premature database save handlers.
 * Complexity: Time Complexity O(D + W) where D is the number of active document rooms and W is the 
 *             number of active socket connections, Space Complexity O(1) auxiliary space.
 * Security & Failure Cases: Wraps iterations in try-catch to ensure failures in a single document 
 *                           or connection do not halt the eviction process for other records.
 */
export async function cancelAndEvictWorkspaceDocs(workspaceId: string): Promise<void> {
  for (const [docName, docPromise] of docs.entries()) {
    if (!docName.startsWith(workspaceId)) continue;
    try {
      const doc = await docPromise;
      if (doc?.saveTimeout) {
        clearTimeout(doc.saveTimeout);
        doc.saveTimeout = null;
      }
      const connections = doc?.conns as Map<WebSocket, Set<number>> | undefined;
      if (connections) {
        for (const [conn] of connections.entries()) {
          try {
            if (conn.readyState === conn.OPEN || conn.readyState === conn.CONNECTING) {
              conn.close(4100, 'Snapshot restored');
            }
          } catch (connErr) {
            process.stderr.write(`[Error] Failed closing socket for doc ${docName}: ${connErr instanceof Error ? connErr.message : String(connErr)}\n`);
          }
        }
        connections.clear();
      }
      docs.delete(docName);
      doc?.destroy();
      process.stdout.write(`[Snapshot] Cancelled save and evicted doc=${docName}\n`);
    } catch (err) {
      docs.delete(docName);
      process.stderr.write(`[Error] Failed during eviction of doc ${docName}: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
}

/**
 * Purpose: Mutates live collaborative Yjs documents with restored snapshot database content.
 * Under the Hood:
 *   1. Iterates over document registry keys to locate documents matching the workspace ID.
 *   2. Clears active debounced save timeouts to prevent the system from writing the pre-restore 
 *      state back to the database.
 *   3. Finds the matched snapshot file matching the document's file UUID.
 *   4. Runs an atomic Yjs document transaction to clear the live text and insert the snapshot text.
 * Design Decisions: Mutating the Yjs text directly within a transaction generates a new state update 
 *                   vector with a higher logical clock. This forces connected clients to merge and 
 *                   accept the update automatically without resetting their WebSocket connections.
 * Complexity: Time Complexity O(D * F + T) where D is the matching document count, F is the restored 
 *             file array length, and T is the text length being modified; Space Complexity O(1).
 * Security & Failure Cases: If an invalid document state or write error occurs, it catches the exception 
 *                           and continues processing the remaining documents in the array.
 */
export async function applyRestoredContentToLiveDocs(
  workspaceId: string, 
  restoredFiles: { fileId: string; content: string }[]
): Promise<void> {
  const activeDocs = getDocsMap();
  process.stdout.write(`[DEBUG docsRegistry] docs keys: ${JSON.stringify(Array.from(activeDocs.keys()))} workspaceId: ${workspaceId} restoredFiles: ${JSON.stringify(restoredFiles)}\n`);

  for (const [docName, docPromise] of activeDocs.entries()) {
    if (!docName.startsWith(workspaceId)) continue;
    
    try {
      const doc = await docPromise;
      if (!doc) continue;
      process.stdout.write(`[DEBUG docsRegistry] Loaded doc: ${docName}, ytext length: ${doc.getText?.('monaco')?.length ?? 0}\n`);
      
      if (doc.saveTimeout) {
        clearTimeout(doc.saveTimeout);
        doc.saveTimeout = null;
      }
      
      const matchedFile = restoredFiles.find(f => docName.includes(f.fileId));
      if (matchedFile) {
        const ytext = doc.getText('monaco'); 
        if (ytext) {
          doc.transact(() => {
            ytext.delete(0, ytext.length);
            ytext.insert(0, matchedFile.content);
          });
          process.stdout.write(`[Snapshot] Restored content applied as Yjs transaction to doc=${docName}\n`);
        }
      }
    } catch (err: any) {
      process.stdout.write(`[Snapshot Error] Failed to update live doc ${docName}: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
}

/**
 * Purpose: Enforces complete eviction of active documents for a targeted workspace.
 * Under the Hood: Calls cancelAndEvictWorkspaceDocs to clear save timers, close WebSockets, and destroy instances.
 * Design Decisions: Delegates work directly to avoid duplicated orchestration algorithms.
 * Complexity: Time Complexity O(D + W), Space Complexity O(1).
 * Security & Failure Cases: Inherits the safety features of cancelAndEvictWorkspaceDocs.
 */
export async function evictWorkspaceDocs(workspaceId: string): Promise<void> {
  return cancelAndEvictWorkspaceDocs(workspaceId);
}
