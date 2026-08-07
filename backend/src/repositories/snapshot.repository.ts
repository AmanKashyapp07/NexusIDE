import { getPool } from '../db.js';
import type { PoolClient } from 'pg';
import { CASService } from '../services/cas.service.js';

export interface SnapshotEntity {
   id: string;
   label: string;
   created_at: Date;
   created_by?: string;
   workspace_id?: string;
   root_tree_hash?: string;
   parent_commit_id?: string | null;
}

export interface SnapshotFileEntity {
   path: string;
   content: string | null;
   language: string | null;
   size_bytes?: number;
}

export class SnapshotRepository {
   /**
    * Creates a CAS snapshot checkpoint for a workspace inside a database transaction.
    * Inserts blobs with ON CONFLICT (hash) DO NOTHING to achieve maximum deduplication.
    */
   static async createCheckpoint(
      workspaceId: string,
      userId: string,
      label: string,
      client?: PoolClient
   ): Promise<SnapshotEntity> {
      const runner = client || (await getPool().connect());
      const shouldManageTx = !client;

      try {
         if (shouldManageTx) await runner.query('BEGIN');

         // 1. Fetch current active workspace files using recursive CTE for accurate full relative paths
         const filesRes = await runner.query<{
            id: string;
            path: string;
            content: string | null;
            language: string | null;
            type: string;
         }>(
            `WITH RECURSIVE file_path_cte AS (
               SELECT id, parent_id, name, type, content, language, name::text AS path
               FROM files WHERE workspace_id = $1 AND parent_id IS NULL
               UNION ALL
               SELECT f.id, f.parent_id, f.name, f.type, f.content, f.language,
                      (cte.path || '/' || f.name)::text AS path
               FROM files f
               INNER JOIN file_path_cte cte ON f.parent_id = cte.id
               WHERE f.workspace_id = $1
            )
            SELECT id, path, content, language, type
            FROM file_path_cte
            WHERE type = 'file'`,
            [workspaceId]
         );

         const files = filesRes.rows.map(r => ({
            path: r.path,
            content: r.content || '',
            language: r.language || null,
         }));

         // 2. Build Merkle DAG & Compute Hashes
         const { rootTreeHash, blobsToInsert, treesToInsert } = await CASService.buildMerkleTree(files);

         // 3. Bulk Insert Blobs (ON CONFLICT DO NOTHING ensures zero duplication across all workspaces)
         for (const blob of blobsToInsert) {
            await runner.query(
               `INSERT INTO git_blobs (hash, content, size_bytes)
                VALUES ($1, $2, $3)
                ON CONFLICT (hash) DO NOTHING`,
               [blob.hash, blob.content, blob.sizeBytes]
            );
         }

         // 4. Bulk Insert Trees
         for (const tree of treesToInsert) {
            await runner.query(
               `INSERT INTO git_trees (hash, entries)
                VALUES ($1, $2)
                ON CONFLICT (hash) DO NOTHING`,
               [tree.hash, JSON.stringify(tree.entries)]
            );
         }

         // 5. Get Parent Commit (latest checkpoint for workspace)
         const parentRes = await runner.query<{ id: string }>(
            `SELECT id FROM git_commits WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 1`,
            [workspaceId]
         );
         const parentCommitId = parentRes.rows[0]?.id || null;

         // 6. Insert Commit Milestone
         const commitRes = await runner.query<SnapshotEntity>(
            `INSERT INTO git_commits (workspace_id, parent_commit_id, root_tree_hash, label, created_by)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, workspace_id, root_tree_hash, label, created_at`,
            [workspaceId, parentCommitId, rootTreeHash, label, userId]
         );

         // 7. Enforce max 10 snapshots per workspace — evict oldest beyond the cap
         await runner.query(
            `DELETE FROM git_commits
             WHERE workspace_id = $1
               AND id NOT IN (
                 SELECT id FROM git_commits
                 WHERE workspace_id = $1
                 ORDER BY created_at DESC
                 LIMIT 10
               )`,
            [workspaceId]
         );

         if (shouldManageTx) await runner.query('COMMIT');
         return commitRes.rows[0]!;
      } catch (err) {
         if (shouldManageTx) await runner.query('ROLLBACK').catch(() => {});
         throw err;
      } finally {
         if (shouldManageTx) runner.release();
      }
   }

