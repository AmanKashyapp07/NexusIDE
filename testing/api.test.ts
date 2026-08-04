import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWorkspaceFiles, createFile, deleteFile } from '../frontend/src/api/workspace';
import { fetchFileHistory } from '../frontend/src/api/history';
import { createSnapshot } from '../frontend/src/api/snapshots';
import { fetchCurrentUser } from '../frontend/src/api/auth';

describe('API Services', () => {
  const mockFetch = vi.fn();
  let originalFetch: any;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = global.fetch;
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fetchWorkspaceFiles includes Bearer token and returns JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([{ id: 'f1', name: 'index.js' }])
    });

    const result = await fetchWorkspaceFiles('token123', 'ws1');
    
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/workspace/ws1/files'),
      expect.objectContaining({
        headers: { Authorization: 'Bearer token123' }
      })
    );
    expect(result).toEqual([{ id: 'f1', name: 'index.js' }]);
  });

  it('createFile constructs POST request correctly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ fileId: 'f2' })
    });

    await createFile('token123', 'ws1', { name: 'app.js', type: 'file', parent_id: '', language: 'javascript' });
    
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/workspace/ws1/files'),
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token123'
        },
        body: JSON.stringify({ name: 'app.js', type: 'file', parent_id: '', language: 'javascript' })
      })
    );
  });

  it('API functions throw error when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: async () => 'Unauthorized'
    });

    await expect(fetchCurrentUser('bad-token')).rejects.toThrow('Unauthorized');
  });

  it('fetchFileHistory uses History API correctly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ updates: [], authorMap: {} })
    });

    const result = await fetchFileHistory('token123', 'ws1', 'f1');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/workspace/ws1/files/f1/history'),
      expect.objectContaining({
        headers: { Authorization: 'Bearer token123' }
      })
    );
    expect(result).toEqual({ updates: [], authorMap: {} });
  });
});
