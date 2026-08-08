/**
 * Purpose: Data Access Object (DAO) and Repository for workspace files, binary Yjs CRDT states, and incremental update logs.
 * High-Level Architecture: Encapsulates database queries for file CRUD operations, recursive CTE file-path resolving, and CRDT update log append operations.
 * Primary Trade-offs: Recursive PostgreSQL Common Table Expressions (CTEs) compute full hierarchical file paths on database server nodes rather than fetching raw rows and traversing in Node.js memory.
 * Complexity: O(Depth) for recursive CTE path resolution.
 */

import { getPool } from '../db.js';
import type { QueryResultRow } from 'pg';
import { workspaceTreeCache, invalidateWorkspaceTree } from '../utils/redisCache.js';

export interface FileEntity extends QueryResultRow {
   id: string;
   parent_id: string | null;
   name: string;
   type: 'file' | 'directory';
   language: string | null;
   content?: string | null;
   yjs_state?: Buffer | null;
   author_map?: Record<string, unknown> | null;
}

export interface FilePathEntity extends QueryResultRow {
   id: string;
   path: string;
   type?: 'file' | 'directory';
   content?: string | null;
   language?: string | null;
}

// =============================================================================
// FILE REPOSITORY IMPLEMENTATION
// =============================================================================

export class FileRepository {
   // INTENT: Retrieve top-level and nested file tree structures for a workspace ordered by directories first.
   // L2 CACHE: Uses Redis workspaceTreeCache (TTL: 10m) with automatic mutation-driven eviction.
   async getWorkspaceFiles(workspaceId: string): Promise<FileEntity[]> {
      const cached = await workspaceTreeCache.getOrFetch<FileEntity[]>(workspaceId, async () => {
         const res = await getPool().query<FileEntity>(
            'SELECT id, parent_id, name, type, language FROM files WHERE workspace_id = $1 ORDER BY type DESC, name ASC',
            [workspaceId]
         );
         return res.rows;
      });
      return cached || [];
   }

   async findFileContent(fileId: string, workspaceId: string): Promise<string | null> {
      const res = await getPool().query<{ content: string | null }>(
         'SELECT content FROM files WHERE id = $1 AND workspace_id = $2',
         [fileId, workspaceId]
      );
      return res.rows.length ? (res.rows[0]!.content ?? '') : null;
   }

   async findFileById(fileId: string, workspaceId: string): Promise<FileEntity | null> {
      const res = await getPool().query<FileEntity>(
         'SELECT content, yjs_state, author_map FROM files WHERE id = $1 AND workspace_id = $2',
         [fileId, workspaceId]
      );
      return res.rows[0] || null;
   }

   // INTENT: Multi-key batch file lookup (O(1) roundtrip for multi-tab loads).
   async findFilesByIds(fileIds: string[], workspaceId: string): Promise<FileEntity[]> {
      if (fileIds.length === 0) return [];
      const res = await getPool().query<FileEntity>({
         name: 'find-files-by-ids',
         text: 'SELECT id, parent_id, name, type, language, content FROM files WHERE id = ANY($1::uuid[]) AND workspace_id = $2',
         values: [fileIds, workspaceId]
      });
      return res.rows;
   }

   // =============================================================================
   // RECURSIVE RECURSIVE CTE PATH RESOLUTION
   // =============================================================================

   // INTENT: Resolve relative path string (`src/components/App.tsx`) for a file ID using a recursive SQL CTE.
   // WHY: Pushes path concatenation computation down to the PostgreSQL query engine.
   // INTERVIEW NOTES: Recursive CTEs start at root elements (`parent_id IS NULL`) and iteratively join child nodes.
   async findFilePath(workspaceId: string, fileId: string): Promise<string | null> {
      const res = await getPool().query<{ path: string }>(
         `WITH RECURSIVE cte AS (
            SELECT id, name::text as path FROM files WHERE workspace_id = $1 AND parent_id IS NULL
            UNION ALL
            SELECT f.id, (cte.path || '/' || f.name)::text FROM files f JOIN cte ON f.parent_id = cte.id WHERE f.workspace_id = $1
         ) SELECT path FROM cte WHERE id = $2;`,
         [workspaceId, fileId]
      );
      return res.rows[0]?.path || null;
   }

