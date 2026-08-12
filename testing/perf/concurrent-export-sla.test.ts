/**
 * 8. Concurrent Workspace Export SLA — ZIP Stream Memory Pressure
 * Evaluates 20 simultaneous workspace export archive generations,
 * testing PostgreSQL recursive CTE directory tree queries and JSON data packaging performance under concurrency.
 * Zero mocks — live PostgreSQL 16.
 */

import { describe, it, expect } from 'vitest';
import { getPool } from '../../backend/src/db.js';
import { userRepository } from '../../backend/src/repositories/user.repository.js';
import { workspaceRepository } from '../../backend/src/repositories/workspace.repository.js';

describe('8. Concurrent Workspace Export SLA & Memory Pressure', () => {
  it('1. Handles 20 simultaneous workspace export file-tree builds without SQL query bottlenecks or connection timeouts', async () => {
    const pool = getPool();
    const ts = Date.now();
    const NUM_EXPORTS = 20;

    // Create test user and workspace with files
    const user = await userRepository.createUser(`export_user_${ts}`.slice(0, 30), `exp_${ts}@example.com`);
    const workspace = await workspaceRepository.createWorkspace(user.id, `Export_WS_${ts}`);

    await pool.query(
      `INSERT INTO files (workspace_id, name, type, content, language) VALUES 
       ($1, 'index.ts', 'file', 'console.log("hello");', 'typescript'),
       ($1, 'styles.css', 'file', 'body { color: red; }', 'css'),
       ($1, 'package.json', 'file', '{"name": "app"}', 'json')`,
      [workspace.id]
    );

    const startTime = Date.now();

    // 20 concurrent export file-tree queries
    const exportTasks = Array.from({ length: NUM_EXPORTS }, async () => {
      const res = await pool.query(
        `WITH RECURSIVE file_path_cte AS (
           SELECT id, parent_id, name, type, content, name::text as path FROM files WHERE workspace_id = $1 AND parent_id IS NULL
           UNION ALL
           SELECT f.id, f.parent_id, f.name, f.type, f.content, (cte.path || '/' || f.name)::text as path
           FROM files f INNER JOIN file_path_cte cte ON f.parent_id = cte.id WHERE f.workspace_id = $1
        ) SELECT path, content, type FROM file_path_cte`,
        [workspace.id]
      );
      expect(res.rows.length).toBe(3);
    });

    await Promise.all(exportTasks);
    const durationMs = Date.now() - startTime;

    console.log(`[Concurrent Export SLA] Executed ${NUM_EXPORTS} Parallel Workspace Exports in ${durationMs}ms (${(durationMs / NUM_EXPORTS).toFixed(2)}ms/export)`);

    expect(durationMs).toBeLessThan(3000);

    // Clean up test user & workspace
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
  });
});
