import { getPool } from '../db.js';
import { rbacCache, workspaceAuthCache, invalidateUserRbac, invalidateWorkspaceAuth } from '../utils/redisCache.js';

export interface WorkspaceEntity {
   id: string;
   title: string;
   created_at: Date;
   updated_at: Date;
   owner_id: string;
   user_role?: string;
   is_public?: boolean;
}

export interface CollaboratorEntity {
   id: string;
   username: string;
   email: string;
   role: string;
   joined_at: Date;
}

export class WorkspaceRepository {
   async getUserWorkspaces(userId: string): Promise<WorkspaceEntity[]> {
      const res = await getPool().query<WorkspaceEntity>(
         `SELECT w.id, w.title, w.created_at, w.updated_at, w.owner_id, 'owner' AS user_role FROM workspaces w WHERE w.owner_id = $1 
          UNION 
          SELECT w.id, w.title, w.created_at, w.updated_at, w.owner_id, wc.role::text AS user_role FROM workspaces w 
          INNER JOIN workspace_collaborators wc ON w.id = wc.workspace_id WHERE wc.user_id = $1 ORDER BY updated_at DESC`,
         [userId]
      );
      return res.rows;
   }

   // L2 CACHE: Uses Redis workspaceAuthCache (TTL: 15m) with automatic eviction on workspace mutations.
   async findWorkspaceAuth(id: string): Promise<{ owner_id: string; is_public: boolean } | null> {
      return workspaceAuthCache.getOrFetch(id, async () => {
         const res = await getPool().query<{ owner_id: string; is_public: boolean }>(
            'SELECT owner_id, is_public FROM workspaces WHERE id = $1',
            [id]
         );
         return res.rows[0] || null;
      });
   }

   // L2 CACHE: Uses Redis rbacCache (TTL: 15m) with sub-0.5ms authorization lookups.
   async findCollaboratorRole(workspaceId: string, userId: string): Promise<string | null> {
      const cacheKey = `${workspaceId}:${userId}`;
      return rbacCache.getOrFetch(cacheKey, async () => {
         const res = await getPool().query<{ role: string }>(
            'SELECT role FROM workspace_collaborators WHERE workspace_id = $1 AND user_id = $2',
            [workspaceId, userId]
         );
         return res.rows[0]?.role || null;
      });
   }

   async findWorkspaceById(id: string): Promise<WorkspaceEntity | null> {
      const res = await getPool().query<WorkspaceEntity>(
         'SELECT id, title, owner_id, is_public FROM workspaces WHERE id = $1',
         [id]
      );
      return res.rows[0] || null;
   }

   async findWorkspaceOwner(id: string): Promise<{ owner_id: string } | null> {
      const res = await getPool().query<{ owner_id: string }>(
         'SELECT owner_id FROM workspaces WHERE id = $1',
         [id]
      );
      return res.rows[0] || null;
   }

   async findWorkspaceTitle(id: string): Promise<{ title: string } | null> {
      const res = await getPool().query<{ title: string }>(
         'SELECT title FROM workspaces WHERE id = $1',
         [id]
      );
      return res.rows[0] || null;
   }

   async findWorkspaceWithUserAccess(id: string, userId: string): Promise<{ owner_id: string; role?: string } | null> {
      const res = await getPool().query<{ owner_id: string; role?: string }>(
         'SELECT w.owner_id, wc.role FROM workspaces w LEFT JOIN workspace_collaborators wc ON w.id = wc.workspace_id AND wc.user_id = $2 WHERE w.id = $1',
         [id, userId]
      );
      return res.rows[0] || null;
   }

   async createWorkspace(ownerId: string, title: string): Promise<WorkspaceEntity> {
      const res = await getPool().query<WorkspaceEntity>(
         'INSERT INTO workspaces (owner_id, title) VALUES ($1, $2) RETURNING id, title, owner_id, is_public, created_at, updated_at',
         [ownerId, title]
      );
      return res.rows[0]!;
   }

   async updateWorkspaceTitle(id: string, title: string): Promise<WorkspaceEntity | null> {
      const res = await getPool().query<WorkspaceEntity>(
         'UPDATE workspaces SET title = $1 WHERE id = $2 RETURNING id, title, owner_id, is_public, created_at, updated_at',
         [title, id]
      );
      return res.rows[0] || null;
   }

   async findFirstUserWorkspace(userId: string): Promise<WorkspaceEntity | null> {
      const res = await getPool().query<WorkspaceEntity>(
         'SELECT id, title, owner_id, is_public FROM workspaces WHERE owner_id = $1 LIMIT 1',
         [userId]
      );
      return res.rows[0] || null;
   }

   async deleteWorkspace(id: string): Promise<void> {
      await getPool().query('DELETE FROM workspace_collaborators WHERE workspace_id = $1', [id]).catch(() => {});
      await getPool().query('DELETE FROM file_updates WHERE file_id IN (SELECT id FROM files WHERE workspace_id = $1)', [id]).catch(() => {});
      await getPool().query('DELETE FROM files WHERE workspace_id = $1', [id]).catch(() => {});
      await getPool().query('DELETE FROM snapshot_files WHERE snapshot_id IN (SELECT id FROM workspace_snapshots WHERE workspace_id = $1)', [id]).catch(() => {});
      await getPool().query('DELETE FROM snapshot_files WHERE snapshot_id IN (SELECT id FROM snapshots WHERE workspace_id = $1)', [id]).catch(() => {});
      await getPool().query('DELETE FROM workspace_snapshots WHERE workspace_id = $1', [id]).catch(() => {});
      await getPool().query('DELETE FROM snapshots WHERE workspace_id = $1', [id]).catch(() => {});
      await getPool().query('DELETE FROM git_commits WHERE workspace_id = $1', [id]).catch(() => {});
      await getPool().query('DELETE FROM workspaces WHERE id = $1', [id]);
      await invalidateWorkspaceAuth(id);
   }

   async getCollaborators(workspaceId: string): Promise<CollaboratorEntity[]> {
      const res = await getPool().query<CollaboratorEntity>(
         'SELECT u.id, u.username, u.email, wc.role, wc.joined_at FROM workspace_collaborators wc JOIN users u ON wc.user_id = u.id WHERE wc.workspace_id = $1 ORDER BY wc.joined_at ASC',
         [workspaceId]
      );
      return res.rows;
   }

   async upsertCollaborator(workspaceId: string, userId: string, role: string): Promise<Record<string, unknown>> {
      const res = await getPool().query(
         'INSERT INTO workspace_collaborators (workspace_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role RETURNING *',
         [workspaceId, userId, role]
      );
      await invalidateUserRbac(workspaceId, userId);
      return res.rows[0] as Record<string, unknown>;
   }

   async updateCollaboratorRole(workspaceId: string, userId: string, role: string): Promise<Record<string, unknown> | null> {
      const res = await getPool().query(
         'UPDATE workspace_collaborators SET role = $1 WHERE workspace_id = $2 AND user_id = $3 RETURNING *',
         [role, workspaceId, userId]
      );
      await invalidateUserRbac(workspaceId, userId);
      return (res.rows[0] as Record<string, unknown>) || null;
   }

   async deleteCollaborator(workspaceId: string, userId: string): Promise<boolean> {
      const res = await getPool().query(
         'DELETE FROM workspace_collaborators WHERE workspace_id = $1 AND user_id = $2 RETURNING *',
         [workspaceId, userId]
      );
      await invalidateUserRbac(workspaceId, userId);
      return res.rows.length > 0;
   }
}

export const workspaceRepository = new WorkspaceRepository();
