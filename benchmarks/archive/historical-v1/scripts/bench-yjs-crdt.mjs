/**
 * bench-yjs-crdt.mjs
 * Benchmarks the Yjs CRDT synchronization engine for NexusIDE.
 * Simulates WSSharedDoc usage patterns (gc:false, Y.applyUpdate, Y.encodeStateAsUpdate).
 */

import * as Y from '/Users/amankashyap/Documents/nexusIDE/backend/node_modules/yjs/dist/yjs.mjs';
import { writeFileSync, mkdirSync } from 'fs';
import { performance } from 'perf_hooks';

const RESULTS_PATH = '/Users/amankashyap/Documents/nexusIDE/benchmarks/results/yjs-crdt-results.json';
const YJS_PATH = '/Users/amankashyap/Documents/nexusIDE/backend/node_modules/yjs/dist/yjs.mjs';

const results = {};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stats(timings) {
  const sorted = [...timings].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const variance = sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return {
    min: sorted[0],
    max: sorted[n - 1],
    mean,
    median: sorted[Math.floor(n / 2)],
    p95: sorted[Math.floor(n * 0.95)],
    p99: sorted[Math.floor(n * 0.99)],
    stddev: Math.sqrt(variance),
    n,
  };
}

function formatMs(ms) {
  return ms.toFixed(4) + ' ms';
}

function banner(title) {
  const line = '─'.repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(line);
}

// ─── Scenario A: Local edit throughput ───────────────────────────────────────

banner('A. Local Edit Throughput (keystroke simulation, gc:false)');

const A_SIZES = [100, 1000, 10000];
results.A_localEditThroughput = {};

for (const N of A_SIZES) {
  const ITERS = N <= 1000 ? 20 : 5;
  const insertionTimings = [];
  const updateSizes = [];

  for (let iter = 0; iter < ITERS; iter++) {
    const doc = new Y.Doc({ gc: false });
    const text = doc.getText('content');

    // Capture sizes of incremental updates
    const iterSizes = [];
    doc.on('update', (update) => {
      iterSizes.push(update.byteLength);
    });

    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      text.insert(text.length, String.fromCharCode(65 + (i % 26)));
    }
    const elapsed = performance.now() - t0;

    insertionTimings.push(elapsed);
    if (iter === 0) updateSizes.push(...iterSizes);
  }

  const totalMs = stats(insertionTimings);
  const opsPerSec = Math.round((N * 1000) / totalMs.median);
  const avgUpdateBytes = updateSizes.length
    ? updateSizes.reduce((a, b) => a + b, 0) / updateSizes.length
    : 0;

  results.A_localEditThroughput[`N=${N}`] = {
    insertions: N,
    iterations: ITERS,
    totalMs: totalMs,
    insertionsPerSec: opsPerSec,
    avgUpdateBytesPerKeystroke: parseFloat(avgUpdateBytes.toFixed(2)),
    sampleUpdateSizes: updateSizes.slice(0, 5),
  };

  console.log(`  N=${N}: ${opsPerSec.toLocaleString()} insertions/sec | median total ${formatMs(totalMs.median)} | avg update ${avgUpdateBytes.toFixed(1)} bytes/keystroke`);
}

// ─── Scenario B: State vector sync (reconnect simulation) ────────────────────

banner('B. State Vector Sync — Reconnect Simulation');

const B_SIZES = [100, 1000, 10000];
results.B_stateVectorSync = {};

for (const N of B_SIZES) {
  const ITERS = N <= 1000 ? 50 : 10;

  const encodeTimings = [];
  const applyTimings = [];
  let encodedSize = 0;

  for (let iter = 0; iter < ITERS; iter++) {
    // Doc A: N edits
    const docA = new Y.Doc({ gc: false });
    const textA = docA.getText('content');
    for (let i = 0; i < N; i++) textA.insert(textA.length, 'A');

    // Doc B: N/2 divergent edits
    const docB = new Y.Doc({ gc: false });
    const textB = docB.getText('content');
    for (let i = 0; i < Math.floor(N / 2); i++) textB.insert(textB.length, 'B');

    // Encode A's state as update
    const t0 = performance.now();
    const updateA = Y.encodeStateAsUpdate(docA);
    encodeTimings.push(performance.now() - t0);
    encodedSize = updateA.byteLength;

    // Apply A's update to B
    const t1 = performance.now();
    Y.applyUpdate(docB, updateA);
    applyTimings.push(performance.now() - t1);
  }

  const encStats = stats(encodeTimings);
  const appStats = stats(applyTimings);

  results.B_stateVectorSync[`N=${N}`] = {
    docAEdits: N,
    docBEdits: Math.floor(N / 2),
    iterations: ITERS,
    encodeMs: encStats,
    applyMs: appStats,
    encodedUpdateBytes: encodedSize,
  };

  console.log(`  N=${N}: encode ${formatMs(encStats.median)} | apply ${formatMs(appStats.median)} | update size ${encodedSize.toLocaleString()} bytes`);
}

