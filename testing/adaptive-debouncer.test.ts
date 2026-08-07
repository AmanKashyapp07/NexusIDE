import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdaptivePersistenceDebouncer } from '../backend/src/services/adaptiveDebouncer.service.js';

describe('Adaptive Velocity-Based Save Debouncer', () => {
   beforeEach(() => {
      vi.useFakeTimers();
   });

   it('debounces single edit at base delay (800ms)', () => {
      const onFlush = vi.fn();
      const debouncer = new AdaptivePersistenceDebouncer(onFlush, { baseDelayMs: 800 });

      debouncer.recordEdit();
      expect(onFlush).not.toHaveBeenCalled();

      vi.advanceTimersByTime(799);
      expect(onFlush).not.toHaveBeenCalled();

      vi.advanceTimersByTime(2);
      expect(onFlush).toHaveBeenCalledTimes(1);
   });

   it('dynamically scales debounce delay during high-velocity burst typing (>5 edits/sec)', () => {
      const onFlush = vi.fn();
      const debouncer = new AdaptivePersistenceDebouncer(onFlush, {
         baseDelayMs: 800,
         maxBurstDelayMs: 2500,
         burstVelocityThreshold: 5
      });

      // Simulate 10 rapid keystrokes within 500ms
      for (let i = 0; i < 10; i++) {
         debouncer.recordEdit();
         vi.advanceTimersByTime(50);
      }

      // At velocity 10, delay has scaled well beyond 800ms
      vi.advanceTimersByTime(800);
      expect(onFlush).not.toHaveBeenCalled();

      // Wait for burst delay to expire
      vi.advanceTimersByTime(2000);
      expect(onFlush).toHaveBeenCalledTimes(1);
   });

   it('enforces maxDeferralMs hard ceiling during continuous typing bursts', () => {
      const onFlush = vi.fn();
      const debouncer = new AdaptivePersistenceDebouncer(onFlush, {
         baseDelayMs: 800,
         maxBurstDelayMs: 2500,
         maxDeferralMs: 4000,
         burstVelocityThreshold: 5
      });

      // Simulate continuous typing every 100ms for 4500ms
      for (let i = 0; i < 45; i++) {
         debouncer.recordEdit();
         vi.advanceTimersByTime(100);
         if (i === 40) {
            // At 4000ms mark, hard ceiling must force a flush
            expect(onFlush).toHaveBeenCalledTimes(1);
         }
      }

      // Wait for remaining pending burst timer to settle
      vi.advanceTimersByTime(1500);
      expect(onFlush).toHaveBeenCalledTimes(2);
   });

   it('allows immediate manual flush() and cancel()', async () => {
      const onFlush = vi.fn();
      const debouncer = new AdaptivePersistenceDebouncer(onFlush);

      debouncer.recordEdit();
      expect(debouncer.getPendingStatus().isPending).toBe(true);

      await debouncer.flush();
      expect(onFlush).toHaveBeenCalledTimes(1);
      expect(debouncer.getPendingStatus().isPending).toBe(false);

      debouncer.recordEdit();
      debouncer.cancel();
      expect(debouncer.getPendingStatus().isPending).toBe(false);

      vi.advanceTimersByTime(3000);
      expect(onFlush).toHaveBeenCalledTimes(1);
   });
});
