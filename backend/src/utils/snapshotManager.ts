import { getPool } from '../db.js';
import { saveTree, saveCommit, GitTreeEntry } from './gitObjects.js';

/**
 * Creates a new Git-like commit representing a snapshot of the workspace.
 */
export async function createWorkspaceSnapshot(
  workspaceId: string,
  userId: string,
  label: string
): Promise<{ id: string; label: string; created_at: Date }> {
  const pool = getPool();

  // 1. Build the tree recursively
  // We need to fetch all files and build the JSONB tree structure.
  const { rows: allFiles } = await pool.query(
    `SELECT id, parent_id, name, type, blob_hash 
     FROM files 
     WHERE workspace_id = $1`,
    [workspaceId]
  );

  // We can flatten it for simplicity, or build an actual hierarchical tree.
  // The schema comment says `content` is a JSONB array mapping names to blob/tree hashes.
  // For a flattened path-based tree (like the previous snapshot_files):
  const pathMap = new Map<string, string>();
  
  // Helper to resolve full path
  const getPath = (id: string): string => {
    const file = allFiles.find(f => f.id === id);
    if (!file) return '';
    if (!file.parent_id) return file.name;
    return getPath(file.parent_id) + '/' + file.name;
  };

  const treeEntries: Record<string, GitTreeEntry> = {};
  for (const file of allFiles) {
    if (file.type === 'file' && file.blob_hash) {
      const fullPath = getPath(file.id);
      treeEntries[fullPath] = { type: 'blob', hash: file.blob_hash };
    }
  }

  // 2. Save the tree
  const treeHash = await saveTree(workspaceId, treeEntries);

  // 3. Save the commit
  // We can fetch the latest commit to use as parent, or just leave it null for linear independent snapshots.
  const { rows: lastCommits } = await pool.query(
    `SELECT hash FROM git_commits WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [workspaceId]
  );
  const parentHash = lastCommits.length > 0 ? lastCommits[0].hash : null;

  const commitHash = await saveCommit(workspaceId, treeHash, userId, label, parentHash);

  // Fetch the created commit to return
  const { rows: commitRows } = await pool.query(
    `SELECT hash as id, message as label, created_at 
     FROM git_commits 
     WHERE hash = $1`,
    [commitHash]
  );

  return commitRows[0];
}

/**
 * Gets the files for a specific commit (snapshot).
 */
export async function getSnapshotFiles(workspaceId: string, commitHash: string) {
  const pool = getPool();
  
  // 1. Get the commit and its tree
  const { rows: commitRows } = await pool.query(
    `SELECT tree_hash FROM git_commits WHERE hash = $1 AND workspace_id = $2`,
    [commitHash, workspaceId]
  );
  if (commitRows.length === 0) return null;

  const treeHash = commitRows[0].tree_hash;

  // 2. Get the tree content
  const { rows: treeRows } = await pool.query(
    `SELECT content FROM git_trees WHERE hash = $1`,
    [treeHash]
  );
  if (treeRows.length === 0) return null;

  const treeEntries: Record<string, GitTreeEntry> = treeRows[0].content;

  // 3. Resolve all blob contents
  const files = [];
  for (const [path, entry] of Object.entries(treeEntries)) {
    if (entry.type === 'blob') {
      const { rows: blobRows } = await pool.query(
        `SELECT content FROM git_blobs WHERE hash = $1`,
        [entry.hash]
      );
      files.push({
        path,
        content: blobRows.length > 0 ? blobRows[0].content : null,
        language: 'unknown' // or infer from extension
      });
    }
  }

  return files;
}
