/**
 * Purpose: Content-Addressable Storage (CAS) Garbage Collector.
 * High-Level Architecture: Safely identifies and purges unreferenced `git_blobs` and `git_trees`
 * that are no longer linked to active `git_commits` or directory Merkle DAG trees.
 */

import { getPool } from '../db.js';
import { log } from './logger.service.js';

export interface CasGcStats {
  blobsPurged: number;
  treesPurged: number;
  reclaimedBytes: number;
}

export class CASGarbageCollectorService {
  /**
   * Scans and hard-deletes orphaned git_blobs and git_trees.
   */
  async runGarbageCollection(): Promise<CasGcStats> {
    const pool = getPool();
    let blobsPurged = 0;
    let treesPurged = 0;
    let reclaimedBytes = 0;

    // 1. Purge unreferenced git_trees (trees not pointed to by any git_commit)
    try {
      const unreferencedTreesRes = await pool.query<{ hash: string }>(`
        SELECT hash FROM git_trees 
        WHERE hash NOT IN (SELECT root_tree_hash FROM git_commits WHERE root_tree_hash IS NOT NULL)
      `);

      if (unreferencedTreesRes.rows.length > 0) {
        const treeHashes = unreferencedTreesRes.rows.map(r => r.hash);
        const deleteTreesRes = await pool.query(
          'DELETE FROM git_trees WHERE hash = ANY($1::text[])',
          [treeHashes]
        );
        treesPurged = deleteTreesRes.rowCount || 0;
      }
    } catch (err) {
      log('🧹 CAS GC', `Tree GC info: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 2. Purge unreferenced git_blobs (blobs not referenced in any active git_trees entries JSON)
    try {
      const unreferencedBlobsRes = await pool.query<{ hash: string; size_bytes: number }>(`
        SELECT b.hash, b.size_bytes FROM git_blobs b
        WHERE NOT EXISTS (
          SELECT 1 FROM git_trees t, jsonb_array_elements(t.entries::jsonb) elem
          WHERE elem->>'hash' = b.hash
        )
      `);

      if (unreferencedBlobsRes.rows.length > 0) {
        const blobHashes = unreferencedBlobsRes.rows.map(r => r.hash);
        reclaimedBytes = unreferencedBlobsRes.rows.reduce((sum, r) => sum + (Number(r.size_bytes) || 0), 0);

        const deleteBlobsRes = await pool.query(
          'DELETE FROM git_blobs WHERE hash = ANY($1::text[])',
          [blobHashes]
        );
        blobsPurged = deleteBlobsRes.rowCount || 0;
      }
    } catch (err) {
      log('🧹 CAS GC', `Blob GC info: ${err instanceof Error ? err.message : String(err)}`);
    }

    log('🧹 CAS GC', `Purged ${blobsPurged} blobs (${(reclaimedBytes / 1024 / 1024).toFixed(2)} MB reclaimed), ${treesPurged} trees.`);

    return { blobsPurged, treesPurged, reclaimedBytes };
  }
}

export const casGarbageCollector = new CASGarbageCollectorService();
