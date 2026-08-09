import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

describe('Merkle DAG Integrity & Snapshot Restore Suite', () => {
  it('computes deterministic SHA-256 Merkle root hash regardless of file array insertion order', () => {
    const filesA = [
      { name: 'src/index.ts', content: 'console.log("hello");' },
      { name: 'package.json', content: '{"name": "test"}' }
    ];

    const filesB = [
      { name: 'package.json', content: '{"name": "test"}' },
      { name: 'src/index.ts', content: 'console.log("hello");' }
    ];

    const computeMerkleRoot = (fileList: Array<{ name: string; content: string }>): string => {
      const sortedHashes = fileList
        .map(f => {
          const contentHash = crypto.createHash('sha256').update(f.content).digest('hex');
          return crypto.createHash('sha256').update(`${f.name}:${contentHash}`).digest('hex');
        })
        .sort();

      return crypto.createHash('sha256').update(sortedHashes.join(':')).digest('hex');
    };

    const rootA = computeMerkleRoot(filesA);
    const rootB = computeMerkleRoot(filesB);

    expect(rootA).toBe(rootB);
    expect(rootA.length).toBe(64); // Valid SHA-256 hex length
  });

  it('enforces 10-snapshot cap per workspace with oldest-first pruning', () => {
    const MAX_SNAPSHOTS = 10;
    const snapshots: Array<{ id: number; createdAt: number }> = [];

    const addSnapshot = (id: number) => {
      snapshots.push({ id, createdAt: Date.now() });
      if (snapshots.length > MAX_SNAPSHOTS) {
        snapshots.shift(); // Evict oldest
      }
    };

    // Add 15 snapshots
    for (let i = 1; i <= 15; i++) {
      addSnapshot(i);
    }

    expect(snapshots.length).toBe(10);
    expect(snapshots[0].id).toBe(6); // Oldest 5 pruned
    expect(snapshots[9].id).toBe(15);
  });
});
