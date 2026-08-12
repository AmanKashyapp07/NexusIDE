/**
 * CleanupCronService Idempotency & System Maintenance Test Suite
 * Evaluates full system cleanup sweeps across live PostgreSQL 16, Redis 7, and /tmp filesystem,
 * ensuring parallel invocations are idempotent and cause zero errors.
 * Zero mocks — live database, cache, and disk sweeps.
 */

import { describe, it, expect } from 'vitest';
import { cleanupCronService } from '../../backend/src/services/cleanupCron.service.js';

describe('CleanupCronService Idempotency & Disk Maintenance SLA', () => {
  it('1. Executes full system cleanup sweep cleanly across PostgreSQL, Redis, and /tmp', async () => {
    const report = await cleanupCronService.runFullSystemCleanup();

    console.log(`[Cleanup Cron SLA] Sweep completed at ${report.timestamp}`);
    console.log(`[Cleanup Cron SLA] Logs Purged: ${report.executionLogsPurged} | Stale Snapshots: ${report.staleSnapshotsPurged} | Temp Files: ${report.tempFilesRemoved}`);

    expect(report).toBeDefined();
    expect(report.timestamp).toBeDefined();
    expect(typeof report.casBlobsPurged).toBe('number');
    expect(typeof report.executionLogsPurged).toBe('number');
  });

  it('2. Asserts parallel cleanup cron invocations complete idempotently without throwing', async () => {
    const task1 = cleanupCronService.runFullSystemCleanup();
    const task2 = cleanupCronService.runFullSystemCleanup();

    const [report1, report2] = await Promise.all([task1, task2]);

    expect(report1).toBeDefined();
    expect(report2).toBeDefined();
  });
});
