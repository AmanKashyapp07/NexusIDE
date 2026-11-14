import { performance } from 'perf_hooks';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Direct production import
import { CASService, TreeEntry } from '../../backend/src/services/cas.service.js';

import { Statistics } from '../common/statistics.mjs';
import { Assertions } from '../common/assertions.mjs';
import { BenchmarkLogger } from '../common/logger.mjs';
import { detectEnvironment } from '../common/environment.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  BenchmarkLogger.header('Benchmark 3: Merkle DAG & Content-Addressable Storage (Production CASService)');
  const env = await detectEnvironment();

  // 1. Correctness & Determinism Verification
  BenchmarkLogger.section('1. Cryptographic Invariants & Canonical Determinism');

  // Determinism test: permuted file order must yield identical rootTreeHash
  const baseFiles = [
    { path: 'src/components/Editor.tsx', content: 'export const Editor = () => <div/>;' },
    { path: 'src/services/api.ts', content: 'export const api = { get: () => {} };' },
    { path: 'package.json', content: '{"name": "test-project"}' },
    { path: 'README.md', content: '# Welcome to NexusIDE' }
  ];
  const permutedFiles = [baseFiles[2], baseFiles[0], baseFiles[3], baseFiles[1]];

  const dag1 = CASService.buildMerkleTreeInline(baseFiles);
  const dag2 = CASService.buildMerkleTreeInline(permutedFiles);
  Assertions.assertEqual(dag1.rootTreeHash, dag2.rootTreeHash, 'Root tree hash must be invariant to insertion order');
  BenchmarkLogger.success(`Canonical sorting determinism verified: ${dag1.rootTreeHash.slice(0, 16)}...`);

  // Diff correctness
  const modifiedFiles = [...baseFiles];
  modifiedFiles[0] = { path: 'src/components/Editor.tsx', content: 'export const Editor = () => <div className="updated"/>;' };
  const dagModified = CASService.buildMerkleTreeInline(modifiedFiles);
  const diff = CASService.diffTrees(dag1.treesToInsert[0].entries, dagModified.treesToInsert[0].entries);
  Assertions.assertEqual(diff.modified.length, 1, 'Should detect exactly 1 modified file');
  Assertions.assertEqual(diff.modified[0].path, 'src/components/Editor.tsx', 'Modified file path mismatch');
  BenchmarkLogger.success('Structural tree diffing fidelity verified');

  const results = {};

  // 2. Pure Content Hashing (SHA-256) across file sizes
  BenchmarkLogger.section('2. File Content Hashing Throughput (1KB to 1MB)');
  const sizes = [
    { label: '1KB', bytes: 1024 },
    { label: '10KB', bytes: 10 * 1024 },
    { label: '100KB', bytes: 100 * 1024 },
    { label: '1MB', bytes: 1024 * 1024 }
  ];
  results['contentHashing'] = {};

  for (const s of sizes) {
    const payload = 'A'.repeat(s.bytes);
    const stats = Statistics.measureSync(() => {
      CASService.hashContent(payload);
    }, 1000, 100);

    const mbPerSec = Number(((s.bytes * stats.opsPerSec) / (1024 * 1024)).toFixed(2));
    results['contentHashing'][s.label] = {
      sizeBytes: s.bytes,
      stats,
      throughputMbPerSec: mbPerSec
    };
    console.log(`  ${s.label}: Median ${stats.median} ms | ${stats.opsPerSec.toLocaleString()} ops/s | ${mbPerSec} MB/s`);
  }

  // 3. Tree Entry Sorting & Hashing (10 to 500 entries)
  BenchmarkLogger.section('3. Canonical Tree Node Hashing (10 to 500 entries)');
  const entryCounts = [10, 50, 100, 500];
  results['treeHashing'] = {};

  for (const count of entryCounts) {
    const entries: TreeEntry[] = Array.from({ length: count }, (_, i) => ({
      name: `file_${i}.ts`,
      type: 'blob',
      hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      path: `src/modules/submodule_${i % 5}/file_${i}.ts`,
      sizeBytes: 1024
    }));

    const stats = Statistics.measureSync(() => {
      CASService.hashTreeEntries(entries);
    }, 1000, 100);

    results['treeHashing'][count] = stats;
    console.log(`  ${count} entries: Median ${stats.median} ms | ${stats.opsPerSec.toLocaleString()} ops/s`);
  }

  // 4. End-to-End Merkle DAG Generation (10 to 500 files)
  BenchmarkLogger.section('4. Workspace Merkle DAG Generation (10 to 500 files)');
  const workspaceFileCounts = [10, 50, 100, 500];
  results['dagGeneration'] = {};

  for (const fileCount of workspaceFileCounts) {
    const files = Array.from({ length: fileCount }, (_, i) => ({
      path: `src/components/Component_${i}.tsx`,
      content: `// Component ${i}\nexport function Component${i}() { return <div>Node ${i}</div>; }`
    }));

    const iters = fileCount <= 100 ? 1000 : 200;
    const stats = Statistics.measureSync(() => {
      CASService.buildMerkleTreeInline(files);
    }, iters, 50);

    results['dagGeneration'][fileCount] = stats;
    console.log(`  ${fileCount} files: Median ${stats.median} ms | p95 ${stats.p95} ms | ${stats.opsPerSec.toLocaleString()} dags/s`);
  }

  // 5. Tree Diff Engine (100-file baseline)
  BenchmarkLogger.section('5. Structural Tree Diffing (100 files base)');
  const base100 = Array.from({ length: 100 }, (_, i) => ({
    path: `file_${i}.ts`,
    content: `content of file ${i}`
  }));
  const treeBase = CASService.buildMerkleTreeInline(base100).treesToInsert[0].entries;

  // 1 file changed
  const mod1 = [...base100];
  mod1[0] = { path: 'file_0.ts', content: 'new content' };
  const treeMod1 = CASService.buildMerkleTreeInline(mod1).treesToInsert[0].entries;
  const diff1Stats = Statistics.measureSync(() => {
    CASService.diffTrees(treeBase, treeMod1);
  }, 1000, 100);

  // 10 files changed
  const mod10 = [...base100];
  for (let i = 0; i < 10; i++) mod10[i] = { path: `file_${i}.ts`, content: `modified content ${i}` };
  const treeMod10 = CASService.buildMerkleTreeInline(mod10).treesToInsert[0].entries;
  const diff10Stats = Statistics.measureSync(() => {
    CASService.diffTrees(treeBase, treeMod10);
  }, 1000, 100);

  // 100 files changed
  const mod100 = base100.map((f, idx) => ({ path: f.path, content: `completely rewritten ${idx}` }));
  const treeMod100 = CASService.buildMerkleTreeInline(mod100).treesToInsert[0].entries;
  const diff100Stats = Statistics.measureSync(() => {
    CASService.diffTrees(treeBase, treeMod100);
  }, 1000, 100);

  results['treeDiff'] = {
    oneFileModified: diff1Stats,
    tenFilesModified: diff10Stats,
    allFilesModified: diff100Stats
  };
  console.log(`  1 file changed:   Median ${diff1Stats.median} ms | ${diff1Stats.opsPerSec.toLocaleString()} diffs/s`);
  console.log(`  10 files changed:  Median ${diff10Stats.median} ms | ${diff10Stats.opsPerSec.toLocaleString()} diffs/s`);
  console.log(`  100 files changed: Median ${diff100Stats.median} ms | ${diff100Stats.opsPerSec.toLocaleString()} diffs/s`);

  // 6. Deduplication Ratio Analysis across Varying Duplication Scenarios
  BenchmarkLogger.section('6. Content Deduplication Across Variable Redundancy');
  const dedupScenarios = [
    { label: '0% Duplication (Unique Code)', totalFiles: 100, duplicateCount: 0 },
    { label: '25% Duplication (Templates/Boilerplate)', totalFiles: 100, duplicateCount: 25 },
    { label: '50% Duplication (Forked/Vendored Files)', totalFiles: 100, duplicateCount: 50 },
    { label: '75% Duplication (Monorepo Symlinks/Shared)', totalFiles: 100, duplicateCount: 75 }
  ];
  results['deduplication'] = {};

  const commonTemplateContent = '// Shared License and Standard Header\nexport const VERSION = "1.0.0";';
  for (const scen of dedupScenarios) {
    const files = [];
    for (let i = 0; i < scen.totalFiles; i++) {
      if (i < scen.duplicateCount) {
        files.push({ path: `src/dup_${i}.ts`, content: commonTemplateContent });
      } else {
        files.push({ path: `src/unique_${i}.ts`, content: `const uniqueData_${i} = ${Math.random()};` });
      }
    }

    const dag = CASService.buildMerkleTreeInline(files);
    const totalContentBytes = files.reduce((acc, f) => acc + Buffer.byteLength(f.content, 'utf8'), 0);
    const deduplicatedBytes = dag.blobsToInsert.reduce((acc, b) => acc + b.sizeBytes, 0);
    const storageSavedBytes = totalContentBytes - deduplicatedBytes;
    const storageSavedPct = totalContentBytes > 0 ? Number(((storageSavedBytes / totalContentBytes) * 100).toFixed(2)) : 0;

    results['deduplication'][scen.label] = {
      totalFiles: scen.totalFiles,
      uniqueBlobs: dag.blobsToInsert.length,
      reusedBlobs: scen.totalFiles - dag.blobsToInsert.length,
      totalContentBytes,
      deduplicatedBytes,
      storageSavedBytes,
      storageSavedPct
    };

    console.log(`  ${scen.label}: ${dag.blobsToInsert.length} unique blobs vs ${scen.totalFiles} files (${storageSavedPct}% bytes saved)`);
  }

  // Save results
  const outputData = {
    benchmark: 'Merkle DAG & Content-Addressable Storage',
    timestamp: new Date().toISOString(),
    environment: env,
    evidenceTier: 'Tier B (Production Implementation Algorithm Benchmark)',
    productionSource: 'backend/src/services/cas.service.ts',
    results
  };

  const resultsDir = path.resolve(__dirname, '..', 'results', 'raw');
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(
    path.join(resultsDir, 'merkle-dag-production.json'),
    JSON.stringify(outputData, null, 2)
  );

  BenchmarkLogger.success(`Results written to ${path.join(resultsDir, 'merkle-dag-production.json')}`);
}

run().catch(err => {
  BenchmarkLogger.error(`Benchmark failed: ${err.message}\n${err.stack}`);
  process.exit(1);
});
