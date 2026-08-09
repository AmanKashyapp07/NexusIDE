/**
 * Purpose: Redlock-style distributed locking mechanism for coordinating PostgreSQL writes across clustered pods.
 * High-Level Architecture: Atomic Redis key allocation with TTL expiration and owner verification via Lua script.
 * Primary Trade-offs: Short-lived lease (TTL ~8000ms) prevents permanent deadlocks if a pod crashes mid-execution.
 * Complexity: O(1) lock acquisition and release.
 */

import crypto from 'crypto';
import { redisPublisher } from './redisAdapter.service.js';
import { log } from './logger.service.js';

export const POD_ID = process.env.POD_NAME || `pod-${crypto.randomBytes(4).toString('hex')}`;

const UNLOCK_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

const inMemoryLocks = new Set<string>();

/**
 * Executes an asynchronous task protected by a distributed Redis mutex.
 * If the lock is already held by another pod, returns null without executing the task.
 * 
 * @param lockKey - The unique redis key identifying the resource lock.
 * @param ttlMs - Time-to-live in milliseconds before the lock automatically expires.
 * @param task - The critical section to execute once the lock is acquired.
 */
export async function withDistributedLock<T>(
   lockKey: string,
   ttlMs: number,
   task: () => Promise<T>
): Promise<T | null> {
   try {
      if (redisPublisher.status !== 'ready' && redisPublisher.status !== 'connecting') {
         // Fallback in-memory mutex if Redis is unreachable
         if (inMemoryLocks.has(lockKey)) {
            return null;
         }
         inMemoryLocks.add(lockKey);
         try {
            return await task();
         } finally {
            inMemoryLocks.delete(lockKey);
         }
      }

      const acquired = await redisPublisher.set(lockKey, POD_ID, 'PX', ttlMs, 'NX');
      if (!acquired) {
         log('🔒 REDLOCK', `Contention on ${lockKey}; skipping task (lock held by peer pod)`);
         return null;
      }

      try {
         return await task();
      } finally {
         await redisPublisher.eval(UNLOCK_SCRIPT, 1, lockKey, POD_ID).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            log('🔒 REDLOCK', `Failed safe release for ${lockKey}: ${msg}`);
         });
      }
   } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log('🔒 REDLOCK', `Error in distributed lock for ${lockKey}: ${msg}`);
      if (inMemoryLocks.has(lockKey)) {
         return null;
      }
      inMemoryLocks.add(lockKey);
      try {
         return await task();
      } finally {
         inMemoryLocks.delete(lockKey);
      }
   }
}
