/**
 * bench-merkle-dag.mjs
 * Benchmark for the Merkle DAG / CAS Service (CASService) of NexusIDE.
 * Inlines all logic from cas.service.ts using Node.js built-in crypto.
 * Run: /usr/local/bin/node bench-merkle-dag.mjs
 */

import { createHash } from 'crypto';
import { performance } from 'perf_hooks';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

// ─── Inlined CASService Logic ────────────────────────────────────────────────

function hashContent(content) {
  const normalized = content ?? '';
  const hash = createHash('sha256').update(normalized, 'utf8').digest('hex');
  const sizeBytes = Buffer.byteLength(normalized, 'utf8');
  return { hash, sizeBytes };
}

function hashTreeEntries(entries) {
  const sorted = [...entries].sort(
    (a, b) => a.name.localeCompare(b.name) || (a.path || '').localeCompare(b.path || '')
  );
  const serialized = JSON.stringify(sorted);
  const hash = createHash('sha256').update(serialized, 'utf8').digest('hex');
  return { hash, canonicalEntries: sorted };
}

function buildMerkleTreeInline(files) {
  const blobsMap = new Map();
  const rootEntries = [];

  for (const file of files) {
    const content = file.content ?? '';
    const { hash, sizeBytes } = hashContent(content);

    if (!blobsMap.has(hash)) {
      blobsMap.set(hash, { hash, content, sizeBytes });
    }

    const name = file.path.split('/').pop() || file.path;
    rootEntries.push({
      name,
      type: 'blob',
      hash,
      path: file.path,
      language: file.language ?? null,
      sizeBytes,
    });
  }

  const { hash: rootTreeHash, canonicalEntries } = hashTreeEntries(rootEntries);
  const treesToInsert = [{ hash: rootTreeHash, entries: canonicalEntries }];
  const blobsToInsert = Array.from(blobsMap.values());

  return { rootTreeHash, blobsToInsert, treesToInsert };
}

function diffTrees(treeA = [], treeB = []) {
  const mapA = new Map(treeA.map(e => [e.path, e]));
  const mapB = new Map(treeB.map(e => [e.path, e]));

  const added = [];
  const modified = [];
  const deleted = [];

  for (const [path, entryB] of mapB) {
    const entryA = mapA.get(path);
    if (!entryA) {
      added.push(entryB);
    } else if (entryA.hash !== entryB.hash) {
      modified.push(entryB);
    }
  }

  for (const [path, entryA] of mapA) {
    if (!mapB.has(path)) {
      deleted.push(entryA);
    }
  }

  return { added, modified, deleted };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function randomString(sizeBytes) {
  // Generate a reproducible pseudo-random string of approximately sizeBytes.
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 \n\t';
  let s = '';
  for (let i = 0; i < sizeBytes; i++) {
    s += chars[i % chars.length];
  }
  return s;
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, idx)];
}

function stats(timings) {
  const sorted = [...timings].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const median = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const totalMs = sum;
  const opsPerSec = n / (totalMs / 1000);
  return { n, mean, median, p95, p99, opsPerSec, totalMs };
}

function makeTreeEntry(path, hash, sizeBytes = 1024) {
  return {
    name: path.split('/').pop(),
    type: 'blob',
    hash,
    path,
    language: 'typescript',
    sizeBytes,
  };
}

// ─── Scenario Fixtures ───────────────────────────────────────────────────────

const KB = 1024;
const MB = 1024 * 1024;

// Pre-generate content strings to avoid generation overhead in hot loop
const content1KB   = randomString(KB);
const content10KB  = randomString(10 * KB);
const content100KB = randomString(100 * KB);
const content1MB   = randomString(MB);

// Pre-compute hashes for tree-entry scenarios
function makeEntries(n) {
  return Array.from({ length: n }, (_, i) => {
    const content = randomString(KB + i);
    const { hash, sizeBytes } = hashContent(content);
    return makeTreeEntry(`src/file${i}.ts`, hash, sizeBytes);
  });
}
const entries10  = makeEntries(10);
const entries50  = makeEntries(50);
const entries100 = makeEntries(100);

// Pre-build files for buildMerkleTree scenarios
function makeFiles(n) {
  return Array.from({ length: n }, (_, i) => ({
    path: `src/file${i}.ts`,
    content: randomString(KB + i),
    language: 'typescript',
  }));
}
const files10  = makeFiles(10);
const files50  = makeFiles(50);
const files100 = makeFiles(100);

