import { getPool } from '../db.js';
import type { QueryResultRow } from 'pg';

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

export class FileRepository {
   async getWorkspaceFiles(workspaceId: string): Promise<FileEntity[]> {
      const res = await getPool().query<FileEntity>(
         'SELECT id, parent_id, name, type, language FROM files WHERE workspace_id = $1 ORDER BY type DESC, name ASC',
         [workspaceId]
      );
      return res.rows;
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
      return res.rows[0]!;
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

   async updateFileMetadata(fileId: string, name: string, parentId: string | null, language: string | null): Promise<void> {
      await getPool().query(
         'UPDATE files SET name = $1, parent_id = $2, language = $3 WHERE id = $4',
         [name, parentId, language, fileId]
      );
   }

   async deleteFile(fileId: string, workspaceId?: string): Promise<void> {
      if (workspaceId) {
         await getPool().query('DELETE FROM files WHERE id = $1 AND workspace_id = $2', [fileId, workspaceId]);
      } else {
         await getPool().query('DELETE FROM files WHERE id = $1', [fileId]);
      }
   }

   async getFileUpdates(fileId: string): Promise<{ update: Buffer }[]> {
      const res = await getPool().query<{ update: Buffer }>(
         'SELECT update FROM file_updates WHERE file_id = $1 ORDER BY seq ASC',
         [fileId]
      );
      return res.rows;
   }

   async insertFileUpdate(fileId: string, update: Buffer): Promise<void> {
      await getPool().query(
         'INSERT INTO file_updates (file_id, update) VALUES ($1, $2)',
         [fileId, update]
      );
   }
}

export const fileRepository = new FileRepository();
