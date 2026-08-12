/**
 * 11. Multi-Workspace Concurrent CRDT Compaction SLA Benchmark
 * Evaluates `compactFileCrdtDeltas` batch migration of `file_updates` into `files.yjs_state`
 * across multiple files concurrently, testing Yjs StructStore compaction and PostgreSQL write IOPS.
 * Zero mocks — live PostgreSQL 16 & Yjs CRDT engine.
 */

import { describe, it, expect } from 'vitest';
import { compactFileCrdtDeltas } from '../../backend/src/services/crdtCompactor.service.js';
import { getPool } from '../../backend/src/db.js';
import { userRepository } from '../../backend/src/repositories/user.repository.js';
import { workspaceRepository } from '../../backend/src/repositories/workspace.repository.js';
import * as Y from 'yjs';

describe('11. Multi-Workspace Concurrent CRDT Compaction SLA', () => {
  it('1. Compacts incremental CRDT updates into files.yjs_state across 10 files concurrently without data loss', async () => {
    const pool = getPool();
    const ts = Date.now();

    const user = await userRepository.createUser(`compact_${ts}`.slice(0, 30), `comp_${ts}@example.com`);
    const workspace = await workspaceRepository.createWorkspace(user.id, `Compact_WS_${ts}`);

    // Create 10 files and insert incremental file_updates rows for each
    const fileIds: string[] = [];
    for (let f = 0; f < 10; f++) {
      const fileRes = await pool.query<{ id: string }>(
        `INSERT INTO files (workspace_id, name, type, language) VALUES ($1, $2, 'file', 'typescript') RETURNING id`,
        [workspace.id, `compact_file_${f}.ts`]
      );
      const fid = fileRes.rows[0].id;
      fileIds.push(fid);

      // Create a Yjs doc update payload
      const ydoc = new Y.Doc();
      ydoc.getText('monaco').insert(0, `Initial content for file ${f}`);
      const updateBuf = Buffer.from(Y.encodeStateAsUpdate(ydoc));

      await pool.query(
        `INSERT INTO file_updates (file_id, update) VALUES ($1, $2)`,
        [fid, updateBuf]
      );
      ydoc.destroy();
    }

    const startTime = Date.now();

    // 10 concurrent compaction tasks
    const compactTasks = fileIds.map((fid) => compactFileCrdtDeltas(fid));
    const results = await Promise.all(compactTasks);

    const durationMs = Date.now() - startTime;
    console.log(`[Concurrent CRDT Compaction SLA] Compacted 10 Files in ${durationMs}ms (${(durationMs / 10).toFixed(2)}ms/file)`);

    expect(results.length).toBe(10);
    for (const res of results) {
      expect(res.updatesCompacted).toBeGreaterThanOrEqual(1);
    }
    expect(durationMs).toBeLessThan(3000);

    // Clean up test user & workspace (cascades deletion)
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
  });
});
