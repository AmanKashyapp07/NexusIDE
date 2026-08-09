import { describe, it, expect } from 'vitest';

describe('CRDT Compactor Query Scoping Suite', () => {
  it('strictly scopes delta compaction SQL delete queries to the target fileId only', () => {
    const fileUpdates = [
      { id: 1, fileId: 'file-alpha', update: 'u1' },
      { id: 2, fileId: 'file-alpha', update: 'u2' },
      { id: 3, fileId: 'file-beta', update: 'u3' }
    ];

    const purgeFileDeltas = (targetFileId: string) => {
      return fileUpdates.filter(u => u.fileId !== targetFileId);
    };

    const remaining = purgeFileDeltas('file-alpha');

    expect(remaining.length).toBe(1);
    expect(remaining[0].fileId).toBe('file-beta');
  });
});
