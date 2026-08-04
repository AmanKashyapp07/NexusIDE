/**
 * Purpose: Centralized in-memory registry for active Yjs document room promises and eviction routines.
 * High-Level Architecture: Global Map registry tracking shared `WSSharedDoc` promises to prevent duplicate room creation and coordinate workspace snapshot eviction.
 * Primary Trade-offs: Holding unresolved promises in a Map enables atomic single-flight room resolution across concurrent WebSocket connection attempts.
 * Complexity: O(N) traversal over active document keys during workspace-level eviction operations.
 */

import type { WebSocket } from 'ws';

// =============================================================================
// GLOBAL DOCUMENT REGISTRY INSTANCE
// =============================================================================

// INTENT: Store active in-memory document promises keyed by docName (`workspaceId-fileId`).
// WHY: Deduplicates parallel load attempts and provides single-point management for room eviction.
const docs = new Map<string, Promise<any>>();

// INTENT: Expose global document Map instance.
export function getDocsMap(): Map<string, Promise<any>> {
   return docs;
}

// =============================================================================
// DOCUMENT EVICTION & CLEANUP ROUTINES
// =============================================================================

// INTENT: Forcefully terminate active WebSocket connections, cancel debounced save timers, and evict all rooms associated with a workspace.
// WHY: Used during workspace deletion or snapshot restoration to prevent stale in-memory Yjs documents from overwriting new state.
// EDGE CASE: Properly handles socket errors during disconnect and clears active connection Maps to prevent memory leaks.
// INTERVIEW NOTES: Closing client sockets with 4100 closure code signals the client to clear local editor buffers and reload state.
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

// =============================================================================
// CRDT LIVE STATE RE-HYDRATION
// =============================================================================

// INTENT: Atomic mutation of live Yjs text instances during snapshot restoration.
// WHY: Wraps document text replacement inside a single `doc.transact(...)` block to generate a unified CRDT delta update for connected clients.
// INTERVIEW NOTES: `doc.transact(...)` emits a single delta update packet, eliminating UI flicker or partial text rendering across connected peers.
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
      } catch (err: unknown) {
         process.stdout.write(`[Snapshot Error] Failed to update live doc ${docName}: ${err instanceof Error ? err.message : String(err)}\n`);
      }
   }
}

// INTENT: Alias for `cancelAndEvictWorkspaceDocs`.
export async function evictWorkspaceDocs(workspaceId: string): Promise<void> {
   return cancelAndEvictWorkspaceDocs(workspaceId);
}
