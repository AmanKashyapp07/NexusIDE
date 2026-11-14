/**
 * Benchmark: Binary Cursor Codec vs JSON baseline
 * Source: /Users/amankashyap/Documents/nexusIDE/backend/src/services/cursorCodec.service.ts
 *
 * Run: /usr/local/bin/node bench-cursor-codec.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

// ─── Inline codec (copied verbatim from cursorCodec.service.ts, TS types stripped) ───

const CURSOR_FRAME_BYTES = 8;

function hashUserIdToUint16(userId) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) & 0xFFFF;
  }
  return hash;
}

function encodeBitPackedCursor(userHash, lineNumber, column, selectionLength = 0) {
  const buffer = new Uint8Array(CURSOR_FRAME_BYTES);
  const view = new DataView(buffer.buffer, buffer.byteOffset, CURSOR_FRAME_BYTES);
  view.setUint16(0, userHash & 0xFFFF, false);
  view.setUint16(2, Math.min(65535, Math.max(0, lineNumber)), false);
  view.setUint16(4, Math.min(65535, Math.max(0, column)), false);
  view.setUint16(6, Math.min(65535, Math.max(0, selectionLength)), false);
  return buffer;
}

function decodeBitPackedCursor(buffer) {
  const view = new DataView(
    buffer instanceof ArrayBuffer ? buffer : buffer.buffer,
    buffer instanceof ArrayBuffer ? 0 : buffer.byteOffset,
    CURSOR_FRAME_BYTES
  );
  return {
    userHash: view.getUint16(0, false),
    lineNumber: view.getUint16(2, false),
    column: view.getUint16(4, false),
    selectionLength: view.getUint16(6, false),
  };
}

function encodeCursorBatch(cursors) {
  const totalBytes = cursors.length * CURSOR_FRAME_BYTES;
  const buffer = new Uint8Array(totalBytes);
  const view = new DataView(buffer.buffer, buffer.byteOffset, totalBytes);
  for (let i = 0; i < cursors.length; i++) {
    const offset = i * CURSOR_FRAME_BYTES;
    const c = cursors[i];
    view.setUint16(offset,     c.userHash & 0xFFFF, false);
    view.setUint16(offset + 2, Math.min(65535, Math.max(0, c.lineNumber)), false);
    view.setUint16(offset + 4, Math.min(65535, Math.max(0, c.column)), false);
    view.setUint16(offset + 6, Math.min(65535, Math.max(0, c.selectionLength || 0)), false);
  }
  return buffer;
}

function decodeCursorBatch(buffer) {
  const byteLength = buffer.byteLength;
  const count = Math.floor(byteLength / CURSOR_FRAME_BYTES);
  const view = new DataView(
    buffer instanceof ArrayBuffer ? buffer : buffer.buffer,
    buffer instanceof ArrayBuffer ? 0 : buffer.byteOffset,
    byteLength
  );
  const cursors = [];
  for (let i = 0; i < count; i++) {
    const offset = i * CURSOR_FRAME_BYTES;
    cursors.push({
      userHash:        view.getUint16(offset,     false),
      lineNumber:      view.getUint16(offset + 2, false),
      column:          view.getUint16(offset + 4, false),
      selectionLength: view.getUint16(offset + 6, false),
    });
  }
  return cursors;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stats(timings) {
  const sorted = [...timings].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((s, v) => s + v, 0);
  const mean = sum / n;
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);
  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)];
  const p95 = sorted[Math.floor(n * 0.95)];
  const p99 = sorted[Math.floor(n * 0.99)];
  const min = sorted[0];
  const max = sorted[n - 1];
  const totalMs = sum;
  const opsPerSec = Math.round((n / totalMs) * 1000);
  return { min, max, median, p95, p99, stddev, mean, opsPerSec, totalMs, n };
}

function formatStats(s) {
  return [
    `  ops/sec  : ${s.opsPerSec.toLocaleString()}`,
    `  min      : ${s.min.toFixed(6)} ms`,
    `  max      : ${s.max.toFixed(6)} ms`,
    `  median   : ${s.median.toFixed(6)} ms`,
    `  p95      : ${s.p95.toFixed(6)} ms`,
    `  p99      : ${s.p99.toFixed(6)} ms`,
    `  stddev   : ${s.stddev.toFixed(6)} ms`,
    `  total    : ${s.totalMs.toFixed(3)} ms (${s.n} iters)`,
  ].join('\n');
}

// ─── Fixture generators ───────────────────────────────────────────────────────

function makeCursors(count) {
  const cursors = [];
  for (let i = 0; i < count; i++) {
    const userId = `user-${i}-abcdefgh`;
    cursors.push({
      userHash:        hashUserIdToUint16(userId),
      lineNumber:      (i * 37 + 100) % 65535,
      column:          (i * 13 + 5)   % 65535,
      selectionLength: (i * 7)        % 65535,
    });
  }
  return cursors;
}

// ─── Benchmark runner ─────────────────────────────────────────────────────────

const ITERS = 10_000;
const COLLABORATOR_COUNTS = [1, 10, 50, 100];

const allResults = {
  meta: {
    iterations: ITERS,
    collaboratorCounts: COLLABORATOR_COUNTS,
    nodeVersion: process.version,
    timestamp: new Date().toISOString(),
  },
  byCount: {},
};

console.log('═'.repeat(70));
console.log('  NexusIDE Binary Cursor Codec Benchmark');
console.log(`  Node ${process.version}  |  ${ITERS.toLocaleString()} iterations per test`);
console.log('═'.repeat(70));

for (const count of COLLABORATOR_COUNTS) {
  const cursors = makeCursors(count);
  // Single cursor used for single-encode/decode tests
  const { userHash, lineNumber, column, selectionLength } = cursors[0];

  // ── payload sizes ──────────────────────────────────────────────────────────
  const binaryPayload   = encodeCursorBatch(cursors);
  const binaryBytes     = binaryPayload.byteLength;

  const jsonPayload     = JSON.stringify(cursors.map(c => ({
    userHash: c.userHash, lineNumber: c.lineNumber, column: c.column, selectionLength: c.selectionLength,
  })));
  const jsonBytes       = Buffer.byteLength(jsonPayload, 'utf8');
  const reduction       = ((1 - binaryBytes / jsonBytes) * 100).toFixed(2);

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`  Collaborators: ${count}`);
  console.log(`  Binary payload : ${binaryBytes} bytes`);
  console.log(`  JSON payload   : ${jsonBytes} bytes`);
  console.log(`  Size reduction : ${reduction}%`);

  const countResults = {
    collaborators: count,
    payloadBytes:  { binary: binaryBytes, json: jsonBytes, reductionPct: parseFloat(reduction) },
    benchmarks: {},
  };

  // ─── 1. encodeBitPackedCursor (single) ─────────────────────────────────────
  {
    const timings = [];
    for (let iter = 0; iter < ITERS; iter++) {
      const t0 = performance.now();
      encodeBitPackedCursor(userHash, lineNumber, column, selectionLength);
      timings.push(performance.now() - t0);
    }
    const s = stats(timings);
    console.log(`\n  [binary] encodeBitPackedCursor (single cursor)`);
    console.log(formatStats(s));
    countResults.benchmarks.encodeSingle = s;
  }

  // ─── 2. decodeBitPackedCursor (single) ─────────────────────────────────────
  {
    const encoded = encodeBitPackedCursor(userHash, lineNumber, column, selectionLength);
    const timings = [];
    for (let iter = 0; iter < ITERS; iter++) {
      const t0 = performance.now();
      decodeBitPackedCursor(encoded);
      timings.push(performance.now() - t0);
    }
    const s = stats(timings);
    console.log(`\n  [binary] decodeBitPackedCursor (single cursor)`);
    console.log(formatStats(s));
    countResults.benchmarks.decodeSingle = s;
  }

  // ─── 3. encodeCursorBatch ──────────────────────────────────────────────────
  {
    const timings = [];
    for (let iter = 0; iter < ITERS; iter++) {
      const t0 = performance.now();
      encodeCursorBatch(cursors);
      timings.push(performance.now() - t0);
    }
    const s = stats(timings);
    console.log(`\n  [binary] encodeCursorBatch (${count} cursors)`);
    console.log(formatStats(s));
    countResults.benchmarks.encodeBatch = s;
  }

  // ─── 4. decodeCursorBatch ──────────────────────────────────────────────────
  {
    const encoded = encodeCursorBatch(cursors);
    const timings = [];
    for (let iter = 0; iter < ITERS; iter++) {
      const t0 = performance.now();
      decodeCursorBatch(encoded);
      timings.push(performance.now() - t0);
    }
    const s = stats(timings);
    console.log(`\n  [binary] decodeCursorBatch (${count} cursors)`);
    console.log(formatStats(s));
    countResults.benchmarks.decodeBatch = s;
  }

  // ─── 5. JSON.stringify baseline ────────────────────────────────────────────
  {
    const data = cursors.map(c => ({
      userHash: c.userHash, lineNumber: c.lineNumber, column: c.column, selectionLength: c.selectionLength,
    }));
    const timings = [];
    for (let iter = 0; iter < ITERS; iter++) {
      const t0 = performance.now();
      JSON.stringify(data);
      timings.push(performance.now() - t0);
    }
    const s = stats(timings);
    console.log(`\n  [json]   JSON.stringify (${count} cursors)`);
    console.log(formatStats(s));
    countResults.benchmarks.jsonStringify = s;
  }

  // ─── 6. JSON.parse baseline ────────────────────────────────────────────────
  {
    const data = cursors.map(c => ({
      userHash: c.userHash, lineNumber: c.lineNumber, column: c.column, selectionLength: c.selectionLength,
    }));
    const serialized = JSON.stringify(data);
    const timings = [];
    for (let iter = 0; iter < ITERS; iter++) {
      const t0 = performance.now();
      JSON.parse(serialized);
      timings.push(performance.now() - t0);
    }
    const s = stats(timings);
    console.log(`\n  [json]   JSON.parse (${count} cursors)`);
    console.log(formatStats(s));
    countResults.benchmarks.jsonParse = s;
  }

  // ─── 7. hashUserIdToUint16 ─────────────────────────────────────────────────
  {
    const userId = `user-0-abcdefgh`;
    const timings = [];
    for (let iter = 0; iter < ITERS; iter++) {
      const t0 = performance.now();
      hashUserIdToUint16(userId);
      timings.push(performance.now() - t0);
    }
    const s = stats(timings);
    // Only show for first count to avoid clutter; always record
    if (count === COLLABORATOR_COUNTS[0]) {
      console.log(`\n  [binary] hashUserIdToUint16`);
      console.log(formatStats(s));
    }
    countResults.benchmarks.hashUserIdToUint16 = s;
  }

  // ─── Summary speedup ───────────────────────────────────────────────────────
  const encSpeedup = (countResults.benchmarks.jsonStringify.opsPerSec /
                      countResults.benchmarks.encodeBatch.opsPerSec).toFixed(2);
  const decSpeedup = (countResults.benchmarks.jsonParse.opsPerSec /
                      countResults.benchmarks.decodeBatch.opsPerSec).toFixed(2);
  console.log(`\n  ── Summary (${count} collaborators) ──`);
  console.log(`  Encode: Binary ${encSpeedup > 1 ? encSpeedup + 'x slower' : (1/encSpeedup).toFixed(2) + 'x faster'} than JSON.stringify`);
  console.log(`  Decode: Binary ${decSpeedup > 1 ? decSpeedup + 'x slower' : (1/decSpeedup).toFixed(2) + 'x faster'} than JSON.parse`);
  console.log(`  Payload: ${reduction}% smaller than JSON`);

  countResults.summary = {
    encodeSpeedupVsJSON: parseFloat(encSpeedup),
    decodeSpeedupVsJSON: parseFloat(decSpeedup),
  };

  allResults.byCount[count] = countResults;
}

console.log(`\n${'═'.repeat(70)}`);
console.log('  Benchmark complete.');
console.log('═'.repeat(70));

// ─── Write JSON results ───────────────────────────────────────────────────────
const OUTPUT_PATH = '/Users/amankashyap/Documents/nexusIDE/benchmarks/results/cursor-codec-results.json';
mkdirSync('/Users/amankashyap/Documents/nexusIDE/benchmarks/results', { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(allResults, null, 2));
console.log(`\nResults written to: ${OUTPUT_PATH}`);
