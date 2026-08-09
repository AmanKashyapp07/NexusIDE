import * as Y from 'yjs';
import { syncDeleteToTerminal, syncFolderToTerminal, syncFileToTerminal } from '../terminal/terminalHandler.js';
import { getIO } from '../socket.js';
import { parseConflicts } from '../utils/conflictParser.js';
import { fileRepository, FileEntity } from '../repositories/file.repository.js';
import { getPool } from '../db.js';

export async function getWorkspaceFiles(workspaceId: string): Promise<FileEntity[]> {
   return fileRepository.getWorkspaceFiles(workspaceId);
}

export async function createWorkspaceFile(
   workspaceId: string,
   name: string,
   type: 'file' | 'directory',
   parentId: string | null = null,
   language?: string | null
): Promise<FileEntity> {
   let initialYjsState: Buffer | null = null;
   if (type === 'file') {
      const emptyDoc = new Y.Doc();
      initialYjsState = Buffer.from(Y.encodeStateAsUpdate(emptyDoc));
      emptyDoc.destroy();
   }

   const newFile = await fileRepository.insertFile(
      workspaceId,
      name,
      type,
      parentId || null,
      type === 'file' ? (language || 'javascript') : null,
      '',
      initialYjsState
   );

   fileRepository.findFilePath(workspaceId, newFile.id).then(filePath => {
      if (filePath) {
         type === 'directory' 
            ? syncFolderToTerminal(workspaceId, filePath).catch(() => {}) 
            : syncFileToTerminal(workspaceId, newFile.id, '').catch(() => {});
      }
   }).catch(() => {});

   getIO()?.to(`presence-${workspaceId}`).emit('file-tree-update');
   getIO()?.to(`presence-${workspaceId}`).emit('file-created', { file: newFile });
   return newFile;
}

export async function getFileContent(workspaceId: string, fileId: string): Promise<string> {
   const { fileContentCache } = await import('../utils/redisCache.js');
   
   return fileContentCache.getOrFetch(
      `${fileId}`,
      async () => {
         const content = await fileRepository.findFileContent(fileId, workspaceId);
         if (content === null) throw new Error('File not found');
         return content;
      },
      5 * 60
   );
}

export interface AuthorRange {
   start: number;
   end: number;
   clientId: number;
}

export interface TimelineStep {
   stepIndex: number;
   text: string;
   authorRanges: AuthorRange[];
}

export function extractSnapshotFromYText(ytext: Y.Text): { text: string; authorRanges: AuthorRange[] } {
   let text = '';
   const ranges: AuthorRange[] = [];
   let runStart = 0;
   let runClient = -1;

   let node: any = (ytext as any)._start;
   while (node !== null) {
      if (!node.deleted) {
         const content = node.content?.getContent?.();
         const str = Array.isArray(content) ? content.join('') : (typeof content === 'string' ? content : '');
         for (let i = 0; i < str.length; i++) {
            const ch = str[i];
            const offset = text.length;
            if (ch === '\n') {
               if (runClient !== -1) {
                  ranges.push({ start: runStart, end: offset, clientId: runClient });
                  runClient = -1;
               }
               text += ch;
               runStart = text.length;
            } else {
               if (node.id.client !== runClient) {
                  if (runClient !== -1) ranges.push({ start: runStart, end: offset, clientId: runClient });
                  runStart = offset;
                  runClient = node.id.client;
               }
               text += ch;
            }
         }
      }
      node = node.right;
   }
   if (runClient !== -1 && text.length > runStart) {
      ranges.push({ start: runStart, end: text.length, clientId: runClient });
   }
   return { text, authorRanges: ranges };
}

