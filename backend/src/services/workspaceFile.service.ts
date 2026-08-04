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

export async function getFileHistory(
   workspaceId: string,
   fileId: string
): Promise<{ authorMap: Record<string, { userId: string; username: string; color: string }>; updates?: string[]; yjsState?: string }> {
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
   
   if (!cached || !cached.yjs_state) throw new Error('No history found for this file');

   const authorMap: Record<string, { userId: string; username: string; color: string }> = cached.author_map || {};

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
      const updatesResult = await fileRepository.getFileUpdates(fileId);
      if (updatesResult.length > 0) {
         const updates = updatesResult.map(r => r.update.toString('base64'));
         return { authorMap, updates };
      }
   } catch {
   }

   return {
      yjsState: cached.yjs_state.toString('base64'),
      authorMap,
   };
}

export async function updateFileContent(workspaceId: string, fileId: string, content: string): Promise<void> {
   await fileRepository.updateFileContent(fileId, workspaceId, content);
   const { applyRestoredContentToLiveDocs } = await import('../docsRegistry.js');
   await applyRestoredContentToLiveDocs(workspaceId, [{ fileId, content }]);
}

export async function deleteWorkspaceFile(workspaceId: string, fileId: string): Promise<void> {
   const filePath = await fileRepository.findFilePath(workspaceId, fileId);
   await fileRepository.deleteFile(fileId, workspaceId);
   if (filePath) syncDeleteToTerminal(workspaceId, filePath).catch(() => {});
   getIO()?.to(`presence-${workspaceId}`).emit('file-tree-update');
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
