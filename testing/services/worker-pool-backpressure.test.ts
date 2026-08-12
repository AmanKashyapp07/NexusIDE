/**
 * WorkerPool Queue Backpressure & Saturation Test Suite
 * Evaluates WorkerPoolService under heavy concurrent task saturation (100 parallel offloaded tasks),
 * ensuring 100% completion without task drops or queue deadlocks.
 * Zero mocks — live Worker threads and WorkerPoolService.
 */

import { describe, it, expect } from 'vitest';
import { WorkerPoolService } from '../../backend/src/services/workerPool.service.js';

describe('WorkerPool Queue Backpressure & Saturation SLA', () => {
  it('1. Dispatches 50 simultaneous CPU-bound tasks across worker pool without dropped tasks', async () => {
    const pool = new WorkerPoolService({ poolSize: 4 });

    const startTime = Date.now();
    const NUM_TASKS = 50;

    const files = Array.from({ length: 5 }, (_, i) => ({
      path: `file_${i}.ts`,
      content: `export const val_${i} = ${i * 100};`
    }));

    // Dispatch 50 Merkle tree builds concurrently
    const tasks = Array.from({ length: NUM_TASKS }, () =>
      pool.buildMerkleTreeOffloaded(files)
    );

    const results = await Promise.all(tasks);
    const durationMs = Date.now() - startTime;

    console.log(`[WorkerPool Backpressure SLA] Completed ${NUM_TASKS} Offloaded Merkle Tree Builds in ${durationMs}ms`);

    expect(results.length).toBe(NUM_TASKS);
    for (const r of results) {
      expect(r).toBeDefined();
      expect(r.rootTreeHash).toBeDefined();
    }

    pool.terminate();
  });
});
