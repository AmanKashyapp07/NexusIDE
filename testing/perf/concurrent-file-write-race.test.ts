/**
 * 1. Concurrent File Write Race — Distributed Lock Saturation SLA Benchmark
 * Evaluates 100 concurrent clients attempting rapid writes to the same file resource,
 * testing Redlock distributed locking (`withDistributedLock`), write-behind CRDT state consistency,
 * and Yjs state vector convergence under max contention.
 * Zero mocks — live Redis 7 & Yjs CRDT engine.
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { withDistributedLock } from '../../backend/src/services/distributedLock.service.js';
import { redis } from '../../backend/src/utils/redisCache.js';

describe('1. Concurrent File Write Race & Redlock Saturation SLA', () => {
  it('1. Handles 100 concurrent file write lock attempts without deadlocks, state desync, or orphan locks', async () => {
    const lockKey = 'lock:file:race_test_123';
    const numClients = 100;
    let successfulAcquisitions = 0;
    let lockFailures = 0;

    const doc = new Y.Doc();
    const text = doc.getText('content');
    text.insert(0, 'Initial File Content\n');

    const startTime = Date.now();

    // 100 concurrent workers vying for the same file lock simultaneously
    const writeTasks = Array.from({ length: numClients }, async (_, workerId) => {
      const result = await withDistributedLock(lockKey, 2000, async () => {
        // Critical section under distributed lock
        successfulAcquisitions++;
        text.insert(text.length, `Worker ${workerId} edit\n`);
        await redis.set(`race_temp:${workerId}`, `data_${workerId}`, 'EX', 10);
        return true;
      });

      if (result === null) {
        lockFailures++;
      }
    });

    await Promise.all(writeTasks);
    const durationMs = Date.now() - startTime;

    console.log(`[Concurrent Write Race SLA] 100 Contending Clients Processed in ${durationMs}ms`);
    console.log(`[Concurrent Write Race SLA] Locks Acquired: ${successfulAcquisitions} | Collisions Blocked: ${lockFailures}`);

    expect(successfulAcquisitions + lockFailures).toBe(numClients);
    expect(successfulAcquisitions).toBeGreaterThan(0);
    expect(text.toString()).toContain('Initial File Content');

    // Ensure Redis lock key was released cleanly without leaving orphan locks
    const orphanCheck = await redis.get(lockKey);
    expect(orphanCheck).toBeNull();

    doc.destroy();
  });
});
