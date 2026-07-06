// Shared registry for in-memory Yjs document instances.
// Extracted to its own module to avoid circular dependency between server.ts and routes/workspace.ts.

import type { WebSocket } from 'ws';

// The docs map stores promises that resolve to WSSharedDoc instances.
// Using `any` here to avoid importing the class definition (which lives in server.ts).
const docs = new Map<string, Promise<any>>();

export function getDocsMap(): Map<string, Promise<any>> {
  return docs;
}

/**
 * Cancel any pending debounced save timers for a workspace's docs,
 * then force-evict them from memory.
 * Must be called BEFORE the restore DB write so the pending save timer
 * cannot fire after the restore and overwrite the restored content.
 */
export async function cancelAndEvictWorkspaceDocs(workspaceId: string): Promise<void> {
  for (const [docName, docPromise] of docs.entries()) {
    if (!docName.startsWith(workspaceId)) continue;
    try {
      const doc = await docPromise;
      // Cancel debounced save FIRST — prevents it from overwriting restored content
      if (doc.saveTimeout) {
        clearTimeout(doc.saveTimeout);
        doc.saveTimeout = null;
      }
      // Close all active WebSocket connections — forces client reconnect to load fresh DB state
      for (const [conn] of doc.conns as Map<WebSocket, Set<number>>) {
        conn.close(4100, 'Snapshot restored');
      }
      doc.conns.clear();
      docs.delete(docName);
      doc.destroy();
      console.log(`[Snapshot] Cancelled save + evicted doc=${docName}`);
    } catch {
      docs.delete(docName);
    }
  }
}
/**
 * Applies restored DB content directly to live in-memory Yjs documents.
 * This generates a new Yjs transaction, ensuring the server's restored state 
 * gets broadcasted to clients with a higher CRDT clock, forcing v1 to win.
 */
export async function applyRestoredContentToLiveDocs(
  workspaceId: string, 
  restoredFiles: { fileId: string; content: string }[]
): Promise<void> {
  const docs = getDocsMap();
  process.stdout.write(`[DEBUG docsRegistry] docs keys: ${JSON.stringify(Array.from(docs.keys()))} workspaceId: ${workspaceId} restoredFiles: ${JSON.stringify(restoredFiles)}\n`);

  for (const [docName, docPromise] of docs.entries()) {
    // Only process docs belonging to this workspace
    if (!docName.startsWith(workspaceId)) continue;
    
    try {
      const doc = await docPromise;
      process.stdout.write(`[DEBUG docsRegistry] Loaded doc: ${docName}, ytext length: ${doc.getText('monaco').length}\n`);
      
      // 1. Cancel the debounced save FIRST so it doesn't overwrite the DB
      if (doc.saveTimeout) {
        clearTimeout(doc.saveTimeout);
        doc.saveTimeout = null;
      }
      
      // 2. Match the Yjs doc to the restored file 
      // (assuming docName contains the fileId, e.g., `${workspaceId}-${fileId}`)
      const matchedFile = restoredFiles.find(f => docName.includes(f.fileId));
      
      if (matchedFile) {
        // 3. Mutate the Yjs document's text field directly
        const ytext = doc.getText('monaco'); 
        
        doc.transact(() => {
          ytext.delete(0, ytext.length);
          ytext.insert(0, matchedFile.content);
        });
        
        process.stdout.write(`[Snapshot] Restored content applied as Yjs transaction to doc=${docName}\n`);
      }
    } catch (err: any) {
      process.stdout.write(`[Snapshot Error] Failed to update live doc ${docName}: ${err.message}\n`);
    }
  }
}
/**
 * Force-evict all in-memory Yjs docs for a given workspace.
 * Closes all active WebSocket connections to those docs, clears their save timers,
 * removes them from the registry, and destroys them.
 * Called by the snapshot-restore endpoint so that reconnecting clients
 * load freshly restored state from the database.
 */
export async function evictWorkspaceDocs(workspaceId: string): Promise<void> {
  return cancelAndEvictWorkspaceDocs(workspaceId);
}
