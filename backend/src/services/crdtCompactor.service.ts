/**
 * Purpose: CRDT Delta Compaction & Local Disk Archiving Engine.
 * High-Level Architecture: Merges incremental `file_updates` binary blobs into a single `Y.Doc` state vector,
 * updates PostgreSQL `files.yjs_state`, purges merged delta rows, and creates local disk compressed archives for cold workspaces.
 * Complexity: O(N) where N is total incremental CRDT update blobs.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import * as Y from 'yjs';
import { getPool } from '../db.js';
import { log } from './logger.service.js';

export const ARCHIVE_DATA_DIR = process.env.ARCHIVE_DATA_DIR || '/tmp/nexus_archives';

// Ensure archive directory exists
if (!fs.existsSync(ARCHIVE_DATA_DIR)) {
   try {
      fs.mkdirSync(ARCHIVE_DATA_DIR, { recursive: true });
   } catch {
      // Directory creation fallback handled at runtime
   }
}

export interface CompactionResult {
   fileId: string;
   updatesCompacted: number;
   compactedSizeBytes: number;
}

export interface ArchiveResult {
   workspaceId: string;
   filesCompacted: number;
   archivePath: string;
}

// =============================================================================
// CRDT DELTA COMPACTION ROUTINE
// =============================================================================

/**
 * Merges all incremental `file_updates` rows into `files.yjs_state` and purges merged rows.
 */
export async function compactFileCrdtDeltas(fileId: string): Promise<CompactionResult> {
   const pool = getPool();

   const fileRes = await pool.query<{ yjs_state: Buffer | null; content: string | null }>(
      'SELECT yjs_state, content FROM files WHERE id = $1',
      [fileId]
   );

   if (!fileRes.rows.length) {
      return { fileId, updatesCompacted: 0, compactedSizeBytes: 0 };
   }

   const updatesRes = await pool.query<{ seq: number; update: Buffer }>(
      'SELECT seq, update FROM file_updates WHERE file_id = $1 ORDER BY seq ASC',
      [fileId]
   );

   if (!updatesRes.rows.length) {
      const currentSize = fileRes.rows[0]?.yjs_state?.length || 0;
      return { fileId, updatesCompacted: 0, compactedSizeBytes: currentSize };
   }

   // Extract delta updates array
   const updatesList = updatesRes.rows
      .filter((r) => r.update && r.update.length > 0)
      .map((r) => new Uint8Array(r.update));

   let compactedBuffer: Buffer;
   let textContent: string;

   // Offload heavy CRDT merging to WorkerPool when updating > 5 deltas
   if (updatesList.length > 5) {
      try {
         const { workerPoolService } = await import('./workerPool.service.js');
         const baseStateArr = fileRes.rows[0]?.yjs_state
            ? new Uint8Array(fileRes.rows[0].yjs_state)
            : null;

         const mergedBytes = await workerPoolService.mergeYjsUpdatesOffloaded(updatesList, baseStateArr);
         compactedBuffer = Buffer.from(mergedBytes);

         // Extract text for MONACO representation
         const doc = new Y.Doc({ gc: false });
         try {
            Y.applyUpdate(doc, mergedBytes);
            textContent = doc.getText('monaco').toString();
         } finally {
            doc.destroy();
         }
      } catch {
         // Fallback to inline merging
         const doc = new Y.Doc({ gc: false });
         try {
            if (fileRes.rows[0]?.yjs_state) {
               Y.applyUpdate(doc, new Uint8Array(fileRes.rows[0].yjs_state));
            } else if (fileRes.rows[0]?.content) {
               doc.getText('monaco').insert(0, fileRes.rows[0].content);
            }
            for (const u of updatesList) {
               Y.applyUpdate(doc, u);
            }
            compactedBuffer = Buffer.from(Y.encodeStateAsUpdate(doc));
            textContent = doc.getText('monaco').toString();
         } finally {
            doc.destroy();
         }
      }
   } else {
      // Small delta list — execute inline
      const doc = new Y.Doc({ gc: false });
      try {
         if (fileRes.rows[0]?.yjs_state) {
            Y.applyUpdate(doc, new Uint8Array(fileRes.rows[0].yjs_state));
         } else if (fileRes.rows[0]?.content) {
            doc.getText('monaco').insert(0, fileRes.rows[0].content);
         }
         for (const u of updatesList) {
            Y.applyUpdate(doc, u);
         }
         compactedBuffer = Buffer.from(Y.encodeStateAsUpdate(doc));
         textContent = doc.getText('monaco').toString();
      } finally {
         doc.destroy();
      }
   }

   // 4. Atomic transaction: Update base state & purge delta log
   const client = await pool.connect();
   try {
      await client.query('BEGIN');
      await client.query(
         'UPDATE files SET yjs_state = $1, content = $2 WHERE id = $3',
         [compactedBuffer, textContent, fileId]
      );
      await client.query('DELETE FROM file_updates WHERE file_id = $1', [fileId]);
      await client.query('COMMIT');
   } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
   } finally {
      client.release();
   }

   log('📦 COMPACT', `Compacted ${updatesRes.rows.length} deltas for file=${fileId} (${compactedBuffer.length} bytes)`);

   return {
      fileId,
      updatesCompacted: updatesRes.rows.length,
      compactedSizeBytes: compactedBuffer.length,
   };
}

