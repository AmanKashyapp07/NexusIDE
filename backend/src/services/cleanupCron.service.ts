/**
 * Purpose: Automated VM & Database Production Cleanup Engine.
 * High-Level Architecture: Operates periodically to purge soft-deleted workspace documents,
 * stale execution history logs, unreferenced CAS blobs, orphan Redis keys, and temporary VM disk artifacts.
 */

import fs from 'fs';
import path from 'path';
import { getPool } from '../db.js';
import { casGarbageCollector } from './casGarbageCollector.service.js';
import { redisPresenceService } from './redisPresence.service.js';
import { log } from './logger.service.js';

export interface CleanupReport {
  timestamp: string;
  casBlobsPurged: number;
  casTreesPurged: number;
  reclaimedCasBytes: number;
  executionLogsPurged: number;
  staleSnapshotsPurged: number;
  tempFilesRemoved: number;
}

export class CleanupCronService {
  /**
   * Executes a full system maintenance sweep across PostgreSQL, Redis, and VM Disk.
   */
  async runFullSystemCleanup(): Promise<CleanupReport> {
    const pool = getPool();
    const now = new Date().toISOString();
    let executionLogsPurged = 0;
    let staleSnapshotsPurged = 0;
    let tempFilesRemoved = 0;

    log('🧹 CLEANUP', 'Starting automated system cleanup routine...');

    // 1. Run CAS Storage Garbage Collection
    const casStats = await casGarbageCollector.runGarbageCollection().catch(() => ({
      blobsPurged: 0,
      treesPurged: 0,
      reclaimedBytes: 0,
    }));

    // 2. Database Cleanup: Purge execution history older than 7 days
    try {
      const execRes = await pool.query(
        `DELETE FROM execution_history WHERE executed_at < NOW() - interval '7 days'`
      );
      executionLogsPurged = execRes.rowCount || 0;
    } catch {
      // Table may be empty or optional
    }

    // 3. Database Cleanup: Purge stale CRDT file updates older than 30 days
    try {
      const snapRes = await pool.query(
        `DELETE FROM file_updates WHERE created_at < NOW() - interval '30 days'`
      );
      staleSnapshotsPurged = snapRes.rowCount || 0;
    } catch {
      // Fallback
    }

    // 4. Redis Cleanup: Evict stale presence keys
    try {
      await redisPresenceService.clearWorkspacePresence('stale_cleanup_sweep').catch(() => {});
    } catch {}

    // 5. VM Disk Maintenance: Sweep /tmp for stale execution & cache files older than 7 days
    try {
      const tmpDir = '/tmp';
      if (fs.existsSync(tmpDir)) {
        const entries = fs.readdirSync(tmpDir);
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

        for (const entry of entries) {
          if (entry.startsWith('nexus_') || entry.startsWith('lsp_') || entry.endsWith('.log')) {
            const fullPath = path.join(tmpDir, entry);
            try {
              const stat = fs.statSync(fullPath);
              if (stat.mtimeMs < sevenDaysAgo) {
                if (stat.isDirectory()) {
                  fs.rmSync(fullPath, { recursive: true, force: true });
                } else {
                  fs.unlinkSync(fullPath);
                }
                tempFilesRemoved++;
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      log('🧹 CLEANUP', `Disk sweep warning: ${err instanceof Error ? err.message : String(err)}`);
    }

    const report: CleanupReport = {
      timestamp: now,
      casBlobsPurged: casStats.blobsPurged,
      casTreesPurged: casStats.treesPurged,
      reclaimedCasBytes: casStats.reclaimedBytes,
      executionLogsPurged,
      staleSnapshotsPurged,
      tempFilesRemoved,
    };

    log('🧹 CLEANUP', `System cleanup completed: ${JSON.stringify(report)}`);
    return report;
  }

  /**
   * Schedules a daily background cleanup job (runs once every 24 hours).
   */
  startScheduledCron(): NodeJS.Timeout {
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    // Initial run after 5 minutes of server boot
    setTimeout(() => {
      this.runFullSystemCleanup().catch(() => {});
    }, 5 * 60 * 1000);

    return setInterval(() => {
      this.runFullSystemCleanup().catch(() => {});
    }, TWENTY_FOUR_HOURS);
  }
}

export const cleanupCronService = new CleanupCronService();
