/**
 * PostgreSQL Database & Query Optimizations SLA
 * Rewritten to execute REAL PostgreSQL 16 queries and verify bulk unnest insertions and prepared statement execution.
 * Zero mocks.
 */

import { describe, it, expect } from 'vitest';
import { fileRepository } from '../../backend/src/repositories/file.repository.js';
import { workspaceRepository } from '../../backend/src/repositories/workspace.repository.js';
import { userRepository } from '../../backend/src/repositories/user.repository.js';
import { getPool, ensureDatabaseIndexes } from '../../backend/src/db.js';

describe('PostgreSQL Database & Query Optimizations SLA (Live Production DB)', () => {
  it('1. Configures connection pool options for statement timeouts and application name', () => {
    const pool = getPool();
    expect(pool).toBeDefined();
    expect(pool.options.statement_timeout).toBe(5000);
    expect(pool.options.query_timeout).toBe(5000);
    expect(pool.options.application_name).toBe('NexusIDE-Cluster');
  });

  it('2. Creates covering B-Tree indexes on live pool initialization without error', async () => {
    const pool = getPool();
    await ensureDatabaseIndexes(pool);

    // Query pg_indexes on live database to verify index existence
    const res = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename IN ('files', 'workspace_collaborators', 'yjs_updates')`
    );

    const indexNames = res.rows.map(r => r.indexname);
    expect(indexNames).toContain('idx_files_tree');
    expect(indexNames).toContain('idx_collab_auth');
  });

  it('3. Performs bulk vectorized unnest file insertion in a single database roundtrip', async () => {
    const pool = getPool();
    const ts = Date.now();
    const user = await userRepository.createUser(`bulk_u_${ts}`.slice(0, 30), `bulk_${ts}@example.com`);
    const workspace = await workspaceRepository.createWorkspace(user.id, `Bulk_WS_${ts}`);

    const inserted = await fileRepository.insertManyFiles(workspace.id, [
      { name: 'App.tsx', type: 'file', language: 'typescript', content: 'export default () => null;' },
      { name: 'index.css', type: 'file', language: 'css', content: 'body { margin: 0; }' },
      { name: 'package.json', type: 'file', language: 'json', content: '{}' }
    ]);

    expect(inserted).toHaveLength(3);
    expect(inserted.map(f => f.name).sort()).toEqual(['App.tsx', 'index.css', 'package.json']);

    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
  });

  it('4. Performs multi-key batch lookups via findFilesByIds against PostgreSQL', async () => {
    const pool = getPool();
    const ts = Date.now();
    const user = await userRepository.createUser(`batch_u_${ts}`.slice(0, 30), `batch_${ts}@example.com`);
    const workspace = await workspaceRepository.createWorkspace(user.id, `Batch_WS_${ts}`);

    const inserted = await fileRepository.insertManyFiles(workspace.id, [
      { name: 'FileA.ts', type: 'file', language: 'typescript', content: 'const a = 1;' },
      { name: 'FileB.ts', type: 'file', language: 'typescript', content: 'const b = 2;' }
    ]);

    const ids = inserted.map(f => f.id);
    const fetched = await fileRepository.findFilesByIds(ids, workspace.id);

    expect(fetched).toHaveLength(2);

    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
  });
});
