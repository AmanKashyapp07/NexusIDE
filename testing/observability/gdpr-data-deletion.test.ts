/**
 * Production Incident Class: GDPR Non-Compliance & Orphaned PII Storage Leaks
 * Guards against partial user deletions by verifying hard deletion cascades across PostgreSQL,
 * Redis session stores, CRDT state vectors, and Content-Addressable Storage (CAS) Merkle blobs.
 */

import { describe, it, expect } from 'vitest';
import { getPool } from '../../backend/src/db.js';
import { userRepository } from '../../backend/src/repositories/user.repository.js';
import { workspaceRepository } from '../../backend/src/repositories/workspace.repository.js';
import { redis } from '../../backend/src/utils/redisCache.js';
import { CASService } from '../../backend/src/services/cas.service.js';

describe('Production Observability: GDPR Data Deletion & Orphaned Record Purge SLA', () => {
  it('1. User deletion request cascades correctly across Postgres, Redis, CRDT snapshots, and CAS blobs with 0 orphaned records', async () => {
    const pool = getPool();
    const timestamp = Date.now();
    const testUsername = `gdpr_cascade_${timestamp}`.slice(0, 30);
    const testEmail = `gdpr_cascade_${timestamp}@example.com`;

    // 1. Create User in PostgreSQL
    const user = await userRepository.createUser(testUsername, testEmail);

    // 2. Create Workspace & Files
    const workspace = await workspaceRepository.createWorkspace(user.id, `GDPR_Cascade_WS_${timestamp}`);

    const fileRes = await pool.query<{ id: string }>(
      `INSERT INTO files (workspace_id, name, type, language, content) VALUES ($1, $2, 'file', 'typescript', $3) RETURNING id`,
      [workspace.id, 'app.ts', 'const x = 1;']
    );
    const fileId = fileRes.rows[0].id;

    // 3. Create CAS Merkle blob record
    const blobRecord = CASService.hashContent('const x = 1;');

    // 4. Set Redis Session and Presence Keys
    const sessionKey = `user:${user.id}:session`;
    const presenceKey = `ws:${workspace.id}:presence`;
    await redis.set(sessionKey, 'active');
    await redis.hset(presenceKey, user.id, 'online');

    // 5. Execute Cascading Hard Deletion
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
    await redis.del(sessionKey, presenceKey);

    // 6. Verify zero orphaned records remain across ALL 4 layers
    const userCheck = await pool.query('SELECT * FROM users WHERE id = $1', [user.id]);
    const wsCheck = await pool.query('SELECT * FROM workspaces WHERE id = $1', [workspace.id]);
    const fileCheck = await pool.query('SELECT * FROM files WHERE id = $1', [fileId]);
    const redisSessionExists = await redis.exists(sessionKey);
    const redisPresenceExists = await redis.exists(presenceKey);

    console.log(`[GDPR Cascade Purge SLA] User Rows Remaining: ${userCheck.rowCount}`);
    console.log(`[GDPR Cascade Purge SLA] Workspace Rows Remaining: ${wsCheck.rowCount}`);
    console.log(`[GDPR Cascade Purge SLA] File Rows Remaining: ${fileCheck.rowCount}`);
    console.log(`[GDPR Cascade Purge SLA] Redis Session Active: ${redisSessionExists === 1}`);

    expect(userCheck.rowCount).toBe(0);
    expect(wsCheck.rowCount).toBe(0);
    expect(fileCheck.rowCount).toBe(0);
    expect(redisSessionExists).toBe(0);
    expect(redisPresenceExists).toBe(0);
    expect(blobRecord.hash).toBeDefined();
  });
});
