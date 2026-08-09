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
      await cleanupAllWorkspaceContainers();
   });

   it('pre-warms workspace container asynchronously before open', async () => {
      const container = await prewarmWorkspaceContainer(userId, workspaceId);
      expect(container).toBeDefined();

      const ref = getRunningContainerRef(userId, workspaceId);
      expect(ref).toBeDefined();
      expect(ref?.id).toBe('mock-container-id-101');
   });

   it('hibernates container state by pausing Docker container cgroups', async () => {
      await getOrCreateWorkspaceContainer(userId, workspaceId);

      const hibernated = await hibernateWorkspaceContainer(userId, workspaceId);
      expect(hibernated).toBe(true);
      expect(mockContainer.pause).toHaveBeenCalledTimes(1);

      const ref = getRunningContainerRef(userId, workspaceId);
      expect(ref?.isPaused).toBe(true);
   });

   it('un-hibernates container state when client reconnects', async () => {
      await getOrCreateWorkspaceContainer(userId, workspaceId);
      await hibernateWorkspaceContainer(userId, workspaceId);

      const unhibernated = await unhibernateWorkspaceContainer(userId, workspaceId);
      expect(unhibernated).toBe(true);
      expect(mockContainer.unpause).toHaveBeenCalledTimes(1);

      const ref = getRunningContainerRef(userId, workspaceId);
      expect(ref?.isPaused).toBe(false);
   });
});
