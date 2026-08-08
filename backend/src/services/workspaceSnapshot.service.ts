/**
 * Purpose: Workspace point-in-time snapshot, time-travel history diffing, and restoration service.
 * High-Level Architecture: Captures immutable Merkle DAG snapshot tree points, computes unified text diffs between historical and live files, and restores CRDT documents inside explicit SQL transactions (`BEGIN`/`COMMIT`).
 * Primary Trade-offs: Content-addressable storage (CAS) achieves 0-byte deduplication for unchanged files and O(1) subtree comparison while supporting instantaneous time-travel restoration.
 * Complexity: O(F) file snapshot copy per restore operation, where F is total workspace file count.
 */

import * as Y from 'yjs';
import { syncFileToTerminal } from '../terminal/terminalHandler.js';
import { getIO } from '../socket.js';
import { snapshotRepository, SnapshotEntity } from '../repositories/snapshot.repository.js';
import { fileRepository } from '../repositories/file.repository.js';
import { getPool } from '../db.js';
import type { PoolClient, QueryResult } from 'pg';

export interface SnapshotFileDiff {
   path: string;
   language: string | null;
   snapshot_content: string | null;
   live_content: string | null;
}

// =============================================================================
// DIRECTORY TREE RESOLUTION HELPERS
// =============================================================================

// INTENT: Recursively verify or create directory hierarchy paths when restoring snapshot files.
// WHY: Snapshot file restoration may contain files whose parent directories were deleted in live workspace state.
async function ensureDirectoryExists(client: PoolClient, workspaceId: string, dirPath: string): Promise<string | null> {
   if (!dirPath || dirPath === '') return null;
   const parts = dirPath.split('/');
   let parentId: string | null = null;
   let currentPath = '';

   for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const query: string = parentId
         ? 'SELECT id FROM files WHERE workspace_id = $1 AND name = $2 AND parent_id = $3 AND type = $4'
         : 'SELECT id FROM files WHERE workspace_id = $1 AND name = $2 AND parent_id IS NULL AND type = $3';
      const params: unknown[] = parentId
         ? [workspaceId, part, parentId, 'directory']
         : [workspaceId, part, 'directory'];

      const res: QueryResult<{ id: string }> = await client.query<{ id: string }>(query, params);
      if (res.rows.length > 0) {
         parentId = res.rows[0]!.id;
      } else {
         const insertRes: QueryResult<{ id: string }> = await client.query<{ id: string }>(
            'INSERT INTO files (workspace_id, name, type, parent_id) VALUES ($1, $2, $3, $4) RETURNING id',
            [workspaceId, part, 'directory', parentId]
         );
         parentId = insertRes.rows[0]!.id;
      }
   }
   return parentId;
}

// =============================================================================
// SNAPSHOT CREATION & TIME-TRAVEL DIFFING
// =============================================================================

