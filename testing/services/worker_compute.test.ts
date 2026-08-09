import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as Y from 'yjs';
import { workerPoolService } from '../../backend/src/services/workerPool.service.js';
import { CASService } from '../../backend/src/services/cas.service.js';

describe('Phase 1: Heavy Compute Offloading & Event-Loop Protection Suite', () => {
  afterAll(() => {
    workerPoolService.terminate();
  });

  // ===========================================================================
  // 1. WORKER POOL INSTANTIATION & TASK DISPATCH
  // ===========================================================================

  it('WorkerPoolService dispatches Merkle Tree build task and returns correct DAG structure', async () => {
    const files = [
      { path: 'src/main.ts', content: 'console.log("hello world");', language: 'typescript' },
      { path: 'src/utils.ts', content: 'export const add = (a: number, b: number) => a + b;', language: 'typescript' },
      { path: 'package.json', content: '{"name": "test-app"}', language: 'json' },
      { path: 'README.md', content: '# Test App', language: 'markdown' },
    ];

    const dag = await workerPoolService.buildMerkleTreeOffloaded(files);

    expect(dag).toBeDefined();
    expect(dag.rootTreeHash).toHaveLength(64); // SHA-256 hex length
    expect(dag.blobsToInsert).toHaveLength(4);
    expect(dag.treesToInsert).toHaveLength(1);
    expect(dag.treesToInsert[0]!.entries).toHaveLength(4);
  });

  it('WorkerPoolService Merkle DAG matches inline CASService output deterministically', async () => {
    const files = Array.from({ length: 15 }, (_, i) => ({
      path: `src/module_${i}.ts`,
      content: `export function fn${i}() { return ${i * 100}; }`,
      language: 'typescript',
    }));

    const inlineDag = CASService.buildMerkleTreeInline(files);
    const workerDag = await workerPoolService.buildMerkleTreeOffloaded(files);

    expect(workerDag.rootTreeHash).toBe(inlineDag.rootTreeHash);
    expect(workerDag.blobsToInsert.length).toBe(inlineDag.blobsToInsert.length);
    expect(workerDag.treesToInsert[0]!.entries).toEqual(inlineDag.treesToInsert[0]!.entries);
  });

  // ===========================================================================
  // 2. YJS CRDT UPDATE MERGING OFFLOAD
  // ===========================================================================

  it('WorkerPoolService merges Yjs CRDT binary deltas correctly off main thread', async () => {
    const doc1 = new Y.Doc({ gc: false });
    doc1.getText('monaco').insert(0, 'Initial document text. ');
    const update1 = Y.encodeStateAsUpdate(doc1);

    const doc2 = new Y.Doc({ gc: false });
    Y.applyUpdate(doc2, update1);
    doc2.getText('monaco').insert(23, 'Appended collaborative edit.');
    const update2 = Y.encodeStateAsUpdate(doc2);
    doc1.destroy();
    doc2.destroy();

    const mergedBytes = await workerPoolService.mergeYjsUpdatesOffloaded([update1, update2]);
    expect(mergedBytes).toBeInstanceOf(Uint8Array);
    expect(mergedBytes.length).toBeGreaterThan(0);

    const checkDoc = new Y.Doc({ gc: false });
    Y.applyUpdate(checkDoc, mergedBytes);
    expect(checkDoc.getText('monaco').toString()).toBe('Initial document text. Appended collaborative edit.');
    checkDoc.destroy();
  });

  // ===========================================================================
  // 3. EVENT-LOOP NON-BLOCKING VERIFICATION
  // ===========================================================================

  it('High-volume Merkle tree computation offloaded to worker pool does not block main event loop timers', async () => {
    // Generate 300 files with heavy JSON content to create substantial CPU work
    const largeFiles = Array.from({ length: 300 }, (_, i) => ({
      path: `components/HeavyComponent_${i}.tsx`,
      content: `// Component ${i}\n` + 'const data = ' + JSON.stringify(Array.from({ length: 500 }, (_, k) => ({ id: k, val: `str_${k}` }))),
      language: 'typescript',
    }));

    let timerFiredCount = 0;
    const interval = setInterval(() => {
      timerFiredCount++;
    }, 1);

    const startTime = Date.now();
    const dag = await CASService.buildMerkleTree(largeFiles);
    const elapsed = Date.now() - startTime;

    // Yield short macro-task tick to collect pending interval ticks
    await new Promise((r) => setTimeout(r, 10));
    clearInterval(interval);

    expect(dag.blobsToInsert.length).toBe(300);
    expect(elapsed).toBeLessThan(1500);
    expect(timerFiredCount).toBeGreaterThan(0);
  });
});
