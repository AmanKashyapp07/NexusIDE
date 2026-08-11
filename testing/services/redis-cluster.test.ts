/**
 * Production Redis Clustering & Redlock Distributed Lock SLA
 * Rewritten to use REAL Redis 7 client connections (`redisPublisher`, `redisSubscriber`, `getRedisClient()`).
 * Zero mocks.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import {
  initializeRedisCollaborationMesh,
  publishYjsUpdate,
  publishYjsAwareness,
  publishWorkspaceEvict,
} from '../../backend/src/services/redisAdapter.service.js';
import { withDistributedLock } from '../../backend/src/services/distributedLock.service.js';

describe('Stateless WebSocket Clustering SLA (Live Redis 7)', () => {
  const testWorkspaceId = 'test-cluster-ws-123';
  const testFileId = 'test-file-abc';
  const docName = `${testWorkspaceId}-${testFileId}`;

  beforeEach(() => {
    initializeRedisCollaborationMesh();
  });

  it('1. Publishes Yjs updates, awareness vectors, and workspace eviction signals to live Redis 7', async () => {
    const testUpdate = new Uint8Array([0, 1, 2, 3, 4]);
    const testAwareness = new Uint8Array([10, 20, 30]);

    // Live Redis pub/sub functions execute asynchronously on Redis 7 without error
    await expect(publishYjsUpdate(docName, testUpdate)).resolves.not.toThrow();
    await expect(publishYjsAwareness(docName, testAwareness)).resolves.not.toThrow();
    await expect(publishWorkspaceEvict(testWorkspaceId)).resolves.not.toThrow();
  });

  it('2. Acquires and releases Redlock distributed locks safely with Lua script on Redis', async () => {
    const lockKey = `test:lock:${Date.now()}`;
    let taskExecuted = false;

    const result = await withDistributedLock(lockKey, 5000, async () => {
      taskExecuted = true;
      return 'success-payload';
    });

    expect(taskExecuted).toBe(true);
    expect(result).toBe('success-payload');
  });

  it('3. Handles lock contention by preventing concurrent task execution on the same resource', async () => {
    const lockKey = `test:lock:contention:${Date.now()}`;

    // First task acquires lock and holds it for 200ms
    const task1Promise = withDistributedLock(lockKey, 5000, async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return 'first-worker';
    });

    await new Promise((resolve) => setTimeout(resolve, 30));

    // Second task attempts to acquire exact same lock key
    const task2Result = await withDistributedLock(lockKey, 5000, async () => {
      return 'second-worker-should-not-run';
    });

    const task1Result = await task1Promise;

    expect(task1Result).toBe('first-worker');
    expect(task2Result).toBeNull();
  });

  it('4. Synchronizes Yjs documents and Awareness state vectors across simulated peer nodes', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const ytextB = docB.getText('monaco');
    ytextB.insert(0, 'Hello from Live Peer!');
    const updateFromB = Y.encodeStateAsUpdate(docB);

    Y.applyUpdate(docA, updateFromB);
    expect(docA.getText('monaco').toString()).toBe('Hello from Live Peer!');

    const awarenessA = new awarenessProtocol.Awareness(docA);
    const awarenessB = new awarenessProtocol.Awareness(docB);

    awarenessB.setLocalStateField('user', { id: 'u-1', name: 'Alice', color: '#ff0000' });
    const awarenessUpdateB = awarenessProtocol.encodeAwarenessUpdate(awarenessB, [docB.clientID]);
    awarenessProtocol.applyAwarenessUpdate(awarenessA, awarenessUpdateB, 'redis');

    const statesA = awarenessA.getStates();
    const clientBState = statesA.get(docB.clientID) as any;
    expect(clientBState?.user?.name).toBe('Alice');
  });

  it('5. Handles high-throughput lock contention across 25 concurrent tasks on live Redis', async () => {
    const lockKey = `test:lock:high_concurrency:${Date.now()}`;
    let executedTasks = 0;

    const attempts = Array.from({ length: 25 }).map(() =>
      withDistributedLock(lockKey, 2000, async () => {
        executedTasks++;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return 'executed';
      })
    );

    const results = await Promise.all(attempts);
    const successfulExecutions = results.filter((res) => res === 'executed').length;
    const rejectedAttempts = results.filter((res) => res === null).length;

    expect(successfulExecutions).toBe(1);
    expect(rejectedAttempts).toBe(24);
    expect(executedTasks).toBe(1);
  });
});
