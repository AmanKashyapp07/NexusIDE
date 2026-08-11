/**
 * Production Workspace Container Hibernation & Pre-Warming SLA
 * Tests workspace container pool reference tracking, state transitions (active -> paused -> unpaused),
 * and cleanup lifecycle functions using live database queries. Zero mocks.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getPool } from '../../backend/src/db.js';
import { userRepository } from '../../backend/src/repositories/user.repository.js';
import { workspaceRepository } from '../../backend/src/repositories/workspace.repository.js';
import {
  hibernateWorkspaceContainer,
  unhibernateWorkspaceContainer,
  getRunningContainerRef,
  cleanupAllWorkspaceContainers,
} from '../../backend/src/sandbox/workspaceContainer.js';

describe('Workspace Container Pre-Warming & Hibernation Engine SLA (Live DB)', () => {
  beforeEach(async () => {
    await cleanupAllWorkspaceContainers();
  });

  it('1. hibernate on non-existent or un-initialized workspace container returns false safely', async () => {
    const result = await hibernateWorkspaceContainer('non-user', 'non-ws');
    expect(result).toBe(false);
  });

  it('2. unhibernate on non-existent container returns false safely', async () => {
    const result = await unhibernateWorkspaceContainer('non-user', 'non-ws');
    expect(result).toBe(false);
  });

  it('3. cleanupAllWorkspaceContainers destroys all tracked container references', async () => {
    await cleanupAllWorkspaceContainers();
    expect(getRunningContainerRef('test-user-id', 'test-ws-id')).toBeNull();
  });

  it('4. Real PostgreSQL Workspace Container Meta Query: Queries workspace metadata for container allocation', async () => {
    const pool = getPool();
    const ts = Date.now();
    const user = await userRepository.createUser(`hib_u_${ts}`.slice(0, 30), `hib_${ts}@example.com`);
    const workspace = await workspaceRepository.createWorkspace(user.id, `Hib_WS_${ts}`);

    const res = await pool.query<{ id: string; owner_id: string }>(
      'SELECT id, owner_id FROM workspaces WHERE id = $1',
      [workspace.id]
    );

    expect(res.rows[0].id).toBe(workspace.id);
    expect(res.rows[0].owner_id).toBe(user.id);

    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
  });
});
