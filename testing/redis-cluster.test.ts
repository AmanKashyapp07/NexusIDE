import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import {
   redisPublisher,
   redisSubscriber,
   publishYjsUpdate,
   publishYjsAwareness,
   publishWorkspaceEvict,
   initializeRedisCollaborationMesh,
} from '../backend/src/services/redisAdapter.service.js';
import { withDistributedLock, POD_ID } from '../backend/src/services/distributedLock.service.js';
import { getDocsMap, cancelAndEvictWorkspaceDocs } from '../backend/src/docsRegistry.js';
import { WSSharedDoc } from '../backend/src/services/yjsSyncEngine.service.js';

describe('Stateless WebSocket Clustering (Redis Adapter & Redlock)', () => {
   const testWorkspaceId = 'test-cluster-ws-123';
   const testFileId = 'test-file-abc';
   const docName = `${testWorkspaceId}-${testFileId}`;

   beforeEach(() => {
      initializeRedisCollaborationMesh();
   });

   afterEach(async () => {
      await cancelAndEvictWorkspaceDocs(testWorkspaceId, true);
   });

   it('broadcasts Yjs CRDT updates to Redis channel', async () => {
      const publishSpy = vi.spyOn(redisPublisher, 'publish').mockResolvedValue(1);
      const testUpdate = new Uint8Array([0, 1, 2, 3, 4]);

      await publishYjsUpdate(docName, testUpdate);

      expect(publishSpy).toHaveBeenCalledWith(
         `yjs:update:${docName}`,
         Buffer.from(testUpdate)
      );
      publishSpy.mockRestore();
   });

   it('broadcasts Awareness cursor updates to Redis channel', async () => {
      const publishSpy = vi.spyOn(redisPublisher, 'publish').mockResolvedValue(1);
      const testAwareness = new Uint8Array([10, 20, 30]);

      await publishYjsAwareness(docName, testAwareness);

      expect(publishSpy).toHaveBeenCalledWith(
         `yjs:awareness:${docName}`,
         Buffer.from(testAwareness)
      );
      publishSpy.mockRestore();
   });

   it('broadcasts Workspace Eviction signal to Redis channel', async () => {
      const publishSpy = vi.spyOn(redisPublisher, 'publish').mockResolvedValue(1);

      await publishWorkspaceEvict(testWorkspaceId);

      expect(publishSpy).toHaveBeenCalledWith(
         `workspace:evict:${testWorkspaceId}`,
         testWorkspaceId
      );
      publishSpy.mockRestore();
   });

   it('acquires and releases Redlock distributed locks safely with Lua script', async () => {
      const lockKey = `test:lock:${Date.now()}`;
      let taskExecuted = false;

      const result = await withDistributedLock(lockKey, 5000, async () => {
         taskExecuted = true;
         return 'success-payload';
      });

      expect(taskExecuted).toBe(true);
      expect(result).toBe('success-payload');
   });

   it('handles lock contention by preventing concurrent task execution on the same resource', async () => {
      const lockKey = `test:lock:contention:${Date.now()}`;
      
      // First task acquires the lock and holds it for 500ms
      const task1Promise = withDistributedLock(lockKey, 5000, async () => {
         await new Promise((resolve) => setTimeout(resolve, 300));
         return 'first-worker';
      });

      // Give task 1 a brief moment to write the lock key in Redis
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Second task attempts to acquire the exact same lock
      const task2Result = await withDistributedLock(lockKey, 5000, async () => {
         return 'second-worker-should-not-run';
      });

      const task1Result = await task1Promise;

      expect(task1Result).toBe('first-worker');
      expect(task2Result).toBeNull();
   });

   it('synchronizes Yjs documents across simulated peer instances via Redis delta application', async () => {
      const docA = new Y.Doc();
      const docB = new Y.Doc();

      // Local edit on Doc B
      const ytextB = docB.getText('monaco');
      ytextB.insert(0, 'Hello from Server Pod 2!');
      const updateFromB = Y.encodeStateAsUpdate(docB);

      // Simulate receiving update from Redis on Doc A
      Y.applyUpdate(docA, updateFromB, 'redis');

      expect(docA.getText('monaco').toString()).toBe('Hello from Server Pod 2!');
   });

   it('propagates awareness and cursor presence vectors across clustered nodes', async () => {
      const docA = new Y.Doc();
      const docB = new Y.Doc();
      const awarenessA = new awarenessProtocol.Awareness(docA);
      const awarenessB = new awarenessProtocol.Awareness(docB);

      // Client on Pod B sets local user presence
      awarenessB.setLocalStateField('user', {
         id: 'user-cluster-999',
         name: 'Cluster Collab User',
         color: '#ec4899',
      });

      const awarenessUpdateB = awarenessProtocol.encodeAwarenessUpdate(awarenessB, [docB.clientID]);

      // Simulate applying awareness update from Redis on Pod A
      awarenessProtocol.applyAwarenessUpdate(awarenessA, awarenessUpdateB, 'redis');

      const statesA = awarenessA.getStates();
      const clientBState = statesA.get(docB.clientID) as { user?: { id: string; name: string; color: string } } | undefined;

      expect(clientBState?.user?.id).toBe('user-cluster-999');
      expect(clientBState?.user?.name).toBe('Cluster Collab User');
      expect(clientBState?.user?.color).toBe('#ec4899');
   });

   it('handles high-throughput lock contention across 50 concurrent worker threads', async () => {
      const lockKey = `test:lock:high_concurrency:${Date.now()}`;
      let executedTasks = 0;

      // 50 simultaneous lock attempts
      const attempts = Array.from({ length: 50 }).map(() =>
         withDistributedLock(lockKey, 2000, async () => {
            executedTasks++;
            await new Promise((resolve) => setTimeout(resolve, 50));
            return 'executed';
         })
      );

      const results = await Promise.all(attempts);
      const successfulExecutions = results.filter((res) => res === 'executed').length;
      const rejectedAttempts = results.filter((res) => res === null).length;

      expect(successfulExecutions).toBe(1);
      expect(rejectedAttempts).toBe(49);
      expect(executedTasks).toBe(1);
   });
});
