import type { QueryResultRow } from 'pg';
import { getPool } from '../db.js';
import type { DbQueryResult, PreparedQueryConfig } from '../types/db.types.js';

const preparedStatements = new Map<string, boolean>();

export async function executeQuery<T extends QueryResultRow = QueryResultRow>(
   queryName: string,
   query: string,
   params: unknown[]
): Promise<DbQueryResult<T>> {
   const pool = getPool();
   
   if (!preparedStatements.has(queryName)) {
      try {
         await pool.query(`PREPARE ${queryName} AS ${query}`);
         preparedStatements.set(queryName, true);
      } catch (err: unknown) {
         if (err instanceof Error && !err.message.includes('already exists')) {
            console.error(`[PreparedQuery] Failed to prepare ${queryName}:`, err);
         }
      }
   }
   
   try {
      const placeholders = params.map((_, i) => `$${i + 1}`).join(', ');
      const result = await pool.query(`EXECUTE ${queryName}(${placeholders})`, params);
      return result as DbQueryResult<T>;
   } catch {
      console.warn(`[PreparedQuery] Execution failed for ${queryName}, falling back to regular query`);
      const result = await pool.query(query, params);
      return result as DbQueryResult<T>;
   }
}

export const PreparedQueries = {
   GET_FILE_CONTENT: {
      name: 'get_file_content',
      query: 'SELECT content FROM files WHERE id = $1 AND workspace_id = $2'
   },
   
   GET_FILE_HISTORY: {
      name: 'get_file_history',
      query: 'SELECT yjs_state, author_map FROM files WHERE id = $1 AND workspace_id = $2'
   },
   
   GET_WORKSPACE_FILES: {
      name: 'get_workspace_files',
      query: 'SELECT id, parent_id, name, type, language FROM files WHERE workspace_id = $1 ORDER BY type DESC, name ASC'
   },
   
   GET_USER_BY_ID: {
      name: 'get_user_by_id',
      query: 'SELECT id, username, email FROM users WHERE id = $1'
   },
   
   GET_USER_BY_EMAIL: {
      name: 'get_user_by_email',
      query: 'SELECT id, username, email, password_hash FROM users WHERE email = $1'
   },
   
   GET_WORKSPACE: {
      name: 'get_workspace',
      query: 'SELECT id, title, owner_id, is_public FROM workspaces WHERE id = $1'
   },
   
   GET_USER_WORKSPACE: {
      name: 'get_user_workspace',
      query: 'SELECT id, title, owner_id, is_public FROM workspaces WHERE owner_id = $1 LIMIT 1'
   },
   
   CHECK_WORKSPACE_ACCESS: {
      name: 'check_workspace_access',
      query: 'SELECT w.owner_id, wc.role FROM workspaces w LEFT JOIN workspace_collaborators wc ON w.id = wc.workspace_id AND wc.user_id = $2 WHERE w.id = $1'
   }
};

export async function getPrepared<T extends QueryResultRow = QueryResultRow>(
   preparedQuery: PreparedQueryConfig,
   params: unknown[]
): Promise<DbQueryResult<T>> {
   return executeQuery<T>(preparedQuery.name, preparedQuery.query, params);
}

export async function clearPreparedStatements(): Promise<void> {
   const pool = getPool();
   for (const [name] of preparedStatements) {
      try {
         await pool.query(`DEALLOCATE ${name}`);
      } catch {
      }
   }
   preparedStatements.clear();
}
