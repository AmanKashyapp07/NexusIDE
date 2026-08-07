import { describe, it, expect } from 'vitest';
import { CASService, TreeEntry } from '../backend/src/services/cas.service.js';

describe('CASService — Content-Addressable Storage Engine', () => {
  describe('Blob Hashing (SHA-256)', () => {
    it('generates consistent SHA-256 hex digest for file content', () => {
      const content = 'console.log("Hello NexusIDE");';
      const result1 = CASService.hashContent(content);
      const result2 = CASService.hashContent(content);

      expect(result1.hash).toBe(result2.hash);
      expect(result1.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(result1.sizeBytes).toBe(Buffer.byteLength(content, 'utf8'));
    });

    it('generates distinct hashes for distinct contents (deduplication accuracy)', () => {
      const fileA = CASService.hashContent('export const a = 1;');
      const fileB = CASService.hashContent('export const b = 2;');
      expect(fileA.hash).not.toBe(fileB.hash);
    });

    it('handles empty and null content safely', () => {
      const empty1 = CASService.hashContent('');
      const empty2 = CASService.hashContent(null as any);
      expect(empty1.hash).toBe(empty2.hash);
      expect(empty1.sizeBytes).toBe(0);
    });
  });

  describe('Tree Entry Determinism & Merkle Root Hashing', () => {
    it('produces identical tree hashes regardless of file array insertion order', async () => {
      const filesOrder1 = [
        { path: 'src/index.ts', content: 'import React from "react";' },
        { path: 'package.json', content: '{"name": "nexus"}' },
        { path: 'README.md', content: '# NexusIDE Docs' },
      ];

      const filesOrder2 = [
        { path: 'README.md', content: '# NexusIDE Docs' },
        { path: 'src/index.ts', content: 'import React from "react";' },
        { path: 'package.json', content: '{"name": "nexus"}' },
      ];

      const dag1 = await CASService.buildMerkleTree(filesOrder1);
      const dag2 = await CASService.buildMerkleTree(filesOrder2);

      expect(dag1.rootTreeHash).toBe(dag2.rootTreeHash);
      expect(dag1.treesToInsert[0].hash).toBe(dag2.treesToInsert[0].hash);
      expect(dag1.blobsToInsert.length).toBe(3);
    });

    it('deduplicates identical file contents across files in the same snapshot', async () => {
      const duplicateFiles = [
        { path: 'src/a.txt', content: 'IDENTICAL CONTENT' },
        { path: 'src/b.txt', content: 'IDENTICAL CONTENT' },
        { path: 'docs/copy.txt', content: 'IDENTICAL CONTENT' },
      ];

      const dag = await CASService.buildMerkleTree(duplicateFiles);

      // Blobs to insert must be deduplicated to 1 entry
      expect(dag.blobsToInsert.length).toBe(1);
      expect(dag.blobsToInsert[0].content).toBe('IDENTICAL CONTENT');

      // The tree still contains all 3 file entries pointing to the same hash
      expect(dag.treesToInsert[0].entries.length).toBe(3);
      expect(dag.treesToInsert[0].entries[0].hash).toBe(dag.blobsToInsert[0].hash);
      expect(dag.treesToInsert[0].entries[1].hash).toBe(dag.blobsToInsert[0].hash);
      expect(dag.treesToInsert[0].entries[2].hash).toBe(dag.blobsToInsert[0].hash);
    });
  });

  describe('O(1) & Structural Tree Diffing', () => {
    it('returns empty diff when comparing two identical tree entry sets', () => {
      const entries: TreeEntry[] = [
        { name: 'App.tsx', type: 'blob', hash: 'hash1', path: 'src/App.tsx', language: 'typescript', sizeBytes: 100 },
        { name: 'main.ts', type: 'blob', hash: 'hash2', path: 'src/main.ts', language: 'typescript', sizeBytes: 50 },
      ];

      const diff = CASService.diffTrees(entries, entries);
      expect(diff.added.length).toBe(0);
      expect(diff.modified.length).toBe(0);
      expect(diff.deleted.length).toBe(0);
    });

    it('accurately identifies added, modified, and deleted entries across trees', () => {
      const treeV1: TreeEntry[] = [
        { name: 'keep.ts', type: 'blob', hash: 'hash_keep', path: 'keep.ts', language: 'typescript' },
        { name: 'change.ts', type: 'blob', hash: 'hash_v1', path: 'change.ts', language: 'typescript' },
        { name: 'delete.ts', type: 'blob', hash: 'hash_del', path: 'delete.ts', language: 'typescript' },
      ];

      const treeV2: TreeEntry[] = [
        { name: 'keep.ts', type: 'blob', hash: 'hash_keep', path: 'keep.ts', language: 'typescript' },
        { name: 'change.ts', type: 'blob', hash: 'hash_v2', path: 'change.ts', language: 'typescript' }, // modified
        { name: 'new.ts', type: 'blob', hash: 'hash_new', path: 'new.ts', language: 'typescript' },       // added
      ];

      const diff = CASService.diffTrees(treeV1, treeV2);

      expect(diff.added.map(e => e.path)).toEqual(['new.ts']);
      expect(diff.modified.map(e => e.path)).toEqual(['change.ts']);
      expect(diff.deleted.map(e => e.path)).toEqual(['delete.ts']);
    });
  });
});
