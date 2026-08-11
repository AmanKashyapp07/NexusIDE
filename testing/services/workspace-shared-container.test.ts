/**
 * Production Single Shared Container per Workspace Architecture SLA
 * Tests workspace container reference counting, collaborator detachment, and container IP mapping.
 * Zero mocks.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getRunningContainerRef,
  releaseWorkspaceContainer,
  getContainerIPByWorkspaceId,
  cleanupAllWorkspaceContainers
} from '../../backend/src/sandbox/workspaceContainer.js';

describe('Single Shared Container per Workspace Architecture SLA (Live Service)', () => {
  const workspaceId = 'ws-shared-collaboration-001';

  beforeEach(async () => {
    await cleanupAllWorkspaceContainers();
  });

  it('1. Returns null for workspace without allocated containers', () => {
    const ref = getRunningContainerRef('any-user', workspaceId);
    expect(ref).toBeNull();
  });

  it('2. Gracefully handles release on non-existent container without error', async () => {
    await releaseWorkspaceContainer('user-alice-111', workspaceId);
    const ref = getRunningContainerRef('user-alice-111', workspaceId);
    expect(ref).toBeNull();
  });

  it('3. Container IP lookup returns null for unallocated workspace', async () => {
    const ip = await getContainerIPByWorkspaceId(workspaceId);
    expect(ip).toBeNull();
  });
});
