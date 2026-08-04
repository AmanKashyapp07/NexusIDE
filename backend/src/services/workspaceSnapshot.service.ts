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

export async function createSnapshot(workspaceId: string, userId: string, label?: string): Promise<SnapshotEntity> {
   const snapshotLabel = label?.trim() || `Snapshot ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
   const client = await getPool().connect();
   try {
      await client.query('BEGIN');

      const snapshot = await snapshotRepository.createSnapshotRecord(workspaceId, userId, snapshotLabel, client);
      await snapshotRepository.insertSnapshotFilesFromLive(workspaceId, snapshot.id, client);

      await client.query('COMMIT');
      return snapshot;
   } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
   } finally {
      client.release();
   }
}

export async function listSnapshots(workspaceId: string): Promise<SnapshotEntity[]> {
   return snapshotRepository.listSnapshots(workspaceId);
}

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

export async function restoreSnapshot(workspaceId: string, snapshotId: string): Promise<{ label: string; restored_files: number }> {
   const client = await getPool().connect();
   try {
      const snapCheck = await snapshotRepository.findSnapshotById(snapshotId, workspaceId, client);
      if (!snapCheck) throw new Error('Snapshot not found');

      const { applyRestoredContentToLiveDocs } = await import('../docsRegistry.js');

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
         
         let targetFileId = liveId;
         if (liveId) {
            await client.query(
               'UPDATE files SET content = $1, updated_at = NOW() WHERE id = $2',
               [restoredContent, liveId]
            );
         } else {
            const lastSlashIndex = sf.path.lastIndexOf('/');
            const dirPath = lastSlashIndex !== -1 ? sf.path.substring(0, lastSlashIndex) : '';
            const fileName = lastSlashIndex !== -1 ? sf.path.substring(lastSlashIndex + 1) : sf.path;
            
            const parentId = await ensureDirectoryExists(client, workspaceId, dirPath);
            
            const emptyDoc = new Y.Doc();
            const initialYjsState = Buffer.from(Y.encodeStateAsUpdate(emptyDoc));
            emptyDoc.destroy();

            const insertRes = await client.query<{ id: string }>(
               'INSERT INTO files (workspace_id, name, type, parent_id, language, content, yjs_state) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
               [workspaceId, fileName, 'file', parentId, sf.language || 'javascript', restoredContent, initialYjsState]
            );
            targetFileId = insertRes.rows[0]!.id;
         }
         
         if (targetFileId) {
            restoredFilesData.push({ fileId: targetFileId, content: restoredContent });
            filesToSyncToTerminal.push({ fileId: targetFileId, content: restoredContent });
         }
      }

      await applyRestoredContentToLiveDocs(workspaceId, restoredFilesData);
      await client.query('COMMIT');

      for (const f of filesToSyncToTerminal) {
         syncFileToTerminal(workspaceId, f.fileId, f.content).catch(() => {});
      }

      getIO()?.to(`presence-${workspaceId}`).emit('snapshot-restored', { 
         workspaceId,
         snapshotId,
         label: snapCheck.label 
      });

      return { label: snapCheck.label, restored_files: snapFiles.length };
   } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
   } finally {
      client.release();
   }
}