// Pre-build trees for diffTrees scenarios (100-file base)
const BASE_FILES = makeFiles(100);
const baseDAG = buildMerkleTreeInline(BASE_FILES);
const baseFlatEntries = baseDAG.treesToInsert[0].entries;

function makeModifiedTree(nChanged) {
  const modified = [...baseFlatEntries];
  for (let i = 0; i < nChanged; i++) {
    const orig = modified[i];
    const newContent = randomString(KB + i + 999);
    const { hash, sizeBytes } = hashContent(newContent);
    modified[i] = { ...orig, hash, sizeBytes };
  }
  return modified;
}
const diff1Tree   = makeModifiedTree(1);
const diff5Tree   = makeModifiedTree(5);
const diff100Tree = makeModifiedTree(100);

// Deduplication scenario: 100 files, 50 unique + 50 duplicates
const UNIQUE_CONTENT = randomString(KB);
const dedupFiles = Array.from({ length: 100 }, (_, i) => ({
  path: `src/file${i}.ts`,
  content: i < 50 ? randomString(KB + i) : UNIQUE_CONTENT, // 50 dupes of same content
  language: 'typescript',
}));

// Storage scenario fixtures: pre-compute content and their sizes
function makeStorageFiles(n) {
  return Array.from({ length: n }, (_, i) => ({
    path: `src/file${i}.ts`,
    content: randomString(KB + i * 10),
    language: 'typescript',
  }));
}
const storageFiles10  = makeStorageFiles(10);
const storageFiles50  = makeStorageFiles(50);
const storageFiles100 = makeStorageFiles(100);

function calcStorageBytes(files) {
  const dag = buildMerkleTreeInline(files);
  const fullCopyBytes = files.reduce((s, f) => s + Buffer.byteLength(f.content, 'utf8'), 0);
  const dedupBytes    = dag.blobsToInsert.reduce((s, b) => s + b.sizeBytes, 0);
  return {
    fileCount:      files.length,
    uniqueBlobs:    dag.blobsToInsert.length,
    fullCopyBytes,
    dedupBytes,
    savedBytes:     fullCopyBytes - dedupBytes,
    dedupeRatioPct: ((1 - dedupBytes / fullCopyBytes) * 100).toFixed(2),
  };
}

// ─── Runner ──────────────────────────────────────────────────────────────────

const ITERATIONS = 1000;
const results = {};

function runBench(label, fn) {
  const timings = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now();
    fn();
    timings.push(performance.now() - t0);
  }
  return stats(timings);
}

// ─── A. hashContent ───────────────────────────────────────────────────────────

console.log('\n=== A. hashContent ===');
results.A_hashContent = {};

for (const [label, content] of [
  ['1KB',   content1KB],
  ['10KB',  content10KB],
  ['100KB', content100KB],
  ['1MB',   content1MB],
]) {
  const s = runBench(label, () => hashContent(content));
  results.A_hashContent[label] = s;
  console.log(
    `  ${label.padEnd(6)}: median=${s.median.toFixed(4)}ms  p95=${s.p95.toFixed(4)}ms  p99=${s.p99.toFixed(4)}ms  ops/sec=${Math.round(s.opsPerSec).toLocaleString()}`
  );
}

// ─── B. hashTreeEntries ───────────────────────────────────────────────────────

console.log('\n=== B. hashTreeEntries ===');
results.B_hashTreeEntries = {};

for (const [label, entries] of [
  ['10 entries',  entries10],
  ['50 entries',  entries50],
  ['100 entries', entries100],
]) {
  const s = runBench(label, () => hashTreeEntries(entries));
  results.B_hashTreeEntries[label] = s;
  console.log(
    `  ${label.padEnd(13)}: median=${s.median.toFixed(4)}ms  p95=${s.p95.toFixed(4)}ms  p99=${s.p99.toFixed(4)}ms  ops/sec=${Math.round(s.opsPerSec).toLocaleString()}`
  );
}

// ─── C. buildMerkleTreeInline ─────────────────────────────────────────────────

console.log('\n=== C. buildMerkleTreeInline ===');
results.C_buildMerkleTree = {};