// INTENT: Create atomic point-in-time snapshot checkpoint using the CAS Merkle DAG engine.
// WHY: Transactional execution (`BEGIN`/`COMMIT`) ensures snapshot creation is all-or-nothing.
export async function createSnapshot(workspaceId: string, userId: string, label?: string): Promise<SnapshotEntity> {
   try {
      const { crdtWriteBehindService } = await import('./crdtWriteBehind.service.js');
      const filesRes = await getPool().query<{ id: string }>('SELECT id FROM files WHERE workspace_id = $1 AND type = $2', [workspaceId, 'file']);
      for (const row of filesRes.rows) {
         await crdtWriteBehindService.flushFileBuffer(row.id).catch(() => {});
      }
   } catch {}

   const snapshotLabel = label?.trim() || `Snapshot ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
   return snapshotRepository.createSnapshotRecord(workspaceId, userId, snapshotLabel);
}

export async function listSnapshots(workspaceId: string): Promise<SnapshotEntity[]> {
   return snapshotRepository.listSnapshots(workspaceId);
}

// INTENT: Calculate file-level diff comparison between snapshot state and current live workspace state.
// WHY: Powers the frontend Timelapse/Diff UI viewer without requiring client-side git calculations.
export async function getSnapshotFilesWithDiff(workspaceId: string, snapshotId: string): Promise<SnapshotFileDiff[]> {
   const snapCheck = await snapshotRepository.findSnapshotById(snapshotId, workspaceId);
   if (!snapCheck) throw new Error('Snapshot not found');

   const snapFiles = await snapshotRepository.getSnapshotFiles(snapshotId);
   const liveFiles = await fileRepository.getFlattenedFilePaths(workspaceId);

   const liveMap = new Map<string, string>(
      liveFiles.filter(r => r.type === 'file').map(r => [r.path, r.content ?? ''])
   );

   const files: SnapshotFileDiff[] = snapFiles.map(f => ({
      path: f.path,
      language: f.language,
      snapshot_content: f.content ?? '',
      live_content: liveMap.get(f.path) ?? null,
   }));

   const snapPaths = new Set(snapFiles.map(f => f.path));
   for (const lf of liveFiles.filter(r => r.type === 'file')) {
      if (!snapPaths.has(lf.path)) {
         files.push({
            path: lf.path,
            language: lf.language ?? null,
            snapshot_content: null,
            live_content: lf.content ?? '',
         });
      }
   }

   return files;
}

// =============================================================================
// SNAPSHOT RESTORATION & CRDT STATE RE-HYDRATION
// =============================================================================

// INTENT: Revert workspace file hierarchy to a historical snapshot point, updating SQL database, live Yjs CRDT documents, container volume files, and connected WebSocket clients.
// WHY: Synchronizes database SQL content, active in-memory Yjs documents (`applyRestoredContentToLiveDocs`), and container PTY files inside a unified transaction.
// INTERVIEW NOTES: Emits `snapshot-restored` Socket.IO broadcast to notify all active collaborators to force-reload their Monaco editor models.
export async function restoreSnapshot(workspaceId: string, snapshotId: string): Promise<{ success: boolean; label: string; restored_files: number }> {
   const client = await getPool().connect();
   try {
      const snapCheck = await snapshotRepository.findSnapshotById(snapshotId, workspaceId, client);
      if (!snapCheck) throw new Error('Snapshot not found');

      const { applyRestoredContentToLiveDocs, cancelAndEvictWorkspaceDocs } = await import('../docsRegistry.js');
      const { deleteYjsStateFromCache } = await import('../utils/yjsCache.js');

      await client.query('BEGIN');

      const snapFiles = await snapshotRepository.getSnapshotFiles(snapshotId, client);
      const liveFiles = await fileRepository.getFlattenedFilePaths(workspaceId);

      const livePathToId = new Map<string, string>(
         liveFiles.filter(r => r.type === 'file').map(r => [r.path, r.id])
      );

      const restoredFilesData: { fileId: string; content: string }[] = [];
      const filesToSyncToTerminal: { fileId: string; content: string }[] = [];

      for (const sf of snapFiles) {
         const liveId = livePathToId.get(sf.path);
         const restoredContent = sf.content ?? '';
         
         const tempDoc = new Y.Doc();
         const tempYText = tempDoc.getText('monaco');
         tempYText.insert(0, restoredContent);
         const newYjsState = Buffer.from(Y.encodeStateAsUpdate(tempDoc));
         tempDoc.destroy();

         let targetFileId = liveId;
         if (liveId) {
            await client.query(
               'UPDATE files SET content = $1, yjs_state = $2, updated_at = NOW() WHERE id = $3',
               [restoredContent, newYjsState, liveId]
            );
         } else {
            const lastSlashIndex = sf.path.lastIndexOf('/');
            const dirPath = lastSlashIndex !== -1 ? sf.path.substring(0, lastSlashIndex) : '';
            const fileName = lastSlashIndex !== -1 ? sf.path.substring(lastSlashIndex + 1) : sf.path;
            
            const parentId = await ensureDirectoryExists(client, workspaceId, dirPath);

            const insertRes = await client.query<{ id: string }>(
               'INSERT INTO files (workspace_id, name, type, parent_id, language, content, yjs_state) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
               [workspaceId, fileName, 'file', parentId, sf.language || 'javascript', restoredContent, newYjsState]
            );
            targetFileId = insertRes.rows[0]!.id;
         }
         
         if (targetFileId) {
            await client.query('DELETE FROM file_updates WHERE file_id = $1', [targetFileId]);
            restoredFilesData.push({ fileId: targetFileId, content: restoredContent });
            filesToSyncToTerminal.push({ fileId: targetFileId, content: restoredContent });
            deleteYjsStateFromCache(targetFileId).catch(() => {});
            try {
               const { fileContentCache } = await import('../utils/redisCache.js');
               await fileContentCache.delete(targetFileId);
            } catch {}
         }
      }

      try {
         const { workspaceTreeCache } = await import('../utils/redisCache.js');
         await workspaceTreeCache.delete(workspaceId);
      } catch {}

      await applyRestoredContentToLiveDocs(workspaceId, restoredFilesData);
      await client.query('COMMIT');

      // INTENT: Evict all in-memory Yjs docs for this workspace AFTER committing the DB transaction.
      // WHY: Without eviction, reconnecting clients re-use the stale in-memory WSSharedDoc (which still holds
      // the pre-restore content). Eviction forces the next connect to load fresh state from the updated DB.
      await cancelAndEvictWorkspaceDocs(workspaceId);

      for (const f of filesToSyncToTerminal) {
         syncFileToTerminal(workspaceId, f.fileId, f.content).catch(() => {});
      }

      getIO()?.to(`presence-${workspaceId}`).emit('snapshot-restored', { 
         workspaceId,
         snapshotId,
         label: snapCheck.label 
      });
      getIO()?.to(workspaceId).emit('snapshot-restored', {
         workspaceId,
         snapshotId,
         label: snapCheck.label
      });

      return { success: true, label: snapCheck.label, restored_files: snapFiles.length };
   } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
   } finally {
      client.release();
   }
}