export async function getFileHistory(
   workspaceId: string,
   fileId: string
): Promise<{
   authorMap: Record<string, { userId: string; username: string; color: string }>;
   updates?: string[] | undefined;
   yjsState?: string | undefined;
   totalSteps?: number;
   steps?: TimelineStep[];
}> {
   const { yjsStateCache } = await import('../utils/redisCache.js');

   const cached = await yjsStateCache.getOrFetch(
      `${fileId}:history`,
      async () => {
         const file = await fileRepository.findFileById(fileId, workspaceId);
         if (!file) throw new Error('File not found');
         return {
            yjs_state: file.yjs_state || null,
            author_map: (file.author_map as Record<string, { userId: string; username: string; color: string }>) || {}
         };
      },
      10 * 60
   );
   
   let baseState = cached?.yjs_state || null;
   if (!baseState) {
      const file = await fileRepository.findFileById(fileId, workspaceId);
      const content = file?.content || '';
      const Y = await import('yjs');
      const doc = new Y.Doc({ gc: false });
      if (content) doc.getText('monaco').insert(0, content);
      baseState = Buffer.from(Y.encodeStateAsUpdate(doc));
      doc.destroy();
   }

   const authorMap: Record<string, { userId: string; username: string; color: string }> = { ...(cached?.author_map || {}) };

   try {
      const file = await fileRepository.findFileById(fileId, workspaceId);
      if (file?.author_map) {
         Object.assign(authorMap, file.author_map);
      }
   } catch {}

   try {
      const docName = `${workspaceId}-${fileId}`;
      const { getDocsMap } = await import('../docsRegistry.js');
      const docsMap = getDocsMap();
      if (docsMap.has(docName)) {
         const liveDoc = await docsMap.get(docName)!;
         for (const [clientId, info] of liveDoc.authorMap.entries()) {
            authorMap[String(clientId)] = info;
         }
      }
   } catch {
   }

   try {
      // INTENT: Flush pending Write-Behind Redis buffer into PostgreSQL before retrieving full history
      const { crdtWriteBehindService } = await import('./crdtWriteBehind.service.js');
      await crdtWriteBehindService.flushFileBuffer(fileId).catch(() => {});

      const updatesResult = await fileRepository.getFileUpdates(fileId);

      const Y = await import('yjs');
      const compositeDoc = new Y.Doc({ gc: false });
      const steps: TimelineStep[] = [{ stepIndex: 0, text: '', authorRanges: [] }];

      if (updatesResult.length > 0) {
         for (const row of updatesResult) {
            try {
               const uArr = new Uint8Array(row.update.buffer, row.update.byteOffset, row.update.byteLength);
               Y.applyUpdate(compositeDoc, uArr);
               const stepSnap = extractSnapshotFromYText(compositeDoc.getText('monaco'));
               steps.push({ stepIndex: steps.length, text: stepSnap.text, authorRanges: stepSnap.authorRanges });
            } catch (e) {
               console.error('[getFileHistory] Error applying update row:', e);
            }
         }
      } else if (baseState && baseState.length > 0) {
         try {
            const baseArr = new Uint8Array(baseState.buffer, baseState.byteOffset, baseState.byteLength);
            Y.applyUpdate(compositeDoc, baseArr);
            const baseSnap = extractSnapshotFromYText(compositeDoc.getText('monaco'));
            if (baseSnap.text) {
               steps.push({ stepIndex: steps.length, text: baseSnap.text, authorRanges: baseSnap.authorRanges });
            }
         } catch (e) {
            console.error('[getFileHistory] Error applying baseState:', e);
         }
      }

      // Also apply from live in-memory WSSharedDoc if present (may have unsaved edits)
      try {
         const docName = `${workspaceId}-${fileId}`;
         const { getDocsMap } = await import('../docsRegistry.js');
         const docsMap = getDocsMap();
         if (docsMap.has(docName)) {
            const liveDoc = await docsMap.get(docName)!;
            const liveState = Y.encodeStateAsUpdate(liveDoc);
            try {
               Y.applyUpdate(compositeDoc, liveState);
               const finalLiveSnap = extractSnapshotFromYText(compositeDoc.getText('monaco'));
               if (steps[steps.length - 1]?.text !== finalLiveSnap.text) {
                  steps.push({ stepIndex: steps.length, text: finalLiveSnap.text, authorRanges: finalLiveSnap.authorRanges });
               }
            } catch {}
         }
      } catch {}

      const compositeYjsState = Buffer.from(Y.encodeStateAsUpdate(compositeDoc)).toString('base64');
      compositeDoc.destroy();

      return {
         yjsState: compositeYjsState,
         authorMap,
         updates: updatesResult.length > 0 ? updatesResult.map(r => r.update.toString('base64')) : undefined,
         totalSteps: steps.length,
         steps,
      };
   } catch (err) {
      console.error('[getFileHistory] Unexpected error:', err);
      return {
         yjsState: baseState ? baseState.toString('base64') : undefined,
         authorMap,
         totalSteps: 1,
         steps: [{ stepIndex: 0, text: '', authorRanges: [] }],
      };
   }
}

