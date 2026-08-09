import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:my_secure_db_password@localhost:5432/sandbox';

describe('Real-Time Concurrency & Lock Stress Suite (50 Simultaneous Sessions)', () => {
  let pool: Pool;
  let testWorkspaceId: string;
  let testFileId: string;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: 25,
      idleTimeoutMillis: 10000,
      statement_timeout: 5000,
    });

    // Create an isolated workspace and document for the concurrent stress test
    const userRes = await pool.query('SELECT id FROM users LIMIT 1');
    const ownerId = userRes.rows[0]?.id;

    const wsRes = await pool.query(`
      INSERT INTO workspaces (id, owner_id, title)
      VALUES (uuid_generate_v4(), $1, 'Concurrent Lock Stress Workspace')
      RETURNING id
    `, [ownerId]);
    testWorkspaceId = wsRes.rows[0].id;

    const fileRes = await pool.query(`
      INSERT INTO files (id, workspace_id, name, type, content, size_bytes)
      VALUES (uuid_generate_v4(), $1, 'concurrent_stress_' || floor(random() * 100000)::text || '.ts', 'file'::node_type, '// Initial Code State', 21)
      RETURNING id
    `, [testWorkspaceId]);
    testFileId = fileRes.rows[0].id;
  }, 30000);

  afterAll(async () => {
    if (testWorkspaceId) {
      await pool.query('DELETE FROM file_updates WHERE file_id = $1', [testFileId]).catch(() => {});
      await pool.query('DELETE FROM files WHERE workspace_id = $1', [testWorkspaceId]).catch(() => {});
      await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId]).catch(() => {});
    }
    await pool.end();
  });

  it('50 simultaneous user sessions writing to the same document execute without deadlocks', async () => {
    const CONCURRENT_WORKERS = 50;
    const errors: Error[] = [];
    const deadlocks: string[] = [];
    let successfulCommits = 0;

    const workerTasks = Array.from({ length: CONCURRENT_WORKERS }, async (_, workerId) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Acquire transactional row lock
        const res = await client.query(`
          SELECT id, content, size_bytes FROM files WHERE id = $1 FOR UPDATE
        `, [testFileId]);

        expect(res.rows.length).toBe(1);

        // Simulate micro-edit payload
        const updatedContent = `// Worker ${workerId} Edit at ${Date.now()}`;
        await client.query(`
          UPDATE files SET content = $1, size_bytes = $2 WHERE id = $3
        `, [updatedContent, updatedContent.length, testFileId]);

        // Insert concurrent CRDT delta log with buffer payload
        const deltaBuf = Buffer.from([0x01, 0x01, (workerId & 0xff), (workerId >> 8)]);
        await client.query(`
          INSERT INTO file_updates (file_id, update)
          VALUES ($1, $2)
        `, [testFileId, deltaBuf]);

        await client.query('COMMIT');
        successfulCommits++;
      } catch (err: any) {
        await client.query('ROLLBACK').catch(() => {});
        errors.push(err);
        if (err.code === '40P01') {
          deadlocks.push(`Deadlock in worker ${workerId}: ${err.message}`);
        }
      } finally {
        client.release();
      }
    });

    const startTime = Date.now();
    await Promise.all(workerTasks);
    const durationMs = Date.now() - startTime;

    console.log(`[Concurrency Stress] 50 Workers completed in ${durationMs}ms with ${successfulCommits} successful commits.`);

    // Assert zero deadlocks occurred
    expect(deadlocks).toHaveLength(0);
    expect(errors).toHaveLength(0);
    expect(successfulCommits).toBe(CONCURRENT_WORKERS);

    // Verify all 50 CRDT updates were safely persisted
    const countRes = await pool.query('SELECT count(*) FROM file_updates WHERE file_id = $1', [testFileId]);
    expect(parseInt(countRes.rows[0].count, 10)).toBe(CONCURRENT_WORKERS);
  });

  it('50 concurrent read requests execute in parallel with 0 contention or query starvation', async () => {
    const CONCURRENT_READERS = 50;
    const start = Date.now();

    const readPromises = Array.from({ length: CONCURRENT_READERS }, async () => {
      const res = await pool.query('SELECT id, workspace_id, content, size_bytes FROM files WHERE id = $1', [testFileId]);
      return res.rows[0];
    });

    const results = await Promise.all(readPromises);
    const totalDuration = Date.now() - start;

    expect(results).toHaveLength(CONCURRENT_READERS);
    results.forEach(row => {
      expect(row.id).toBe(testFileId);
    });

    expect(totalDuration).toBeLessThan(1000);
    console.log(`[Read Concurrency] 50 concurrent reads completed in ${totalDuration}ms (${(totalDuration / CONCURRENT_READERS).toFixed(2)}ms avg per read).`);
  });
});
