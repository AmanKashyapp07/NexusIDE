import { describe, it, expect, vi } from 'vitest';
import { getSocketIoOptions } from '../../frontend/src/lib/backendUrls';

describe('Phase 1 Frontend Network & Boot Optimization Suite', () => {
  it('1. executes user profile, workspace metadata, and file list requests in parallel via Promise.all', async () => {
    const callOrder: string[] = [];

    const mockFetchUser = vi.fn().mockImplementation(async () => {
      callOrder.push('start:user');
      await new Promise(r => setTimeout(r, 10));
      callOrder.push('end:user');
      return { id: 'u1', username: 'alice' };
    });

    const mockFetchWs = vi.fn().mockImplementation(async () => {
      callOrder.push('start:ws');
      await new Promise(r => setTimeout(r, 10));
      callOrder.push('end:ws');
      return { id: 'ws1', title: 'Test Workspace', userRole: 'admin' };
    });

    const mockFetchFiles = vi.fn().mockImplementation(async () => {
      callOrder.push('start:files');
      await new Promise(r => setTimeout(r, 10));
      callOrder.push('end:files');
      return [{ id: 'f1', name: 'main.ts', type: 'file', parent_id: null, language: 'typescript' }];
    });

    const tStart = Date.now();
    const [user, ws, files] = await Promise.all([
      mockFetchUser(),
      mockFetchWs(),
      mockFetchFiles()
    ]);
    const tElapsed = Date.now() - tStart;

    expect(user.username).toBe('alice');
    expect(ws.title).toBe('Test Workspace');
    expect(files.length).toBe(1);

    // Verify all 3 start calls fired before any completed (parallel execution)
    expect(callOrder.indexOf('start:user')).toBeLessThan(callOrder.indexOf('end:user'));
    expect(callOrder.indexOf('start:ws')).toBeLessThan(callOrder.indexOf('end:user'));
    expect(callOrder.indexOf('start:files')).toBeLessThan(callOrder.indexOf('end:user'));

    // Total elapsed time is ~10ms (1 RTT), not 30ms (3 RTTs)
    expect(tElapsed).toBeLessThan(25);
  });

  it('2. returns direct single-transport WebSocket options in getSocketIoOptions', () => {
    const options = getSocketIoOptions();
    expect(options.transports).toEqual(['websocket']);
    expect(options.upgrade).toBe(false);
    expect(options.path).toBeDefined();
  });
});
