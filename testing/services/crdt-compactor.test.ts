/**
 * Production CRDT Delta Compaction & Local Archiving SLA
 * Rewritten to use REAL PostgreSQL 16 database tables (`files` & `file_updates`) and live Yjs document states.
 * Zero mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import fs from 'fs';
import { getPool } from '../../backend/src/db.js';
import { userRepository } from '../../backend/src/repositories/user.repository.js';
import { workspaceRepository } from '../../backend/src/repositories/workspace.repository.js';
import {
  compactFileCrdtDeltas,
  archiveWorkspaceToLocalDisk,
  hydrateArchivedWorkspaceFromLocalDisk,
} from '../../backend/src/services/crdtCompactor.service.js';

describe('Production CRDT Delta Compaction & Archiving SLA (Live DB)', () => {
  const createdArchives: string[] = [];

  afterEach(() => {
    for (const archPath of createdArchives) {
      if (fs.existsSync(archPath)) {
        try { fs.unlinkSync(archPath); } catch {}
      }
    }
  });

  it('1. compacts incremental file_updates into a single unified yjs_state buffer in live PostgreSQL', async () => {
    const pool = getPool();
    const ts = Date.now();
    const user = await userRepository.createUser(`crdt_u_${ts}`.slice(0, 30), `crdt_${ts}@example.com`);
    const workspace = await workspaceRepository.createWorkspace(user.id, `CRDT_WS_${ts}`);

    // Create base Yjs Doc
    const doc = new Y.Doc({ gc: false });
    const text = doc.getText('monaco');
    text.insert(0, 'Hello Base Content!');
    const baseState = Buffer.from(Y.encodeStateAsUpdate(doc));

    const fileRes = await pool.query<{ id: string }>(
      `INSERT INTO files (workspace_id, name, type, language, content, yjs_state) VALUES ($1, $2, 'file', 'typescript', $3, $4) RETURNING id`,
      [workspace.id, 'index.ts', 'Hello Base Content!', baseState]
    );
    const fileId = fileRes.rows[0].id;

    // Insert 3 incremental delta updates
    for (let i = 1; i <= 3; i++) {
      const prevSv = Y.encodeStateVector(doc);
      text.insert(text.length, ` Edit ${i}`);
      const updateBuf = Buffer.from(Y.encodeStateAsUpdate(doc, prevSv));

      await pool.query(
        `INSERT INTO file_updates (file_id, update) VALUES ($1, $2)`,
        [fileId, updateBuf]
      );
    }
    doc.destroy();

    // Verify 3 delta updates exist in DB
    const preCheck = await pool.query(`SELECT COUNT(*) FROM file_updates WHERE file_id = $1`, [fileId]);
    expect(parseInt(preCheck.rows[0].count, 10)).toBe(3);

    // Call production compactor service
    const result = await compactFileCrdtDeltas(fileId);

    expect(result.fileId).toBe(fileId);
    expect(result.updatesCompacted).toBe(3);
    expect(result.compactedSizeBytes).toBeGreaterThan(0);

    // Verify deltas purged in live DB
    const postCheck = await pool.query(`SELECT COUNT(*) FROM file_updates WHERE file_id = $1`, [fileId]);
    expect(parseInt(postCheck.rows[0].count, 10)).toBe(0);

    // Cleanup
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
  });

  it('2. archives workspace state to local disk Gzip compressed archive and hydrates successfully', async () => {
    const pool = getPool();
    const ts = Date.now();
    const user = await userRepository.createUser(`arch_u_${ts}`.slice(0, 30), `arch_${ts}@example.com`);
    const workspace = await workspaceRepository.createWorkspace(user.id, `Arch_WS_${ts}`);

    await pool.query(
      `INSERT INTO files (workspace_id, name, type, language, content) VALUES ($1, $2, 'file', 'plaintext', $3)`,
      [workspace.id, 'README.md', 'Project Archive Test']
    );

    const archiveRes = await archiveWorkspaceToLocalDisk(workspace.id);
    createdArchives.push(archiveRes.archivePath);

    expect(archiveRes.workspaceId).toBe(workspace.id);
    expect(fs.existsSync(archiveRes.archivePath)).toBe(true);

    const hydrated = await hydrateArchivedWorkspaceFromLocalDisk(workspace.id);
    expect(hydrated).toBe(true);

    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
  });

  it('3. 0-update compaction on an already compacted file is a safe no-op', async () => {
    const pool = getPool();
    const ts = Date.now();
    const user = await userRepository.createUser(`noop_u_${ts}`.slice(0, 30), `noop_${ts}@example.com`);
    const workspace = await workspaceRepository.createWorkspace(user.id, `Noop_WS_${ts}`);

    const fileRes = await pool.query<{ id: string }>(
      `INSERT INTO files (workspace_id, name, type, language, content) VALUES ($1, $2, 'file', 'typescript', $3) RETURNING id`,
      [workspace.id, 'App.tsx', 'export default () => null;']
    );
    const fileId = fileRes.rows[0].id;

    const result = await compactFileCrdtDeltas(fileId);
    expect(result.updatesCompacted).toBe(0);

    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
  });

  it('4. hydrating non-existent workspace archive returns false safely', async () => {
    const hydrated = await hydrateArchivedWorkspaceFromLocalDisk('ws-does-not-exist-12345');
    expect(hydrated).toBe(false);
  });
});
