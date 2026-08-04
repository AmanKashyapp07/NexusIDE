import { getPool } from '../db.js';
import type { PoolClient } from 'pg';

export interface SnapshotEntity {
   id: string;
   label: string;
   created_at: Date;
   created_by?: string;
}

export interface SnapshotFileEntity {
   path: string;
   content: string | null;
   language: string | null;
}

export class SnapshotRepository {
   async createSnapshotRecord(workspaceId: string, userId: string, label: string, client?: PoolClient): Promise<SnapshotEntity> {
      const runner = client || getPool();
      const res = await runner.query<SnapshotEntity>(
         `INSERT INTO workspace_snapshots (workspace_id, created_by, label)
          VALUES ($1, $2, $3) RETURNING id, label, created_at`,
         [workspaceId, userId, label]
      );
      return res.rows[0]!;
   }

   async insertSnapshotFilesFromLive(workspaceId: string, snapshotId: string, client?: PoolClient): Promise<void> {
      const runner = client || getPool();
      await runner.query(`
         INSERT INTO snapshot_files (snapshot_id, path, content, language)
         WITH RECURSIVE file_path_cte AS (
            SELECT id, parent_id, name, type, content, language, name::text AS path
            FROM files WHERE workspace_id = $1 AND parent_id IS NULL
            UNION ALL
            SELECT f.id, f.parent_id, f.name, f.type, f.content, f.language,
                   (cte.path || '/' || f.name)::text AS path
            FROM files f
            INNER JOIN file_path_cte cte ON f.parent_id = cte.id
            WHERE f.workspace_id = $1
         )
         SELECT $2, path, content, language
         FROM file_path_cte
         WHERE type = 'file';
      `, [workspaceId, snapshotId]);
   }

   async listSnapshots(workspaceId: string): Promise<SnapshotEntity[]> {
      const res = await getPool().query<SnapshotEntity>(
         `SELECT s.id, s.label, s.created_at, u.username AS created_by
          FROM workspace_snapshots s
          JOIN users u ON s.created_by = u.id
          WHERE s.workspace_id = $1
          ORDER BY s.created_at DESC
          LIMIT 10`,
         [workspaceId]
      );
      return res.rows;
   }

   async findSnapshotById(snapshotId: string, workspaceId: string, client?: PoolClient): Promise<SnapshotEntity | null> {
      const runner = client || getPool();
      const res = await runner.query<SnapshotEntity>(
         'SELECT id, label, created_at FROM workspace_snapshots WHERE id = $1 AND workspace_id = $2',
         [snapshotId, workspaceId]
      );
      return res.rows[0] || null;
   }

   async getSnapshotFiles(snapshotId: string, client?: PoolClient): Promise<SnapshotFileEntity[]> {
      const runner = client || getPool();
      const res = await runner.query<SnapshotFileEntity>(
         'SELECT path, content, language FROM snapshot_files WHERE snapshot_id = $1 ORDER BY path ASC',
         [snapshotId]
      );
      return res.rows;
   }
}

export const snapshotRepository = new SnapshotRepository();
