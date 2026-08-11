import { describe, it, expect } from 'vitest';
import { getPool } from '../../backend/src/db.js';

describe('Phase B: Disk Quota & Inode Exhaustion SLA', () => {
  it('1. Calculates real file storage volume and inode counts from PostgreSQL 16 database', async () => {
    const pool = getPool();

    // Query real PostgreSQL files table for aggregate storage footprint
    const res = await pool.query<{ total_bytes: string; total_inodes: string }>(
      'SELECT COALESCE(SUM(LENGTH(content)), 0) as total_bytes, COUNT(*) as total_inodes FROM files'
    );

    const totalBytes = parseInt(res.rows[0].total_bytes || '0', 10);
    const totalInodes = parseInt(res.rows[0].total_inodes || '0', 10);

    const quotaLimitBytes = 1024 * 1024 * 1024; // 1GB limit
    const inodeLimit = 50000;

    console.log(`[Disk Quota SLA] Total File Storage Volume: ${(totalBytes / 1024).toFixed(2)} KB`);
    console.log(`[Disk Quota SLA] Total Inode Count: ${totalInodes} files`);

    expect(totalBytes).toBeLessThanOrEqual(quotaLimitBytes);
    expect(totalInodes).toBeLessThanOrEqual(inodeLimit);
  });
});