// =============================================================================
// INACTIVE WORKSPACE LOCAL DISK ARCHIVING
// =============================================================================

/**
 * Compacts all files in a workspace and exports compressed JSON archive to local disk.
 */
export async function archiveWorkspaceToLocalDisk(workspaceId: string): Promise<ArchiveResult> {
   const pool = getPool();

   // 1. Find all workspace files
   const filesRes = await pool.query<{ id: string; name: string; content: string | null; yjs_state: Buffer | null }>(
      'SELECT id, name, content, yjs_state FROM files WHERE workspace_id = $1',
      [workspaceId]
   );

   let filesCompacted = 0;

   // 2. Compact each file first
   for (const file of filesRes.rows) {
      const res = await compactFileCrdtDeltas(file.id);
      if (res.updatesCompacted > 0) {
         filesCompacted++;
      }
   }

   // 3. Re-read fresh compacted states
   const freshFilesRes = await pool.query<{ id: string; name: string; content: string | null; yjs_state: Buffer | null }>(
      'SELECT id, name, content, yjs_state FROM files WHERE workspace_id = $1',
      [workspaceId]
   );

   const payload = {
      workspaceId,
      archivedAt: new Date().toISOString(),
      files: freshFilesRes.rows.map((f) => ({
         id: f.id,
         name: f.name,
         content: f.content,
         yjsStateBase64: f.yjs_state ? f.yjs_state.toString('base64') : null,
      })),
   };

   // 4. Compress JSON payload using Gzip
   const jsonString = JSON.stringify(payload);
   const compressed = zlib.gzipSync(Buffer.from(jsonString, 'utf-8'));

   if (!fs.existsSync(ARCHIVE_DATA_DIR)) {
      fs.mkdirSync(ARCHIVE_DATA_DIR, { recursive: true });
   }

   const archivePath = path.join(ARCHIVE_DATA_DIR, `workspace_${workspaceId}.json.gz`);
   fs.writeFileSync(archivePath, compressed);

   log('📂 ARCHIVE', `Archived workspace=${workspaceId} (${filesRes.rows.length} files, ${compressed.length} bytes compressed)`);

   return {
      workspaceId,
      filesCompacted,
      archivePath,
   };
}

/**
 * Hydrates an archived workspace from local disk into database/memory.
 */
export async function hydrateArchivedWorkspaceFromLocalDisk(workspaceId: string): Promise<boolean> {
   const archivePath = path.join(ARCHIVE_DATA_DIR, `workspace_${workspaceId}.json.gz`);
   if (!fs.existsSync(archivePath)) {
      return false;
   }

   try {
      const compressed = fs.readFileSync(archivePath);
      const decompressed = zlib.gunzipSync(compressed);
      const payload = JSON.parse(decompressed.toString('utf-8')) as {
         files: Array<{ id: string; name: string; content: string | null; yjsStateBase64: string | null }>;
      };

      const pool = getPool();
      for (const file of payload.files) {
         const yjsBuffer = file.yjsStateBase64 ? Buffer.from(file.yjsStateBase64, 'base64') : null;
         await pool.query(
            'UPDATE files SET yjs_state = $1, content = $2 WHERE id = $3',
            [yjsBuffer, file.content, file.id]
         );
      }

      log('📂 HYDRATE', `Hydrated archived workspace=${workspaceId} from local archive`);
      return true;
   } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log('📂 HYDRATE', `Failed to hydrate workspace=${workspaceId}: ${msg}`);
      return false;
   }
}