   /**
    * Restores a workspace to a specific commit state from the CAS Merkle DAG.
    */
   static async restoreCheckpoint(commitId: string, workspaceId: string, client?: PoolClient) {
      const runner = client || (await getPool().connect());
      const shouldManageTx = !client;

      try {
         if (shouldManageTx) await runner.query('BEGIN');

         // 1. Fetch Commit and Tree from git_commits
         const treeRes = await runner.query<{ entries: any[] }>(
            `SELECT t.entries 
             FROM git_commits c 
             JOIN git_trees t ON c.root_tree_hash = t.hash 
             WHERE c.id = $1 AND c.workspace_id = $2`,
            [commitId, workspaceId]
         );

         let entries: any[] = [];
         const blobMap = new Map<string, string>();

         if (treeRes.rows.length > 0) {
            entries = treeRes.rows[0]!.entries;
            const blobHashes = entries.map((e: any) => e.hash);
            if (blobHashes.length > 0) {
               const blobsRes = await runner.query<{ hash: string; content: string }>(
                  `SELECT hash, content FROM git_blobs WHERE hash = ANY($1)`,
                  [blobHashes]
               );
               for (const r of blobsRes.rows) {
                  blobMap.set(r.hash, r.content);
               }
            }
         } else {
            // Fallback for legacy snapshot_files
            const legacyFiles = await runner.query<{ path: string; content: string; language: string }>(
               `SELECT path, content, language FROM snapshot_files WHERE snapshot_id = $1`,
               [commitId]
            );
            if (!legacyFiles.rows.length) {
               throw new Error('Snapshot checkpoint not found.');
            }
            entries = legacyFiles.rows.map(r => {
               const fakeHash = CASService.hashContent(r.content || '').hash;
               blobMap.set(fakeHash, r.content || '');
               return { path: r.path, hash: fakeHash, language: r.language };
            });
         }

         if (shouldManageTx) await runner.query('COMMIT');
         return { success: true, restoredFiles: entries.length, entries, blobMap };
      } catch (err) {
         if (shouldManageTx) await runner.query('ROLLBACK').catch(() => {});
         throw err;
      } finally {
         if (shouldManageTx) runner.release();
      }
   }

   // --------------------------------------------------------------------------
   // INSTANCE METHODS FOR BACKWARD COMPATIBILITY
   // --------------------------------------------------------------------------

   async createSnapshotRecord(workspaceId: string, userId: string, label: string, client?: PoolClient): Promise<SnapshotEntity> {
      return SnapshotRepository.createCheckpoint(workspaceId, userId, label, client);
   }

   async insertSnapshotFilesFromLive(workspaceId: string, snapshotId: string, client?: PoolClient): Promise<void> {
      // Handled atomically in createCheckpoint
   }

   async listSnapshots(workspaceId: string): Promise<SnapshotEntity[]> {
      // 1. Try fetching from git_commits
      const res = await getPool().query<SnapshotEntity>(
         `SELECT c.id, c.label, c.created_at, u.username AS created_by
          FROM git_commits c
          JOIN users u ON c.created_by = u.id
          WHERE c.workspace_id = $1
          ORDER BY c.created_at DESC`,
         [workspaceId]
      );

      if (res.rows.length > 0) {
         return res.rows;
      }

      // 2. Fallback to legacy workspace_snapshots if git_commits is empty
      const legacyRes = await getPool().query<SnapshotEntity>(
         `SELECT s.id, s.label, s.created_at, u.username AS created_by
          FROM workspace_snapshots s
          JOIN users u ON s.created_by = u.id
          WHERE s.workspace_id = $1
          ORDER BY s.created_at DESC`,
         [workspaceId]
      );
      return legacyRes.rows;
   }

   async findSnapshotById(snapshotId: string, workspaceId: string, client?: PoolClient): Promise<SnapshotEntity | null> {
      const runner = client || getPool();
      
      // 1. Try git_commits
      const res = await runner.query<SnapshotEntity>(
         `SELECT c.id, c.label, c.created_at, u.username AS created_by
          FROM git_commits c
          LEFT JOIN users u ON c.created_by = u.id
          WHERE c.id = $1 AND c.workspace_id = $2`,
         [snapshotId, workspaceId]
      );
      if (res.rows.length > 0) return res.rows[0]!;

      // 2. Fallback to workspace_snapshots
      const legacyRes = await runner.query<SnapshotEntity>(
         `SELECT s.id, s.label, s.created_at, u.username AS created_by
          FROM workspace_snapshots s
          LEFT JOIN users u ON s.created_by = u.id
          WHERE s.id = $1 AND s.workspace_id = $2`,
         [snapshotId, workspaceId]
      );
      return legacyRes.rows[0] || null;
   }

   async getSnapshotFiles(snapshotId: string, client?: PoolClient): Promise<SnapshotFileEntity[]> {
      const runner = client || getPool();

      // 1. Try git_commits + git_trees + git_blobs
      const treeRes = await runner.query<{ entries: any[] }>(
         `SELECT t.entries 
          FROM git_commits c 
          JOIN git_trees t ON c.root_tree_hash = t.hash 
          WHERE c.id = $1`,
         [snapshotId]
      );

      if (treeRes.rows.length > 0) {
         const entries = treeRes.rows[0]!.entries;
         const blobHashes = entries.map((e: any) => e.hash);
         
         const blobMap = new Map<string, string>();
         if (blobHashes.length > 0) {
            const blobsRes = await runner.query<{ hash: string; content: string }>(
               `SELECT hash, content FROM git_blobs WHERE hash = ANY($1)`,
               [blobHashes]
            );
            for (const r of blobsRes.rows) {
               blobMap.set(r.hash, r.content);
            }
         }

         return entries.map((e: any) => ({
            path: e.path,
            content: blobMap.get(e.hash) ?? '',
            language: e.language || null,
            size_bytes: e.sizeBytes,
         })).sort((a: SnapshotFileEntity, b: SnapshotFileEntity) => a.path.localeCompare(b.path));
      }

      // 2. Fallback to legacy snapshot_files
      const legacyRes = await runner.query<SnapshotFileEntity>(
         'SELECT path, content, language FROM snapshot_files WHERE snapshot_id = $1 ORDER BY path ASC',
         [snapshotId]
      );
      return legacyRes.rows;
   }
}

export const snapshotRepository = new SnapshotRepository();
export { SnapshotRepository as snapshotRepositoryClass };