export async function updateFileContent(workspaceId: string, fileId: string, content: string): Promise<void> {
   const ydoc = new Y.Doc({ gc: false });
   ydoc.getText('monaco').insert(0, content);
   const yjsState = Buffer.from(Y.encodeStateAsUpdate(ydoc));
   ydoc.destroy();

   await fileRepository.updateFileAndYjsState(fileId, content, yjsState, '{}');
   try {
      const { yjsStateCache } = await import('../utils/redisCache.js');
      await yjsStateCache.delete(`${fileId}:history`).catch(() => {});
   } catch {}
   const { applyRestoredContentToLiveDocs } = await import('../docsRegistry.js');
   await applyRestoredContentToLiveDocs(workspaceId, [{ fileId, content }]);
}

export async function deleteWorkspaceFile(workspaceId: string, fileId: string): Promise<void> {
   const filePath = await fileRepository.findFilePath(workspaceId, fileId);
   await fileRepository.deleteFile(fileId, workspaceId);
   if (filePath) syncDeleteToTerminal(workspaceId, filePath).catch(() => {});
   getIO()?.to(`presence-${workspaceId}`).emit('file-tree-update');
   getIO()?.to(`presence-${workspaceId}`).emit('file-deleted', { fileId, workspaceId });
}

export async function getFileConflicts(workspaceId: string, fileId: string) {
   const content = await fileRepository.findFileContent(fileId, workspaceId);
   if (content === null) throw new Error('File not found');
   
   const conflicts = parseConflicts(content);
   const hasConflicts = conflicts.some(c => c.type === 'conflict');
   return { hasConflicts, conflicts };
}

export async function resolveFileConflict(
   workspaceId: string,
   fileId: string,
   resolvedContent: string,
   userId?: string
): Promise<void> {
   const client = await getPool().connect();
   try {
      const file = await fileRepository.findFileById(fileId, workspaceId);
      if (!file) throw new Error('File not found');

      await client.query('BEGIN');
      await client.query('UPDATE files SET content = $1, updated_at = NOW() WHERE id = $2', [resolvedContent, fileId]);
      await client.query('COMMIT');

      try {
         const { applyRestoredContentToLiveDocs } = await import('../docsRegistry.js');
         await applyRestoredContentToLiveDocs(workspaceId, [{ fileId, content: resolvedContent }]);
      } catch (yjsErr: unknown) {
         const msg = yjsErr instanceof Error ? yjsErr.message : String(yjsErr);
         console.error('[ConflictResolver] Yjs broadcast error (non-fatal):', msg);
      }

      const filePath = await fileRepository.findFilePath(workspaceId, fileId);

      if (filePath && userId) {
         const { getRunningContainer } = await import('../sandbox/workspaceContainer.js');
         try {
            const container = getRunningContainer(userId, workspaceId);
            if (container) {
               const exec = await container.exec({
                  Cmd: ['git', 'add', filePath],
                  WorkingDir: `/workspaces/${workspaceId}`
               });
               await exec.start({ Detach: true });
            }
         } catch (e: unknown) {
            console.error('[ConflictResolver] git add failed:', e);
         }
      }
      
      getIO()?.to(`presence-${workspaceId}`).emit('conflict-resolved', { workspaceId, fileId });
   } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
   } finally {
      client.release();
   }
}
