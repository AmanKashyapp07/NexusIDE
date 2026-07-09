import crypto from 'crypto';
import { getPool } from '../db.js';

/**
 * Calculates a SHA-256 hash for a given buffer.
 */
export function calculateHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Saves a binary blob to the git_blobs table.
 * Returns the SHA-256 hash of the blob.
 */
export async function saveBlob(data: Buffer, content: string): Promise<string> {
  const hash = calculateHash(data);
  const sizeBytes = data.length;

  const pool = getPool();
  await pool.query(
    `INSERT INTO git_blobs (hash, data, content, size_bytes) 
     VALUES ($1, $2, $3, $4) 
     ON CONFLICT (hash) DO NOTHING`,
    [hash, data, content, sizeBytes]
  );

  return hash;
}

export type GitTreeEntry = {
  type: 'blob' | 'tree';
  hash: string;
};

/**
 * Saves a tree object to the git_trees table.
 * Returns the SHA-256 hash of the tree.
 */
export async function saveTree(workspaceId: string, content: Record<string, GitTreeEntry>): Promise<string> {
  // Sort keys for deterministic hashing
  const sortedKeys = Object.keys(content).sort();
  const sortedContent: Record<string, GitTreeEntry> = {};
  for (const key of sortedKeys) {
    if (content[key]) {
      sortedContent[key] = content[key] as GitTreeEntry;
    }
  }

  const jsonContent = JSON.stringify(sortedContent);
  const hash = calculateHash(Buffer.from(jsonContent, 'utf-8'));

  const pool = getPool();
  await pool.query(
    `INSERT INTO git_trees (hash, workspace_id, content)
     VALUES ($1, $2, $3)
     ON CONFLICT (hash) DO NOTHING`,
    [hash, workspaceId, jsonContent]
  );

  return hash;
}

/**
 * Saves a commit object to the git_commits table.
 * Returns the SHA-256 hash of the commit.
 */
export async function saveCommit(
  workspaceId: string,
  treeHash: string,
  authorId: string | null,
  message: string,
  parentHash: string | null = null
): Promise<string> {
  // Hash commit metadata deterministically
  const metadataStr = `tree ${treeHash}\nparent ${parentHash || 'none'}\nauthor ${authorId || 'none'}\n\n${message}`;
  const hash = calculateHash(Buffer.from(metadataStr, 'utf-8'));

  const pool = getPool();
  await pool.query(
    `INSERT INTO git_commits (hash, workspace_id, tree_hash, parent_hash, author_id, message)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (hash) DO NOTHING`,
    [hash, workspaceId, treeHash, parentHash, authorId, message]
  );

  return hash;
}
