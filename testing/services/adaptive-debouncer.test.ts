import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AdaptivePersistenceDebouncer } from '../../backend/src/services/adaptiveDebouncer.service.js';

function createSpyCallback() {
  let count = 0;
  const calls: any[][] = [];
  const fn = Object.assign(
    (...args: any[]) => {
      count++;
      calls.push(args);
    },
    {
      get callCount() { return count; },
      calls
    }
  );
  return fn;
}

describe('Adaptive Velocity-Based Save Debouncer', () => {
   beforeEach(() => {
      vi.useFakeTimers();
   });

   afterEach(() => {
      vi.useRealTimers();
   });

   it('debounces single edit at base delay (800ms)', () => {
      const onFlush = createSpyCallback();
      const debouncer = new AdaptivePersistenceDebouncer(onFlush, { baseDelayMs: 800 });

      debouncer.recordEdit();
      expect(onFlush.callCount).toBe(0);

      vi.advanceTimersByTime(799);
      expect(onFlush.callCount).toBe(0);

      vi.advanceTimersByTime(2);
      expect(onFlush.callCount).toBe(1);
   });

   it('dynamically scales debounce delay during high-velocity burst typing (>5 edits/sec)', () => {
      const onFlush = createSpyCallback();
      const debouncer = new AdaptivePersistenceDebouncer(onFlush, {
         baseDelayMs: 800,
         maxBurstDelayMs: 2500,
         burstVelocityThreshold: 5
      });

      for (let i = 0; i < 10; i++) {
         debouncer.recordEdit();
         vi.advanceTimersByTime(50);
      }

      vi.advanceTimersByTime(800);
      expect(onFlush.callCount).toBe(0);

      vi.advanceTimersByTime(2000);
      expect(onFlush.callCount).toBe(1);
   });

   it('enforces maxDeferralMs hard ceiling during continuous typing bursts', () => {
      const onFlush = createSpyCallback();
      const debouncer = new AdaptivePersistenceDebouncer(onFlush, {
         baseDelayMs: 800,
         maxBurstDelayMs: 2500,
         maxDeferralMs: 4000,
         burstVelocityThreshold: 5
      });

      for (let i = 0; i < 45; i++) {
         debouncer.recordEdit();
         vi.advanceTimersByTime(100);
      }

      expect(onFlush.callCount).toBeGreaterThanOrEqual(1);

      vi.advanceTimersByTime(1500);
      expect(onFlush.callCount).toBeGreaterThanOrEqual(2);
   });

   it('allows immediate manual flush() and cancel()', async () => {
      const onFlush = createSpyCallback();
      const debouncer = new AdaptivePersistenceDebouncer(onFlush);

      debouncer.recordEdit();
      expect(debouncer.getPendingStatus().isPending).toBe(true);

      await debouncer.flush();
      expect(onFlush.callCount).toBe(1);
      expect(debouncer.getPendingStatus().isPending).toBe(false);

      debouncer.recordEdit();
      debouncer.cancel();
      expect(debouncer.getPendingStatus().isPending).toBe(false);

      vi.advanceTimersByTime(3000);
      expect(onFlush.callCount).toBe(1);
   });

   it('handles independent debounce windows for multiple files without cross-contamination', () => {
      const onFlushA = createSpyCallback();
      const onFlushB = createSpyCallback();

      const debouncerA = new AdaptivePersistenceDebouncer(onFlushA, { baseDelayMs: 800 });
      const debouncerB = new AdaptivePersistenceDebouncer(onFlushB, { baseDelayMs: 800 });

      debouncerA.recordEdit();
      vi.advanceTimersByTime(400);

      debouncerB.recordEdit();
      vi.advanceTimersByTime(400);

      expect(onFlushA.callCount).toBe(1);
      expect(onFlushB.callCount).toBe(0);

      vi.advanceTimersByTime(400);
      expect(onFlushB.callCount).toBe(1);
   });

   it('prevents double callback execution when cancel() is called immediately after flush()', async () => {
      const onFlush = createSpyCallback();
      const debouncer = new AdaptivePersistenceDebouncer(onFlush);

      debouncer.recordEdit();
      await debouncer.flush();
      debouncer.cancel();

      vi.advanceTimersByTime(5000);
      expect(onFlush.callCount).toBe(1);
   });

   it('resets debounce delay back to base delay when velocity drops below threshold', () => {
      const onFlush = createSpyCallback();
      const debouncer = new AdaptivePersistenceDebouncer(onFlush, {
         baseDelayMs: 800,
         maxBurstDelayMs: 2500,
         burstVelocityThreshold: 5
      });

      // High burst typing
      for (let i = 0; i < 10; i++) {
         debouncer.recordEdit();
         vi.advanceTimersByTime(50);
      }
      vi.advanceTimersByTime(3000); // Flush burst
      expect(onFlush.callCount).toBe(1);

      // Slow typing (velocity = 1) -> Should flush after base delay (800ms)
      debouncer.recordEdit();
      vi.advanceTimersByTime(800);
      expect(onFlush.callCount).toBe(2);
   });

   it('guarantees clean status reporting via getPendingStatus()', () => {
      const onFlush = createSpyCallback();
      const debouncer = new AdaptivePersistenceDebouncer(onFlush, { baseDelayMs: 1000 });

      expect(debouncer.getPendingStatus().isPending).toBe(false);

      debouncer.recordEdit();
      expect(debouncer.getPendingStatus().isPending).toBe(true);

      vi.advanceTimersByTime(1000);
      expect(debouncer.getPendingStatus().isPending).toBe(false);
   });
});
