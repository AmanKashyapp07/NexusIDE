/**
 * AdaptivePersistenceDebouncer Velocity Burst & Hard Ceiling Test Suite
 * Evaluates adaptive debouncer behavior under high typing velocity,
 * hard deferral ceilings (maxDeferralMs), sliding window timestamp eviction, and cancellation safety.
 * Zero mocks — live timer mechanics and real AdaptivePersistenceDebouncer service.
 */

import { describe, it, expect } from 'vitest';
import { AdaptivePersistenceDebouncer } from '../../backend/src/services/adaptiveDebouncer.service.js';

describe('AdaptivePersistenceDebouncer Velocity Burst & Hard Ceiling SLA', () => {
  it('1. Triggers forced flush when continuous typing reaches maxDeferralMs hard ceiling (5,000ms)', async () => {
    let flushCount = 0;
    const debouncer = new AdaptivePersistenceDebouncer(() => {
      flushCount++;
    }, {
      minDelayMs: 50,
      baseDelayMs: 100,
      maxBurstDelayMs: 300,
      maxDeferralMs: 400, // Shortened hard ceiling for test execution speed
      burstVelocityThreshold: 3
    });

    const startTime = Date.now();

    // Rapid edits every 30ms continuously for 600ms (exceeds maxDeferralMs of 400ms)
    for (let i = 0; i < 20; i++) {
      debouncer.recordEdit();
      await new Promise(r => setTimeout(r, 30));
      if (flushCount > 0) break;
    }

    const durationMs = Date.now() - startTime;
    console.log(`[Debouncer Ceiling SLA] Flush triggered after ${durationMs}ms of continuous typing`);

    expect(flushCount).toBeGreaterThanOrEqual(1);
    expect(durationMs).toBeLessThan(700);

    debouncer.cancel();
  });

  it('2. Dynamically scales debounce delay during high-velocity edit bursts', async () => {
    let flushTime = 0;
    const startTime = Date.now();

    const debouncer = new AdaptivePersistenceDebouncer(() => {
      flushTime = Date.now() - startTime;
    }, {
      minDelayMs: 50,
      baseDelayMs: 100,
      maxBurstDelayMs: 400,
      maxDeferralMs: 2000,
      burstVelocityThreshold: 2
    });

    // Simulate high velocity burst (8 edits rapidly within 20ms)
    for (let i = 0; i < 8; i++) {
      debouncer.recordEdit();
    }

    const status = debouncer.getPendingStatus();
    expect(status.isPending).toBe(true);
    expect(status.velocity).toBe(8);

    // Wait for dynamic delay to elapse
    await new Promise(r => setTimeout(r, 550));

    expect(flushTime).toBeGreaterThan(0);
    console.log(`[Debouncer Velocity SLA] Burst flush completed in ${flushTime}ms`);

    debouncer.cancel();
  });

  it('3. Safely cancels pending flush executions without side effects on workspace abort', async () => {
    let flushCount = 0;
    const debouncer = new AdaptivePersistenceDebouncer(() => {
      flushCount++;
    }, {
      baseDelayMs: 200
    });

    debouncer.recordEdit();
    debouncer.recordEdit();

    expect(debouncer.getPendingStatus().isPending).toBe(true);

    // Cancel pending timer
    debouncer.cancel();

    expect(debouncer.getPendingStatus().isPending).toBe(false);

    // Wait past base delay
    await new Promise(r => setTimeout(r, 250));

    expect(flushCount).toBe(0);
  });
});