// ─── Scenario C: Concurrent edit convergence ─────────────────────────────────

banner('C. Concurrent Edit Convergence (N clients, 100 edits each)');

const C_CLIENTS = [2, 5, 10];
const C_EDITS_PER_CLIENT = 100;
results.C_concurrentConvergence = {};

for (const nClients of C_CLIENTS) {
  const ITERS = 20;
  const convergenceTimings = [];
  let totalBytesExchanged = 0;
  let verified = false;

  for (let iter = 0; iter < ITERS; iter++) {
    // Create independent docs, each makes 100 edits
    const docs = Array.from({ length: nClients }, () => {
      const doc = new Y.Doc({ gc: false });
      const text = doc.getText('content');
      for (let i = 0; i < C_EDITS_PER_CLIENT; i++) {
        text.insert(text.length, String.fromCharCode(65 + (i % 26)));
      }
      return doc;
    });

    const t0 = performance.now();

    // Each doc broadcasts its full state to all peers
    // This simulates: client reconnects and exchanges state vectors
    let bytes = 0;
    const updates = docs.map((doc) => {
      const u = Y.encodeStateAsUpdate(doc);
      bytes += u.byteLength;
      return u;
    });

    // Apply all updates to all peers (merge)
    for (let i = 0; i < nClients; i++) {
      for (let j = 0; j < nClients; j++) {
        if (i !== j) {
          Y.applyUpdate(docs[i], updates[j]);
        }
      }
    }

    const elapsed = performance.now() - t0;
    convergenceTimings.push(elapsed);
    if (iter === 0) {
      totalBytesExchanged = bytes;
      // Verify all docs identical by comparing update lengths
      const sizes = docs.map((d) => Y.encodeStateAsUpdate(d).byteLength);
      verified = sizes.every((s) => s === sizes[0]);
    }
  }

  const convStats = stats(convergenceTimings);

  results.C_concurrentConvergence[`clients=${nClients}`] = {
    nClients,
    editsPerClient: C_EDITS_PER_CLIENT,
    iterations: ITERS,
    convergenceMs: convStats,
    totalUpdateBytesExchanged: totalBytesExchanged,
    allDocsIdentical: verified,
  };

  console.log(`  clients=${nClients}: converge ${formatMs(convStats.median)} | ${totalBytesExchanged.toLocaleString()} bytes exchanged | identical=${verified}`);
}

// ─── Scenario D: Update binary size vs document size ─────────────────────────

banner('D. Update Binary Size vs Document Size');

const D_SIZES = [100, 1000, 10000];
results.D_binarySizeVsDocSize = {};

for (const N of D_SIZES) {
  const doc = new Y.Doc({ gc: false });
  const text = doc.getText('content');

  // Build with batched inserts (realistic)
  for (let i = 0; i < N; i++) {
    text.insert(text.length, String.fromCharCode(65 + (i % 26)));
  }

  const rawTextBytes = Buffer.from(text.toString(), 'utf8').byteLength;
  const updateBytes = Y.encodeStateAsUpdate(doc).byteLength;
  const overhead = ((updateBytes / rawTextBytes - 1) * 100).toFixed(1);

  results.D_binarySizeVsDocSize[`N=${N}`] = {
    docChars: N,
    rawTextBytes,
    yEncodeStateBytes: updateBytes,
    overheadPercent: parseFloat(overhead),
    bytesPerChar: parseFloat((updateBytes / N).toFixed(2)),
  };

  console.log(`  N=${N}: raw=${rawTextBytes}B  encoded=${updateBytes}B  overhead=${overhead}%  (${(updateBytes / N).toFixed(2)} bytes/char)`);
}

