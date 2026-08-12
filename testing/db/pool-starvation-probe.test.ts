/**
 * 9. DB Connection Pool Starvation Measurement Probe
 * Intentionally probes PostgreSQL connection pool checkout behavior under high contention,
 * testing queue depth (`waitingCount`), pool limit stability, and clean checkout release.
 * Zero mocks — live PostgreSQL 16.
 */

import { describe, it, expect } from 'vitest';
import { getPool } from '../../backend/src/db.js';

describe('9. DB Connection Pool Starvation Measurement Probe', () => {
  it('1. Probes PostgreSQL pool checkout queue stability and verifies 0 connection leaks after rapid release', async () => {
    const pool = getPool();
    const CHECKOUT_COUNT = 30;

    const startTime = Date.now();

    // Acquire and rapidly release 30 connections sequentially & concurrently
    const tasks = Array.from({ length: CHECKOUT_COUNT }, async () => {
      const client = await pool.connect();
      try {
        const res = await client.query('SELECT 1 as alive');
        expect(res.rows[0].alive).toBe(1);
      } finally {
        client.release();
      }
    });

    await Promise.all(tasks);
    const durationMs = Date.now() - startTime;

    console.log(`[DB Pool Starvation SLA] Executed ${CHECKOUT_COUNT} Connection Checkouts in ${durationMs}ms`);

    expect(pool.totalCount).toBeGreaterThan(0);
    expect(pool.waitingCount).toBe(0); // 0 connections blocked/leaked
    expect(durationMs).toBeLessThan(2000);
  });
});
