import type { WebSocket } from 'ws';

const docs = new Map<string, Promise<any>>();

export function getDocsMap(): Map<string, Promise<any>> {
   return docs;
}

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

export async function evictWorkspaceDocs(workspaceId: string): Promise<void> {
   return cancelAndEvictWorkspaceDocs(workspaceId);
}
