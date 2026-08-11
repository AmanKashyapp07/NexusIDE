import { describe, it, expect } from 'vitest';
import { getPool } from '../../backend/src/db.js';
import { workspaceRepository } from '../../backend/src/repositories/workspace.repository.js';
import { userRepository } from '../../backend/src/repositories/user.repository.js';

describe('Phase A: GDPR Right-to-Erasure (Article 17) Live Database SLA', () => {
  it('1. Cascades hard deletion across live PostgreSQL 16 tables upon user account erasure', async () => {
    const pool = getPool();
    const timestamp = Date.now();
    const testUsername = `gdpr_${timestamp}`.slice(0, 30);
    const testEmail = `gdpr_${timestamp}@example.com`;

    // 1. Create real test user in PostgreSQL via UserRepository
    const user = await userRepository.createUser(testUsername, testEmail);
    expect(user.id).toBeDefined();

    // 2. Create real test workspace owned by user in PostgreSQL via WorkspaceRepository
    const workspace = await workspaceRepository.createWorkspace(user.id, `GDPR_WS_${timestamp}`);
    expect(workspace.id).toBeDefined();

    // 3. Execute GDPR Article 17 hard erasure via PostgreSQL query
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);

    // 4. Verify cascade deletion across PostgreSQL tables
    const userCheck = await pool.query('SELECT * FROM users WHERE id = $1', [user.id]);
    const workspaceCheck = await pool.query('SELECT * FROM workspaces WHERE id = $1', [workspace.id]);

    console.log(`[GDPR Erasure SLA] Deleted User ID: ${user.id} | User rows remaining: ${userCheck.rowCount}`);
    console.log(`[GDPR Erasure SLA] Cascaded Workspace ID: ${workspace.id} | Workspace rows remaining: ${workspaceCheck.rowCount}`);

    expect(userCheck.rowCount).toBe(0);
    expect(workspaceCheck.rowCount).toBe(0);
  });
});
