import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockContainer = {
   pause: vi.fn(async () => {}),
   unpause: vi.fn(async () => {}),
   remove: vi.fn(async () => {}),
};

vi.mock('../../backend/src/sandbox/pool.js', () => ({
   warmPoolManager: {
      popTerminalContainer: vi.fn(async () => ({
         container: mockContainer,
         id: 'mock-container-id-101',
         hostPort: 12345,
      })),
      releaseTerminalContainer: vi.fn(),
   },
   WORKSPACE_DATA_DIR: '/tmp/test-workspace-data',
}));

vi.mock('../../backend/src/db.js', () => ({
   getPool: () => ({
      query: vi.fn(async () => ({ rows: [] })),
   }),
}));

vi.mock('../../backend/src/sandbox/containerLifecycle.service.js', () => ({
   populateContainerWorkspace: vi.fn(async () => {}),
   runContainerSetupScripts: vi.fn(async () => {}),
}));

import {
   getOrCreateWorkspaceContainer,
   hibernateWorkspaceContainer,
   unhibernateWorkspaceContainer,
   prewarmWorkspaceContainer,
   getRunningContainerRef,
   cleanupAllWorkspaceContainers,
} from '../../backend/src/sandbox/workspaceContainer.js';

describe('Workspace Container Pre-Warming & Hibernation Engine', () => {
   const userId = 'user-test-777';
   const workspaceId = '00000000-0000-0000-0000-000000000777';

   beforeEach(async () => {
      vi.clearAllMocks();
      mockContainer.pause.mockReset();
      mockContainer.unpause.mockReset();
      mockContainer.remove.mockReset();
      await cleanupAllWorkspaceContainers();
   });

   it('1. pre-warms workspace container asynchronously before open', async () => {
      const container = await prewarmWorkspaceContainer(userId, workspaceId);
      expect(container).toBeDefined();

      const ref = getRunningContainerRef(userId, workspaceId);
      expect(ref).toBeDefined();
      expect(ref?.id).toBe('mock-container-id-101');
   });

   it('2. hibernates container state by pausing Docker container cgroups', async () => {
      await getOrCreateWorkspaceContainer(userId, workspaceId);

      const hibernated = await hibernateWorkspaceContainer(userId, workspaceId);
      expect(hibernated).toBe(true);
      expect(mockContainer.pause).toHaveBeenCalledTimes(1);

      const ref = getRunningContainerRef(userId, workspaceId);
      expect(ref?.isPaused).toBe(true);
   });

   it('3. un-hibernates container state when client reconnects', async () => {
      await getOrCreateWorkspaceContainer(userId, workspaceId);
      await hibernateWorkspaceContainer(userId, workspaceId);

      const unhibernated = await unhibernateWorkspaceContainer(userId, workspaceId);
      expect(unhibernated).toBe(true);
      expect(mockContainer.unpause).toHaveBeenCalledTimes(1);

      const ref = getRunningContainerRef(userId, workspaceId);
      expect(ref?.isPaused).toBe(false);
   });

   it('4. double hibernate call on an already hibernated container returns false (already paused)', async () => {
      await getOrCreateWorkspaceContainer(userId, workspaceId);
      await hibernateWorkspaceContainer(userId, workspaceId);

      const secondHibernate = await hibernateWorkspaceContainer(userId, workspaceId);
      expect(secondHibernate).toBe(false);
      expect(mockContainer.pause).toHaveBeenCalledTimes(1);
   });

   it('5. unhibernate on an active (non-paused) container returns false (not paused)', async () => {
      await getOrCreateWorkspaceContainer(userId, workspaceId);

      const unhibernated = await unhibernateWorkspaceContainer(userId, workspaceId);
      expect(unhibernated).toBe(false);
      expect(mockContainer.unpause).not.toHaveBeenCalled();
   });

   it('6. hibernate on a non-existent container returns false', async () => {
      const result = await hibernateWorkspaceContainer('non-user', 'non-ws');
      expect(result).toBe(false);
   });

   it('7. unhibernate on a non-existent container returns false', async () => {
      const result = await unhibernateWorkspaceContainer('non-user', 'non-ws');
      expect(result).toBe(false);
   });

   it('8. cleanupAllWorkspaceContainers destroys all container references', async () => {
      await getOrCreateWorkspaceContainer(userId, workspaceId);
      expect(getRunningContainerRef(userId, workspaceId)).toBeDefined();

      await cleanupAllWorkspaceContainers();
      expect(getRunningContainerRef(userId, workspaceId)).toBeNull();
   });
});