for (const [label, files] of [
  ['10 files',  files10],
  ['50 files',  files50],
  ['100 files', files100],
]) {
  const s = runBench(label, () => buildMerkleTreeInline(files));
  results.C_buildMerkleTree[label] = s;
  console.log(
    `  ${label.padEnd(10)}: median=${s.median.toFixed(4)}ms  p95=${s.p95.toFixed(4)}ms  p99=${s.p99.toFixed(4)}ms  ops/sec=${Math.round(s.opsPerSec).toLocaleString()}`
  );
}

// ─── D. diffTrees ─────────────────────────────────────────────────────────────

console.log('\n=== D. diffTrees ===');
results.D_diffTrees = {};

for (const [label, treeB] of [
  ['1 changed',   diff1Tree],
  ['5 changed',   diff5Tree],
  ['100 changed', diff100Tree],
]) {
  const s = runBench(label, () => diffTrees(baseFlatEntries, treeB));
  results.D_diffTrees[label] = s;
  console.log(
    `  ${label.padEnd(13)}: median=${s.median.toFixed(4)}ms  p95=${s.p95.toFixed(4)}ms  p99=${s.p99.toFixed(4)}ms  ops/sec=${Math.round(s.opsPerSec).toLocaleString()}`
  );
}

// ─── E. Deduplication ────────────────────────────────────────────────────────

console.log('\n=== E. Deduplication (100 files, 50 identical) ===');

const dedupTimings = [];
let lastDedup;
for (let i = 0; i < ITERATIONS; i++) {
  const t0 = performance.now();
  lastDedup = buildMerkleTreeInline(dedupFiles);
  dedupTimings.push(performance.now() - t0);
}

const dedupStats = stats(dedupTimings);
const totalBlobs   = dedupFiles.length;
const uniqueBlobs  = lastDedup.blobsToInsert.length;
const reusedBlobs  = totalBlobs - uniqueBlobs;
const dedupRatioPct = ((reusedBlobs / totalBlobs) * 100).toFixed(2);

results.E_deduplication = {
  ...dedupStats,
  totalBlobs,
  uniqueBlobs,
  reusedBlobs,
  dedupRatioPct: parseFloat(dedupRatioPct),
};

console.log(
  `  median=${dedupStats.median.toFixed(4)}ms  p95=${dedupStats.p95.toFixed(4)}ms  p99=${dedupStats.p99.toFixed(4)}ms  ops/sec=${Math.round(dedupStats.opsPerSec).toLocaleString()}`
);
console.log(`  Total file refs: ${totalBlobs}  Unique blobs: ${uniqueBlobs}  Reused: ${reusedBlobs}  Dedup ratio: ${dedupRatioPct}%`);

// ─── F. Storage Comparison ────────────────────────────────────────────────────

console.log('\n=== F. Storage Comparison (full-copy vs deduplicated) ===');
results.F_storageComparison = {};

for (const [label, files] of [
  ['10 files',  storageFiles10],
  ['50 files',  storageFiles50],
  ['100 files', storageFiles100],
]) {
  // Build once to get storage numbers (deterministic), then time repeated builds
  const storageInfo = calcStorageBytes(files);

  // Time the build
  const s = runBench(label, () => buildMerkleTreeInline(files));

  results.F_storageComparison[label] = { ...storageInfo, timing: s };

  console.log(
    `  ${label.padEnd(10)}: fullCopy=${(storageInfo.fullCopyBytes / KB).toFixed(1)}KB  dedup=${(storageInfo.dedupBytes / KB).toFixed(1)}KB  saved=${(storageInfo.savedBytes / KB).toFixed(1)}KB  dedupeRatio=${storageInfo.dedupeRatioPct}%  uniqueBlobs=${storageInfo.uniqueBlobs}`
  );
  console.log(
    `              median=${s.median.toFixed(4)}ms  p95=${s.p95.toFixed(4)}ms  ops/sec=${Math.round(s.opsPerSec).toLocaleString()}`
  );
}

// ─── Write JSON results ───────────────────────────────────────────────────────

const resultsPath = '/Users/amankashyap/Documents/nexusIDE/benchmarks/results/merkle-dag-results.json';
mkdirSync(dirname(resultsPath), { recursive: true });

const output = {
  timestamp: new Date().toISOString(),
  nodeVersion: process.version,
  iterations: ITERATIONS,
  results,
};

writeFileSync(resultsPath, JSON.stringify(output, null, 2));
console.log(`\nResults written to ${resultsPath}`);
