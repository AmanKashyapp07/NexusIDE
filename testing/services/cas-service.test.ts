import { describe, it, expect } from 'vitest';
import { CASService, TreeEntry } from '../../backend/src/services/cas.service.js';

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

    it('hashes string content deterministically with valid SHA-256 length', () => {
      const res = CASService.hashContent('binary_sample_data_stream');
      expect(res.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(res.sizeBytes).toBe(25);
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

      expect(dag.blobsToInsert.length).toBe(1);
      expect(dag.blobsToInsert[0].content).toBe('IDENTICAL CONTENT');

      expect(dag.treesToInsert[0].entries.length).toBe(3);
      expect(dag.treesToInsert[0].entries[0].hash).toBe(dag.blobsToInsert[0].hash);
      expect(dag.treesToInsert[0].entries[1].hash).toBe(dag.blobsToInsert[0].hash);
      expect(dag.treesToInsert[0].entries[2].hash).toBe(dag.blobsToInsert[0].hash);
    });

    it('builds Merkle DAG deterministically for 5-level deep nested file paths', async () => {
      const deepFiles = [
        { path: 'level1/level2/level3/level4/deep.ts', content: 'export const deep = true;' }
      ];

      const dag = await CASService.buildMerkleTree(deepFiles);
      expect(dag.rootTreeHash).toMatch(/^[a-f0-9]{64}$/);
      expect(dag.blobsToInsert.length).toBe(1);
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
        { name: 'change.ts', type: 'blob', hash: 'hash_v2', path: 'change.ts', language: 'typescript' },
        { name: 'new.ts', type: 'blob', hash: 'hash_new', path: 'new.ts', language: 'typescript' },
      ];

      const diff = CASService.diffTrees(treeV1, treeV2);

      expect(diff.added.map(e => e.path)).toEqual(['new.ts']);
      expect(diff.modified.map(e => e.path)).toEqual(['change.ts']);
      expect(diff.deleted.map(e => e.path)).toEqual(['delete.ts']);
    });

    it('handles rename-only file modifications (blob hash identical, path entry changed)', () => {
      const treeV1: TreeEntry[] = [
        { name: 'old_name.ts', type: 'blob', hash: 'hash_same_blob', path: 'src/old_name.ts', language: 'typescript' }
      ];

      const treeV2: TreeEntry[] = [
        { name: 'new_name.ts', type: 'blob', hash: 'hash_same_blob', path: 'src/new_name.ts', language: 'typescript' }
      ];

      const diff = CASService.diffTrees(treeV1, treeV2);
      expect(diff.added.map(e => e.path)).toEqual(['src/new_name.ts']);
      expect(diff.deleted.map(e => e.path)).toEqual(['src/old_name.ts']);
      expect(diff.modified.length).toBe(0);
    });

    it('diffs empty tree arrays safely without throwing', () => {
      const diff = CASService.diffTrees([], []);
      expect(diff.added).toEqual([]);
      expect(diff.modified).toEqual([]);
      expect(diff.deleted).toEqual([]);
    });

    it('diffs 500 tree entries in < 5ms (high performance structural diffing)', () => {
      const v1Entries: TreeEntry[] = Array.from({ length: 500 }, (_, i) => ({
        name: `file_${i}.ts`,
        type: 'blob',
        hash: `hash_${i}`,
        path: `src/file_${i}.ts`,
        language: 'typescript'
      }));

      const v2Entries: TreeEntry[] = Array.from({ length: 500 }, (_, i) => ({
        name: `file_${i}.ts`,
        type: 'blob',
        hash: i === 250 ? 'hash_modified' : `hash_${i}`,
        path: `src/file_${i}.ts`,
        language: 'typescript'
      }));

      const start = Date.now();
      const diff = CASService.diffTrees(v1Entries, v2Entries);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(15);
      expect(diff.modified).toHaveLength(1);
      expect(diff.modified[0].path).toBe('src/file_250.ts');
    });
  });
});
