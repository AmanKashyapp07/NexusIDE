/**
 * Purpose: Git-Based Content-Addressable Storage (CAS) Merkle DAG Service.
 *
 * High-Level Architecture:
 *   This service provides the pure cryptographic and structural hashing
 *   algorithms for the CAS snapshot engine. It is stateless and has no
 *   database dependency — all DB interactions happen in the repository layer.
 *
 *   Three-Layer Merkle DAG:
 *     Blob   → SHA-256(file content)                           → git_blobs row
 *     Tree   → SHA-256(canonical sorted JSON of blob entries)  → git_trees row
 *     Commit → (workspace_id, root_tree_hash, parent_id, ...)  → git_commits row
 *
 * Primary Trade-offs:
 *   - Deterministic canonical sorting (by `name` and tie-breaking by `path`)
 *     guarantees that identical file sets produce identical root tree hashes
 *     regardless of filesystem traversal order or insertion sequence.
 *   - Deduplicated blobsMap prevents sending redundant rows over PostgreSQL client.
 *
 * Complexity:
 *   hashContent      → O(C) where C = byte length of content
 *   hashTreeEntries  → O(E log E) for the sort, O(E) for serialization
 *   buildMerkleTree  → O(F) where F = number of files
 *   diffTrees        → O(max(|A|, |B|))
 */

import crypto from 'crypto';

// =============================================================================
// PUBLIC TYPES
// =============================================================================

export interface TreeEntry {
  /** Filename component (not the full path). */
  name: string;
  /** 'blob' for files, 'tree' for directories (future nested trees). */
  type: 'blob' | 'tree';
  /** SHA-256 hex digest of the blob content or the canonical tree JSON. */
  hash: string;
  /** Full relative path from workspace root, e.g. "src/components/App.tsx". */
  path: string;
  /** Source language tag stored alongside the blob, e.g. 'typescript'. */
  language?: string | null;
  /** Byte length of the raw content (UTF-8). */
  sizeBytes?: number;
}

export interface BlobRecord {
  hash: string;
  content: string;
  sizeBytes: number;
}

export interface TreeRecord {
  hash: string;
  entries: TreeEntry[];
}

export interface MerkleDAG {
  /** SHA-256 hex digest of the workspace root tree. */
  rootTreeHash: string;
  /** Deduplicated blob rows ready for INSERT … ON CONFLICT DO NOTHING. */
  blobsToInsert: BlobRecord[];
  /** Tree rows (one per directory level, currently flat). */
  treesToInsert: TreeRecord[];
}

export interface TreeDiff {
  added: TreeEntry[];
  modified: TreeEntry[];
  deleted: TreeEntry[];
}

// =============================================================================
// CAS SERVICE
// =============================================================================

export class CASService {
  // ---------------------------------------------------------------------------
  // BLOB HASHING
  // ---------------------------------------------------------------------------

  /**
   * Generates the SHA-256 hex digest and UTF-8 byte length for a file's content.
   */
  static hashContent(content: string): { hash: string; sizeBytes: number } {
    const normalized = content ?? '';
    const hash = crypto
      .createHash('sha256')
      .update(normalized, 'utf8')
      .digest('hex');
    const sizeBytes = Buffer.byteLength(normalized, 'utf8');
    return { hash, sizeBytes };
  }

  // ---------------------------------------------------------------------------
  // TREE HASHING
  // ---------------------------------------------------------------------------

  /**
   * Generates the canonical SHA-256 hash for a directory-level tree node.
   * Deterministically sorts entries by `name` with `path` tie-breaking.
   */
  static hashTreeEntries(entries: TreeEntry[]): { hash: string; canonicalEntries: TreeEntry[] } {
    const sorted = [...entries].sort((a, b) => 
      a.name.localeCompare(b.name) || (a.path || '').localeCompare(b.path || '')
    );
    const serialized = JSON.stringify(sorted);
    const hash = crypto
      .createHash('sha256')
      .update(serialized, 'utf8')
      .digest('hex');
    return { hash, canonicalEntries: sorted };
  }

  // ---------------------------------------------------------------------------
  // MERKLE DAG CONSTRUCTION
  // ---------------------------------------------------------------------------

  /**
   * Builds a flat Merkle DAG from a workspace's active files.
   * Offloads CPU-intensive SHA-256 Merkle tree computation to worker threads
   * to guarantee sub-millisecond event loop responsiveness.
   */
  static async buildMerkleTree(
    files: { path: string; content: string; language?: string | null }[]
  ): Promise<MerkleDAG> {
    // For small file sets (<= 3 files), execute inline to avoid message-passing overhead.
    if (files.length <= 3) {
      return this.buildMerkleTreeInline(files);
    }
    try {
      const { workerPoolService } = await import('./workerPool.service.js');
      return await workerPoolService.buildMerkleTreeOffloaded(files);
    } catch {
      return this.buildMerkleTreeInline(files);
    }
  }

  /**
   * Synchronous / inline fallback Merkle DAG builder.
   */
  static buildMerkleTreeInline(
    files: { path: string; content: string; language?: string | null }[]
  ): MerkleDAG {
    const blobsMap = new Map<string, BlobRecord>();
    const rootEntries: TreeEntry[] = [];

    for (const file of files) {
      const content = file.content ?? '';
      const { hash, sizeBytes } = this.hashContent(content);

      if (!blobsMap.has(hash)) {
        blobsMap.set(hash, { hash, content, sizeBytes });
      }

      const name = file.path.split('/').pop() || file.path;

      rootEntries.push({
        name,
        type: 'blob',
        hash,
        path: file.path,
        language: file.language ?? null,
        sizeBytes,
      });
    }

    const { hash: rootTreeHash, canonicalEntries } = this.hashTreeEntries(rootEntries);

    const treesToInsert: TreeRecord[] = [
      { hash: rootTreeHash, entries: canonicalEntries },
    ];

    const blobsToInsert = Array.from(blobsMap.values());

    return { rootTreeHash, blobsToInsert, treesToInsert };
  }

  // ---------------------------------------------------------------------------
  // TREE DIFFING
  // ---------------------------------------------------------------------------

  /**
   * Computes a structural diff between two Merkle tree entry sets.
   */
  static diffTrees(treeA: TreeEntry[] = [], treeB: TreeEntry[] = []): TreeDiff {
    const mapA = new Map<string, TreeEntry>(treeA.map(e => [e.path, e]));
    const mapB = new Map<string, TreeEntry>(treeB.map(e => [e.path, e]));

    const added: TreeEntry[] = [];
    const modified: TreeEntry[] = [];
    const deleted: TreeEntry[] = [];

    for (const [path, entryB] of mapB) {
      const entryA = mapA.get(path);
      if (!entryA) {
        added.push(entryB);
      } else if (entryA.hash !== entryB.hash) {
        modified.push(entryB);
      }
    }

    for (const [path, entryA] of mapA) {
      if (!mapB.has(path)) {
        deleted.push(entryA);
      }
    }

    return { added, modified, deleted };
  }
}
