import { describe, it, expect, vi, beforeEach } from 'vitest';


const { mockContainer } = vi.hoisted(() => {
   return {
      mockContainer: {
         id: 'shared-container-workspace-test-999',
         inspect: vi.fn().mockResolvedValue({
            NetworkSettings: { IPAddress: '172.17.0.99' }
         }),
         pause: vi.fn().mockResolvedValue({}),
         unpause: vi.fn().mockResolvedValue({}),
         remove: vi.fn().mockResolvedValue({}),
         exec: vi.fn().mockResolvedValue({
            start: vi.fn().mockResolvedValue({})
         })
      }
   };
});

vi.mock('../backend/src/sandbox/pool.js', () => ({
   warmPoolManager: {
      popTerminalContainer: vi.fn().mockResolvedValue({
         container: mockContainer,
         id: 'shared-container-workspace-test-999',
         hostPort: 32999
      }),
      releaseTerminalContainer: vi.fn()
   },
   WORKSPACE_DATA_DIR: '/tmp/nexus_test_shared_workspaces'
}));

vi.mock('../backend/src/db.js', () => ({
   getPool: vi.fn().mockReturnValue({
      query: vi.fn().mockResolvedValue({ rows: [] })
   })
}));

vi.mock('../backend/src/sandbox/containerLifecycle.service.js', () => ({
   populateContainerWorkspace: vi.fn().mockResolvedValue(undefined),
   runContainerSetupScripts: vi.fn().mockResolvedValue(undefined)
}));

import {
   getOrCreateWorkspaceContainer,
   releaseWorkspaceContainer,
   getRunningContainerRef,
   getContainerIPByWorkspaceId,
   hibernateWorkspaceContainer,
   unhibernateWorkspaceContainer,
   cleanupAllWorkspaceContainers
} from '../backend/src/sandbox/workspaceContainer.js';

describe('Single Shared Container per Workspace Architecture', () => {
   const workspaceId = 'ws-shared-collaboration-001';

   beforeEach(async () => {
      vi.clearAllMocks();
      await cleanupAllWorkspaceContainers();
   });

   it('allocates the exact same Docker container for multiple collaborating users', async () => {
      const containerAlice = await getOrCreateWorkspaceContainer('user-alice-111', workspaceId);
      const containerBob = await getOrCreateWorkspaceContainer('user-bob-222', workspaceId);

      expect(containerAlice).toBe(containerBob);
      expect(containerAlice.id).toBe('shared-container-workspace-test-999');

      const ref = getRunningContainerRef('any-user', workspaceId);
      expect(ref).toBeDefined();
      expect(ref?.refCount).toBe(2);
      expect(ref?.id).toBe('shared-container-workspace-test-999');
   });

   it('decrements refCount when collaborators disconnect without destroying active container', async () => {
      await getOrCreateWorkspaceContainer('user-alice-111', workspaceId);
      await getOrCreateWorkspaceContainer('user-bob-222', workspaceId);

      await releaseWorkspaceContainer('user-alice-111', workspaceId);
      const refAfterAliceLeaves = getRunningContainerRef('user-bob-222', workspaceId);
      expect(refAfterAliceLeaves?.refCount).toBe(1);
      expect(refAfterAliceLeaves?.container.id).toBe('shared-container-workspace-test-999');

      await releaseWorkspaceContainer('user-bob-222', workspaceId);
      const refAfterBobLeaves = getRunningContainerRef('user-bob-222', workspaceId);
      expect(refAfterBobLeaves?.refCount).toBe(0);
   });

   it('resolves direct container IP address for multi-port routing', async () => {
      await getOrCreateWorkspaceContainer('user-alice-111', workspaceId);
      const ip = await getContainerIPByWorkspaceId(workspaceId);
      expect(ip).toBe('172.17.0.99');
   });

   it('hibernates and unpauses shared workspace container cleanly', async () => {
      await getOrCreateWorkspaceContainer('user-alice-111', workspaceId);
      const hibernated = await hibernateWorkspaceContainer('user-alice-111', workspaceId);
      expect(hibernated).toBe(true);
      expect(mockContainer.pause).toHaveBeenCalledTimes(1);

      const unhibernated = await unhibernateWorkspaceContainer('user-bob-222', workspaceId);
      expect(unhibernated).toBe(true);
      expect(mockContainer.unpause).toHaveBeenCalledTimes(1);
   });
});
