import { performance } from 'perf_hooks';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Direct production imports
import {
  hashUserIdToUint16,
  encodeBitPackedCursor,
  decodeBitPackedCursor,
  encodeCursorBatch,
  decodeCursorBatch,
  CURSOR_FRAME_BYTES,
  CursorPosition
} from '../../backend/src/services/cursorCodec.service.js';

import { Statistics } from '../common/statistics.mjs';
import { Assertions } from '../common/assertions.mjs';
import { BenchmarkLogger } from '../common/logger.mjs';
import { detectEnvironment } from '../common/environment.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  BenchmarkLogger.header('Benchmark 1: Binary Cursor Codec (Production vs JSON)');
  const env = await detectEnvironment();

  // 1. Correctness & Boundary Assertions
  BenchmarkLogger.section('Correctness & Boundary Fuzzing');

  // Round-trip test
  const sampleHash = hashUserIdToUint16('user_alice_42');
  const encSample = encodeBitPackedCursor(sampleHash, 145, 82, 14);
  const decSample = decodeBitPackedCursor(encSample);
  Assertions.assertEqual(decSample.userHash, sampleHash, 'User hash mismatch');
  Assertions.assertEqual(decSample.lineNumber, 145, 'Line number mismatch');
  Assertions.assertEqual(decSample.column, 82, 'Column mismatch');
  Assertions.assertEqual(decSample.selectionLength, 14, 'Selection length mismatch');
  BenchmarkLogger.success('Round-trip coordinate fidelity verified');

  // Boundary clamping (uint16 max 65535)
  const encClamped = encodeBitPackedCursor(sampleHash, 70000, 99999, 100000);
  const decClamped = decodeBitPackedCursor(encClamped);
  Assertions.assertEqual(decClamped.lineNumber, 65535, 'Max line clamping failed');
  Assertions.assertEqual(decClamped.column, 65535, 'Max column clamping failed');
  Assertions.assertEqual(decClamped.selectionLength, 65535, 'Max selection clamping failed');
  BenchmarkLogger.success('Uint16 upper-bound boundary clamping verified (65,535 max)');

  // Truncated/corrupted buffer handling
  const corruptedBuffer = new Uint8Array([1, 2, 3]); // less than 8 bytes
  const decodedCorrupted = decodeCursorBatch(corruptedBuffer);
  Assertions.assertEqual(decodedCorrupted.length, 0, 'Corrupted buffer should produce 0 items');
  BenchmarkLogger.success('Corrupted/truncated binary buffer safety verified');

  // Hash collision check across 10,000 unique IDs
  const userIds = Array.from({ length: 10000 }, (_, i) => `user-enterprise-tenant-${i}-collaborator`);
  const hashes = new Set(userIds.map(id => hashUserIdToUint16(id)));
  const collisionRate = ((userIds.length - hashes.size) / userIds.length) * 100;
  BenchmarkLogger.info(`16-bit Hash space check: 10,000 users -> ${hashes.size} unique buckets (${collisionRate.toFixed(2)}% collision rate, expected for 16-bit space)`);

  // 2. Multi-collaborator Scaling Benchmarks
  const collaboratorTiers = [1, 10, 50, 100, 250, 500];
  const resultsByTier = {};

  for (const count of collaboratorTiers) {
    BenchmarkLogger.section(`Evaluating ${count} Collaborators (10,000 iterations)`);

    // Generate test cursor batch
    const cursors: CursorPosition[] = Array.from({ length: count }, (_, i) => ({
      userHash: (i * 123 + 45) & 0xFFFF,
      lineNumber: (i * 15) % 5000,
      column: (i * 7) % 200,
      selectionLength: i % 4 === 0 ? 12 : 0
    }));

    // Baseline JSON representation
    const jsonEquivalent = cursors.map(c => ({
      userHash: c.userHash,
      lineNumber: c.lineNumber,
      column: c.column,
      selectionLength: c.selectionLength
    }));

    // Measure Payload Sizes
    const binaryBuffer = encodeCursorBatch(cursors);
    const jsonString = JSON.stringify(jsonEquivalent);
    const binaryBytes = binaryBuffer.byteLength;
    const jsonBytes = Buffer.byteLength(jsonString, 'utf8');
    const reductionPct = Number(((1 - (binaryBytes / jsonBytes)) * 100).toFixed(2));

    // Warmup
    for (let w = 0; w < 1000; w++) {
      encodeCursorBatch(cursors);
      decodeCursorBatch(binaryBuffer);
      JSON.stringify(jsonEquivalent);
      JSON.parse(jsonString);
    }

    // Benchmark Binary Encoding
    const binaryEncodeStats = Statistics.measureSync(() => {
      encodeCursorBatch(cursors);
    }, 10000, 100);

    // Benchmark JSON Serialization
    const jsonEncodeStats = Statistics.measureSync(() => {
      JSON.stringify(jsonEquivalent);
    }, 10000, 100);

    // Benchmark Binary Decoding
    const binaryDecodeStats = Statistics.measureSync(() => {
      decodeCursorBatch(binaryBuffer);
    }, 10000, 100);

    // Benchmark JSON Deserialization
    const jsonDecodeStats = Statistics.measureSync(() => {
      JSON.parse(jsonString);
    }, 10000, 100);

    // Heap allocation profiling
    if (global.gc) global.gc();
    const heapBefore = process.memoryUsage().heapUsed;
    for (let i = 0; i < 5000; i++) {
      encodeCursorBatch(cursors);
    }
    const heapAfterBinary = process.memoryUsage().heapUsed;
    for (let i = 0; i < 5000; i++) {
      JSON.stringify(jsonEquivalent);
    }
    const heapAfterJson = process.memoryUsage().heapUsed;

    const encodeSpeedup = Number((binaryEncodeStats.opsPerSec / jsonEncodeStats.opsPerSec).toFixed(2));
    const decodeSpeedup = Number((binaryDecodeStats.opsPerSec / jsonDecodeStats.opsPerSec).toFixed(2));

    resultsByTier[count] = {
      collaboratorCount: count,
      payload: {
        binaryBytes,
        jsonBytes,
        reductionPct
      },
      encoding: {
        binary: binaryEncodeStats,
        json: jsonEncodeStats,
        speedupFactor: encodeSpeedup
      },
      decoding: {
        binary: binaryDecodeStats,
        json: jsonDecodeStats,
        speedupFactor: decodeSpeedup
      },
      heapDeltaApproxBytes: {
        binaryPer5kCalls: Math.max(0, heapAfterBinary - heapBefore),
        jsonPer5kCalls: Math.max(0, heapAfterJson - heapAfterBinary)
      }
    };

    console.log(`  Payload: Binary ${binaryBytes} B vs JSON ${jsonBytes} B (${reductionPct}% reduction)`);
    console.log(`  Encode:  Binary ${binaryEncodeStats.opsPerSec.toLocaleString()} ops/s vs JSON ${jsonEncodeStats.opsPerSec.toLocaleString()} ops/s (${encodeSpeedup}x)`);
    console.log(`  Decode:  Binary ${binaryDecodeStats.opsPerSec.toLocaleString()} ops/s vs JSON ${jsonDecodeStats.opsPerSec.toLocaleString()} ops/s (${decodeSpeedup}x)`);
  }

  // 3. Write structured results
  const outputData = {
    benchmark: 'Binary Cursor Codec',
    timestamp: new Date().toISOString(),
    environment: env,
    evidenceTier: 'Tier B (Production Implementation Microbenchmark)',
    productionSource: 'backend/src/services/cursorCodec.service.ts',
    correctness: {
      roundTripPassed: true,
      boundaryClampingPassed: true,
      corruptedBufferSafetyPassed: true,
      hashSpaceCollisionRatePct: Number(collisionRate.toFixed(2))
    },
    results: resultsByTier
  };

  const resultsDir = path.resolve(__dirname, '..', 'results', 'raw');
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(
    path.join(resultsDir, 'cursor-codec-production.json'),
    JSON.stringify(outputData, null, 2)
  );

  BenchmarkLogger.success(`Results written to ${path.join(resultsDir, 'cursor-codec-production.json')}`);
}

run().catch(err => {
  BenchmarkLogger.error(`Benchmark failed: ${err.message}\n${err.stack}`);
  process.exit(1);
});
