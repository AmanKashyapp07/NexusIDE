import { describe, it, expect } from 'vitest';
import { redis } from '../../backend/src/utils/redisCache.js';
import { getPool } from '../../backend/src/db.js';
import { userRepository } from '../../backend/src/repositories/user.repository.js';
import { workspaceRepository } from '../../backend/src/repositories/workspace.repository.js';

describe('Phase B: Unpersisted Buffer-to-DB Crash Recovery Live Infrastructure SLA', () => {
  it('1. Ingests raw CRDT delta updates into Redis RAM and flushes synchronously to PostgreSQL 16', async () => {
    const pool = getPool();
    const timestamp = Date.now();
    const testUsername = `wal_${timestamp}`.slice(0, 30);

    // 1. Create real test user, workspace, and file in PostgreSQL
    const user = await userRepository.createUser(testUsername, `wal_${timestamp}@example.com`);
    const workspace = await workspaceRepository.createWorkspace(user.id, `WAL_WS_${timestamp}`);

    const fileRes = await pool.query<{ id: string }>(
      `INSERT INTO files (workspace_id, name, type, language) VALUES ($1, $2, 'file', 'typescript') RETURNING id`,
      [workspace.id, 'recovery.ts']
    );
    const fileId = fileRes.rows[0].id;
    const redisKey = `crdt_buffer:${fileId}`;

    try {
      // 2. Ingest binary updates into Redis list buffer
      const update1 = Buffer.from('crdt_delta_chunk_1').toString('hex');
      const update2 = Buffer.from('crdt_delta_chunk_2').toString('hex');

      await redis.rpush(redisKey, update1, update2);
      const bufferLength = await redis.llen(redisKey);
      expect(bufferLength).toBe(2);

      // 3. Simulate startup crash recovery WAL drain into PostgreSQL
      const unpersistedItems = await redis.lrange(redisKey, 0, -1);
      const dbClient = await pool.connect();

      try {
        await dbClient.query('BEGIN');
        for (const hexPayload of unpersistedItems) {
          const payloadBuf = Buffer.from(hexPayload, 'hex');
          await dbClient.query(
            'INSERT INTO file_updates (file_id, update) VALUES ($1, $2)',
            [fileId, payloadBuf]
          );
        }
        await dbClient.query('COMMIT');
        await redis.del(redisKey);
      } catch (err) {
        await dbClient.query('ROLLBACK');
        throw err;
      } finally {
        dbClient.release();
      }

      // 4. Verify Redis buffer is drained and PostgreSQL rows exist
      const remainingRedisKeys = await redis.exists(redisKey);
      expect(remainingRedisKeys).toBe(0);

      const dbUpdates = await pool.query('SELECT * FROM file_updates WHERE file_id = $1', [fileId]);
      expect(dbUpdates.rowCount).toBe(2);

      console.log(`[WAL Recovery SLA] Drained ${unpersistedItems.length} unpersisted Redis updates into PostgreSQL 16 file_updates table`);
    } finally {
      // Clean up test user & workspace (cascades file_updates deletion)
      await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
    }
  });
});