// ─── Scenario E: gc:false overhead ───────────────────────────────────────────

banner('E. gc:false Overhead (tombstone inflation)');

const E_N = 1000;
const E_DELETE_RATIO = 0.5;

// Build a 1000-char doc with gc:false and delete 50% of content
const docGcFalse = new Y.Doc({ gc: false });
const textGcFalse = docGcFalse.getText('content');
for (let i = 0; i < E_N; i++) textGcFalse.insert(textGcFalse.length, String.fromCharCode(65 + (i % 26)));
const deleteCount = Math.floor(E_N * E_DELETE_RATIO);
// Delete from the middle to create tombstones throughout
textGcFalse.delete(Math.floor(E_N / 4), deleteCount);

// Fresh doc with same final content (no tombstones, gc:true)
const docFresh = new Y.Doc({ gc: true });
const textFresh = docFresh.getText('content');
textFresh.insert(0, textGcFalse.toString());

const gcFalseSize = Y.encodeStateAsUpdate(docGcFalse).byteLength;
const freshSize = Y.encodeStateAsUpdate(docFresh).byteLength;
const tombstoneInflation = ((gcFalseSize / freshSize - 1) * 100).toFixed(1);
const finalChars = textGcFalse.length;

results.E_gcFalseOverhead = {
  initialChars: E_N,
  deletedChars: deleteCount,
  finalChars,
  gcFalseEncodedBytes: gcFalseSize,
  freshDocEncodedBytes: freshSize,
  tombstoneInflationPercent: parseFloat(tombstoneInflation),
  gcFalseBytesPerChar: parseFloat((gcFalseSize / finalChars).toFixed(2)),
  freshBytesPerChar: parseFloat((freshSize / finalChars).toFixed(2)),
};

console.log(`  gc:false (with tombstones): ${gcFalseSize}B`);
console.log(`  fresh doc (same content, gc:true): ${freshSize}B`);
console.log(`  tombstone inflation: +${tombstoneInflation}%`);
console.log(`  final chars: ${finalChars} (deleted ${deleteCount} of ${E_N})`);

// ─── Summary ─────────────────────────────────────────────────────────────────

banner('Summary');

console.log('\n  A. Local Edit Throughput:');
for (const [k, v] of Object.entries(results.A_localEditThroughput)) {
  console.log(`     ${k}: ${v.insertionsPerSec.toLocaleString()} ins/sec, ${v.avgUpdateBytesPerKeystroke} bytes/update`);
}

console.log('\n  B. State Vector Sync (encode + apply):');
for (const [k, v] of Object.entries(results.B_stateVectorSync)) {
  console.log(`     ${k}: encode ${v.encodeMs.median.toFixed(3)}ms, apply ${v.applyMs.median.toFixed(3)}ms, ${v.encodedUpdateBytes}B`);
}

console.log('\n  C. Convergence:');
for (const [k, v] of Object.entries(results.C_concurrentConvergence)) {
  console.log(`     ${k}: ${v.convergenceMs.median.toFixed(3)}ms, ${v.totalUpdateBytesExchanged}B, identical=${v.allDocsIdentical}`);
}

console.log('\n  D. Binary Size Overhead:');
for (const [k, v] of Object.entries(results.D_binarySizeVsDocSize)) {
  console.log(`     ${k}: ${v.yEncodeStateBytes}B encoded vs ${v.rawTextBytes}B raw (+${v.overheadPercent}%)`);
}

console.log(`\n  E. gc:false tombstone inflation: ${results.E_gcFalseOverhead.tombstoneInflationPercent}% larger than equivalent fresh doc`);

// ─── Write JSON results ───────────────────────────────────────────────────────

const output = {
  metadata: {
    timestamp: new Date().toISOString(),
    yjsPath: YJS_PATH,
    nodeVersion: process.version,
    description: 'Yjs CRDT benchmark for NexusIDE WSSharedDoc (gc:false)',
  },
  results,
};

mkdirSync('/Users/amankashyap/Documents/nexusIDE/benchmarks/results', { recursive: true });
writeFileSync(RESULTS_PATH, JSON.stringify(output, null, 2));
console.log(`\n✓ Results written to ${RESULTS_PATH}`);
