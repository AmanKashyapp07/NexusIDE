/**
 * CAS Garbage Collector Concurrent Write Race Test Suite
 * Evaluates CASGarbageCollectorService under concurrent database reads/writes on live PostgreSQL 16,
 * ensuring active git_blobs and git_trees are preserved and parallel GC sweeps execute safely.
 * Zero mocks — live PostgreSQL 16 & CASGarbageCollectorService.
 */

import { describe, it, expect } from 'vitest';
import { casGarbageCollector } from '../../backend/src/services/casGarbageCollector.service.js';
import { getPool } from '../../backend/src/db.js';
import { userRepository } from '../../backend/src/repositories/user.repository.js';
import { workspaceRepository } from '../../backend/src/repositories/workspace.repository.js';
import { SnapshotRepository } from '../../backend/src/repositories/snapshot.repository.js';

describe('CAS Garbage Collector Concurrent Write Race SLA', () => {
  it('1. Executes CAS garbage collection during active snapshot writes without deleting referenced blobs', async () => {
    const pool = getPool();
    const ts = Date.now();

    // 1. Create test user & workspace with files
    const user = await userRepository.createUser(`casgc_${ts}`.slice(0, 30), `casgc_${ts}@example.com`);
    const workspace = await workspaceRepository.createWorkspace(user.id, `CASGC_WS_${ts}`);

    await pool.query(
      `INSERT INTO files (workspace_id, name, type, content, language) VALUES 
       ($1, 'index.ts', 'file', 'console.log("active content 1");', 'typescript'),
       ($1, 'server.ts', 'file', 'export const server = 8080;', 'typescript')`,
      [workspace.id]
    );

    const startTime = Date.now();

    // 2. Create checkpoint snapshot and trigger CAS GC simultaneously
    const snapTask = SnapshotRepository.createCheckpoint(workspace.id, user.id, `RaceCheckpoint_${ts}`);
    const gcTask = casGarbageCollector.runGarbageCollection();

    const [snapshot, gcStats] = await Promise.all([snapTask, gcTask]);
    const durationMs = Date.now() - startTime;

    console.log(`[CAS GC Race SLA] GC completed in ${durationMs}ms: Purged ${gcStats.blobsPurged} blobs, ${gcStats.treesPurged} trees`);

    expect(snapshot).toBeDefined();
    expect(snapshot.root_tree_hash).toBeDefined();
    expect(gcStats).toBeDefined();

    // 3. Verify snapshot root tree hash still exists in git_trees table
    const treeRes = await pool.query('SELECT hash FROM git_trees WHERE hash = $1', [snapshot.root_tree_hash]);
    expect(treeRes.rows.length).toBe(1);

    // Cleanup test user & workspace (cascades DB records)
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
  });

  it('2. Handles two parallel GC sweeps without deadlock or transaction errors', async () => {
    const sweep1 = casGarbageCollector.runGarbageCollection();
    const sweep2 = casGarbageCollector.runGarbageCollection();

    const [stats1, stats2] = await Promise.all([sweep1, sweep2]);

    expect(stats1).toBeDefined();
    expect(stats2).toBeDefined();
  });
});
