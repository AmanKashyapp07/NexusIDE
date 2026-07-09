import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { getPool } from '../../backend/src/db.js';

// Unmock db.js to use real DB instead of collaboration.test.ts mock
vi.unmock('../../backend/src/db.js');
import { createWorkspaceSnapshot, getSnapshotFiles } from '../../backend/src/utils/snapshotManager.js';
import { saveBlob } from '../../backend/src/utils/gitObjects.js';

describe('Git-like Snapshots', () => {
  let testWorkspaceId: string;
  let testUserId: string;

  beforeAll(async () => {
    const client = await getPool().connect();
    try {
      // 1. Create a test user
      const userRes = await client.query(
        "INSERT INTO users (username, password_hash, email) VALUES ($1, 'hash', $2) RETURNING id",
        ['snap_tester', 'snap@test.com']
      );
      testUserId = userRes.rows[0].id;

      // 2. Create a test workspace
      const wsRes = await client.query(
        "INSERT INTO workspaces (title, description, owner_id) VALUES ($1, $2, $3) RETURNING id",
        ['Snap Test WS', 'Testing git-like snapshots', testUserId]
      );
      testWorkspaceId = wsRes.rows[0].id;

      // 3. Create some active files in the workspace
      // Root directory
      const srcDirRes = await client.query(
        "INSERT INTO files (workspace_id, parent_id, name, type) VALUES ($1, NULL, 'src', 'directory') RETURNING id",
        [testWorkspaceId]
      );
      const srcDirId = srcDirRes.rows[0].id;

      // File in root
      const rootFileContent = "console.log('root');";
      const rootBlobHash = await saveBlob(Buffer.from(rootFileContent), rootFileContent);
      await client.query(
        "INSERT INTO files (workspace_id, parent_id, name, type, content, blob_hash) VALUES ($1, NULL, 'index.js', 'file', $2, $3)",
        [testWorkspaceId, rootFileContent, rootBlobHash]
      );

      // File in src directory
      const srcFileContent = "export const val = 42;";
      const srcBlobHash = await saveBlob(Buffer.from(srcFileContent), srcFileContent);
      await client.query(
        "INSERT INTO files (workspace_id, parent_id, name, type, content, blob_hash) VALUES ($1, $2, 'utils.js', 'file', $3, $4)",
        [testWorkspaceId, srcDirId, srcFileContent, srcBlobHash]
      );

    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    const client = await getPool().connect();
    try {
      await client.query("DELETE FROM workspaces WHERE id = $1", [testWorkspaceId]);
      await client.query("DELETE FROM users WHERE id = $1", [testUserId]);
    } finally {
      client.release();
    }
  });

  it('should create a workspace snapshot using git objects', async () => {
    const snapshotLabel = 'Initial Commit';
    const snapshot = await createWorkspaceSnapshot(testWorkspaceId, testUserId, snapshotLabel);

    expect(snapshot).toHaveProperty('id');
    expect(snapshot).toHaveProperty('label', snapshotLabel);
    expect(snapshot).toHaveProperty('created_at');

    const commitHash = snapshot.id;

    // Verify commit exists in git_commits
    const commitRes = await getPool().query('SELECT * FROM git_commits WHERE hash = $1', [commitHash]);
    expect(commitRes.rows.length).toBe(1);
    const commit = commitRes.rows[0];
    expect(commit.message).toBe(snapshotLabel);
    expect(commit.workspace_id).toBe(testWorkspaceId);
    expect(commit.author_id).toBe(testUserId);

    // Verify tree structure exists
    const rootTreeHash = commit.tree_hash;
    const treeRes = await getPool().query('SELECT * FROM git_trees WHERE hash = $1', [rootTreeHash]);
    expect(treeRes.rows.length).toBe(1);
    const treeEntries = treeRes.rows[0].content;
    
    // Should have 'src/utils.js' (blob) and 'index.js' (blob)
    const keys = Object.keys(treeEntries);
    expect(keys.length).toBe(2);
    
    const srcTreeEntry = treeEntries['src/utils.js'];
    expect(srcTreeEntry).toBeDefined();
    expect(srcTreeEntry?.type).toBe('blob');

    const indexFileEntry = treeEntries['index.js'];
    expect(indexFileEntry).toBeDefined();
    expect(indexFileEntry?.type).toBe('blob');
  });

  it('should retrieve snapshot files with flattened paths', async () => {
    const snapshot = await createWorkspaceSnapshot(testWorkspaceId, testUserId, 'Second Commit');
    const files = await getSnapshotFiles(testWorkspaceId, snapshot.id);

    expect(files).toBeDefined();
    expect(files?.length).toBe(2);

    const indexFile = files?.find(f => f.path === 'index.js');
    expect(indexFile).toBeDefined();
    expect(indexFile?.content).toBe("console.log('root');");

    const utilsFile = files?.find(f => f.path === 'src/utils.js');
    expect(utilsFile).toBeDefined();
    expect(utilsFile?.content).toBe("export const val = 42;");
  });
});