   // INTENT: Retrieve flattened list of all relative file paths and file contents for container sandbox initialization.
   async getFlattenedFilePaths(workspaceId: string): Promise<FilePathEntity[]> {
      const res = await getPool().query<FilePathEntity>(
         `WITH RECURSIVE file_path_cte AS (
            SELECT id, parent_id, name, type, content, language, name::text as path FROM files WHERE workspace_id = $1 AND parent_id IS NULL
            UNION ALL
            SELECT f.id, f.parent_id, f.name, f.type, f.content, f.language, (cte.path || '/' || f.name)::text as path FROM files f INNER JOIN file_path_cte cte ON f.parent_id = cte.id WHERE f.workspace_id = $1
         ) SELECT id, path, content, language, type FROM file_path_cte;`,
         [workspaceId]
      );
      return res.rows;
   }

   // =============================================================================
   // MUTATION OPERATIONS & CRDT LOG APPENDS
   // =============================================================================

   async insertFile(
      workspaceId: string,
      name: string,
      type: 'file' | 'directory',
      parentId: string | null = null,
      language: string | null = null,
      content: string = '',
      yjsState: Buffer | null = null
   ): Promise<FileEntity> {
      const res = await getPool().query<FileEntity>(
         'INSERT INTO files (workspace_id, name, type, parent_id, language, content, yjs_state) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, parent_id, name, type, language',
         [workspaceId, name, type, parentId, language, content, yjsState]
      );
      await invalidateWorkspaceTree(workspaceId);
      return res.rows[0]!;
   }

   // INTENT: Bulk insert multiple files in a single roundtrip network packet via unnest arrays.
   // WHY: Reduces repository scaffolding / template creation from 50 sequential roundtrips to 1 atomic transaction.
   async insertManyFiles(
      workspaceId: string,
      files: Array<{
         name: string;
         type: 'file' | 'directory';
         parentId?: string | null;
         language?: string | null;
         content?: string;
      }>
   ): Promise<FileEntity[]> {
      if (files.length === 0) return [];
      const names = files.map(f => f.name);
      const types = files.map(f => f.type);
      const parentIds = files.map(f => f.parentId || null);
      const languages = files.map(f => f.language || null);
      const contents = files.map(f => f.content || '');

      const res = await getPool().query<FileEntity>(
         `INSERT INTO files (workspace_id, name, type, parent_id, language, content)
          SELECT $1, unnest($2::text[]), unnest($3::node_type[]), unnest($4::uuid[]), unnest($5::text[]), unnest($6::text[])
          RETURNING id, parent_id, name, type, language`,
         [workspaceId, names, types, parentIds, languages, contents]
      );
      await invalidateWorkspaceTree(workspaceId);
      return res.rows;
   }

   async updateFileContent(fileId: string, workspaceId: string, content: string): Promise<void> {
      await getPool().query(
         'UPDATE files SET content = $1, updated_at = NOW() WHERE id = $2 AND workspace_id = $3',
         [content, fileId, workspaceId]
      );
   }

   async updateYjsState(fileId: string, yjsState: Buffer): Promise<void> {
      await getPool().query('UPDATE files SET yjs_state = $1 WHERE id = $2', [yjsState, fileId]);
   }

   async updateFileAndYjsState(fileId: string, content: string, yjsState: Buffer, authorMapJson: string): Promise<void> {
      await getPool().query(
         'UPDATE files SET yjs_state = $1, content = $2, author_map = $3 WHERE id = $4',
         [yjsState, content, authorMapJson, fileId]
      );
   }

   async updateFileMetadata(fileId: string, name: string, parentId: string | null, language: string | null, workspaceId?: string): Promise<void> {
      await getPool().query(
         'UPDATE files SET name = $1, parent_id = $2, language = $3 WHERE id = $4',
         [name, parentId, language, fileId]
      );
      if (workspaceId) {
         await invalidateWorkspaceTree(workspaceId);
      }
   }

   async deleteFile(fileId: string, workspaceId?: string): Promise<void> {
      if (workspaceId) {
         await getPool().query('DELETE FROM files WHERE id = $1 AND workspace_id = $2', [fileId, workspaceId]);
         await invalidateWorkspaceTree(workspaceId);
      } else {
         await getPool().query('DELETE FROM files WHERE id = $1', [fileId]);
      }
   }

   // INTENT: Retrieve ordered list of binary delta updates for replaying document history.
   async getFileUpdates(fileId: string): Promise<{ update: Buffer }[]> {
      const res = await getPool().query<{ update: Buffer }>(
         'SELECT update FROM file_updates WHERE file_id = $1 ORDER BY seq ASC',
         [fileId]
      );
      return res.rows;
   }

   // INTENT: Append binary CRDT update packet to append-only update log table.
   async insertFileUpdate(fileId: string, update: Buffer): Promise<void> {
      await getPool().query(
         'INSERT INTO file_updates (file_id, update) VALUES ($1, $2)',
         [fileId, update]
      );
   }
}

export const fileRepository = new FileRepository();
