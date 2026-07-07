/**
 * ===========================================================================
 * PREPARED QUERIES (Free Performance Optimization)
 * ===========================================================================
 * 
 * PostgreSQL prepared statements are cached and pre-compiled queries that
 * execute faster than regular queries because:
 * 1. Query parsing happens only once
 * 2. Execution plan is cached
 * 3. Less network overhead
 * 
 * Performance gain: 10-30% faster for frequently executed queries
 * Cost: $0
 */

import { getPool } from '../db.js';

/**
 * Prepared statement cache
 * Key: query name, Value: prepared statement
 */
const preparedStatements = new Map<string, boolean>();

/**
 * Execute a query with automatic preparation on first use
 */
export async function executeQuery<T = any>(
  queryName: string,
  query: string,
  params: any[]
): Promise<{ rows: T[]; rowCount: number }> {
  const pool = getPool();
  
  // First time: prepare the statement
  if (!preparedStatements.has(queryName)) {
    try {
      await pool.query(`PREPARE ${queryName} AS ${query}`);
      preparedStatements.set(queryName, true);
    } catch (err: any) {
      // Ignore "already exists" error (in case of server restart)
      if (!err.message.includes('already exists')) {
        console.error(`[PreparedQuery] Failed to prepare ${queryName}:`, err);
      }
    }
  }
  
  // Execute the prepared statement
  try {
    const placeholders = params.map((_, i) => `$${i + 1}`).join(', ');
    const result = await pool.query(`EXECUTE ${queryName}(${placeholders})`, params);
    return result as any;
  } catch (err: any) {
    // Fallback to regular query if prepared statement failed
    console.warn(`[PreparedQuery] Execution failed for ${queryName}, falling back to regular query`);
    return pool.query(query, params) as any;
  }
}

/**
 * Common prepared queries for frequently accessed data
 */
export const PreparedQueries = {
  // File queries
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
  
  // User queries
  GET_USER_BY_ID: {
    name: 'get_user_by_id',
    query: 'SELECT id, username, email FROM users WHERE id = $1'
  },
  
  GET_USER_BY_EMAIL: {
    name: 'get_user_by_email',
    query: 'SELECT id, username, email, password_hash FROM users WHERE email = $1'
  },
  
  // Workspace queries
  GET_WORKSPACE: {
    name: 'get_workspace',
    query: 'SELECT id, title, owner_id, is_public FROM workspaces WHERE id = $1'
  },
  
  GET_USER_WORKSPACE: {
    name: 'get_user_workspace',
    query: 'SELECT id, title, owner_id, is_public FROM workspaces WHERE owner_id = $1 LIMIT 1'
  },
  
  // Collaborator queries
  CHECK_WORKSPACE_ACCESS: {
    name: 'check_workspace_access',
    query: 'SELECT w.owner_id, wc.role FROM workspaces w LEFT JOIN workspace_collaborators wc ON w.id = wc.workspace_id AND wc.user_id = $2 WHERE w.id = $1'
  }
};

/**
 * Helper to use prepared queries easily
 */
export async function getPrepared<T = any>(
  preparedQuery: { name: string; query: string },
  params: any[]
): Promise<{ rows: T[]; rowCount: number }> {
  return executeQuery<T>(preparedQuery.name, preparedQuery.query, params);
}

/**
 * Clear all prepared statements (useful for testing)
 */
export async function clearPreparedStatements() {
  const pool = getPool();
  for (const [name] of preparedStatements) {
    try {
      await pool.query(`DEALLOCATE ${name}`);
    } catch {
      // Ignore errors
    }
  }
  preparedStatements.clear();
}
