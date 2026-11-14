import { performance } from 'perf_hooks';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Direct production imports (Experimental 8-byte implementation)
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

// =============================================================================
// CONCRETE COLLISION-FREE IMPLEMENTATIONS FOR IDENTITY PRESERVATION
// =============================================================================

// Solution 1: Room-Scoped Ephemeral Identity Mapping Table
export class RoomIdentityTable {
  private userToClientIndex = new Map<string, number>();
  private clientIndexToUser = new Map<number, string>();
  private nextIndex = 0;

  getOrAssign(userId: string): number {
    let idx = this.userToClientIndex.get(userId);
    if (idx === undefined) {
      idx = this.nextIndex++;
      this.userToClientIndex.set(userId, idx);
      this.clientIndexToUser.set(idx, userId);
    }
    return idx;
  }

  resolve(clientIndex: number): string | undefined {
    return this.clientIndexToUser.get(clientIndex);
  }

  get size(): number {
    return this.userToClientIndex.size;
  }
}

// Solution 2: Wider 12-Byte uint32 Identifier Codec Implementation
export interface CursorPosition12 {
  userId: number; // Full 32-bit integer (0 to 4,294,967,295)
  lineNumber: number;
  column: number;
  selectionLength: number;
  flags?: number;
}

export const CURSOR_12_FRAME_BYTES = 12;

export function encodeBitPackedCursor12(
  userId: number,
  lineNumber: number,
  column: number,
  selectionLength = 0,
  flags = 0
): Uint8Array {
  const buffer = new ArrayBuffer(CURSOR_12_FRAME_BYTES);
  const view = new DataView(buffer);
  view.setUint32(0, userId >>> 0, true);
  view.setUint16(4, Math.min(65535, Math.max(0, lineNumber)), true);
  view.setUint16(6, Math.min(65535, Math.max(0, column)), true);
  view.setUint16(8, Math.min(65535, Math.max(0, selectionLength)), true);
  view.setUint16(10, Math.min(65535, Math.max(0, flags)), true);
  return new Uint8Array(buffer);
}

export function decodeBitPackedCursor12(buffer: Uint8Array): CursorPosition12 {
  if (buffer.byteLength < CURSOR_12_FRAME_BYTES) {
    throw new Error('Buffer too small for 12-byte cursor frame');
  }
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return {
    userId: view.getUint32(0, true),
    lineNumber: view.getUint16(4, true),
    column: view.getUint16(6, true),
    selectionLength: view.getUint16(8, true),
    flags: view.getUint16(10, true)
  };
}

export function encodeCursorBatch12(cursors: CursorPosition12[]): Uint8Array {
  const out = new Uint8Array(cursors.length * CURSOR_12_FRAME_BYTES);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  for (let i = 0; i < cursors.length; i++) {
    const offset = i * CURSOR_12_FRAME_BYTES;
    const c = cursors[i];
    view.setUint32(offset + 0, c.userId >>> 0, true);
    view.setUint16(offset + 4, Math.min(65535, Math.max(0, c.lineNumber)), true);
    view.setUint16(offset + 6, Math.min(65535, Math.max(0, c.column)), true);
    view.setUint16(offset + 8, Math.min(65535, Math.max(0, c.selectionLength)), true);
    view.setUint16(offset + 10, Math.min(65535, Math.max(0, c.flags || 0)), true);
  }
  return out;
}

export function decodeCursorBatch12(buffer: Uint8Array): CursorPosition12[] {
  const count = Math.floor(buffer.byteLength / CURSOR_12_FRAME_BYTES);
  const result: CursorPosition12[] = [];
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  for (let i = 0; i < count; i++) {
    const offset = i * CURSOR_12_FRAME_BYTES;
    result.push({
      userId: view.getUint32(offset + 0, true),
      lineNumber: view.getUint16(offset + 4, true),
      column: view.getUint16(offset + 6, true),
      selectionLength: view.getUint16(offset + 8, true),
      flags: view.getUint16(offset + 10, true)
    });
  }
  return result;
}

async function run() {
  BenchmarkLogger.header('Benchmark 1: Binary Cursor Codec (Experimental 8-Byte vs 12-Byte vs JSON)');
  const env = await detectEnvironment();

  // =========================================================================
  // 1. Correctness & Boundary Assertions for 8-Byte Codec
  // =========================================================================
  BenchmarkLogger.section('1. Experimental 8-Byte Codec Correctness & Boundary Fuzzing');

  // Round-trip test
  const sampleHash = hashUserIdToUint16('user_alice_42');
  const encSample = encodeBitPackedCursor(sampleHash, 145, 82, 14);
  const decSample = decodeBitPackedCursor(encSample);
  Assertions.assertEqual(decSample.userHash, sampleHash, 'User hash mismatch');
  Assertions.assertEqual(decSample.lineNumber, 145, 'Line number mismatch');
  Assertions.assertEqual(decSample.column, 82, 'Column mismatch');
  Assertions.assertEqual(decSample.selectionLength, 14, 'Selection length mismatch');
  BenchmarkLogger.success('8-Byte round-trip coordinate fidelity verified');

  // Boundary clamping (uint16 max 65535)
  const encClamped = encodeBitPackedCursor(sampleHash, 70000, 99999, 100000);
  const decClamped = decodeBitPackedCursor(encClamped);
  Assertions.assertEqual(decClamped.lineNumber, 65535, 'Max line clamping failed');
  Assertions.assertEqual(decClamped.column, 65535, 'Max column clamping failed');
  Assertions.assertEqual(decClamped.selectionLength, 65535, 'Max selection clamping failed');
  BenchmarkLogger.success('8-Byte uint16 upper-bound boundary clamping verified (65,535 max)');

  // Truncated/corrupted buffer handling
  const corruptedBuffer = new Uint8Array([1, 2, 3]);
  const decodedCorrupted = decodeCursorBatch(corruptedBuffer);
  Assertions.assertEqual(decodedCorrupted.length, 0, 'Corrupted buffer should produce 0 items');
  BenchmarkLogger.success('8-Byte corrupted/truncated binary buffer safety verified');

  // Hash collision check across 10,000 unique IDs
  const userIds = Array.from({ length: 10000 }, (_, i) => `user-enterprise-tenant-${i}-collaborator`);
  const hashes16 = new Set(userIds.map(id => hashUserIdToUint16(id)));
  const collisionRate10k = ((userIds.length - hashes16.size) / userIds.length) * 100;
  
  // Mathematical collision probability in collaboration rooms (Birthday Paradox)
  const roomCollisionProb = (n: number) => {
    let probNoCollision = 1;
    for (let i = 0; i < n; i++) {
      probNoCollision *= (65536 - i) / 65536;
    }
    return Number(((1 - probNoCollision) * 100).toFixed(3));
  };

  const roomCollisions = {
    room10CollabsPct: roomCollisionProb(10),
    room50CollabsPct: roomCollisionProb(50),
    room100CollabsPct: roomCollisionProb(100),
    global10kUsersPct: Number(collisionRate10k.toFixed(2))
  };

  // =========================================================================
  // 2. Concrete Collision-Free Implementations Verification
  // =========================================================================
  BenchmarkLogger.section('2. Verification of Collision-Free Identity Solutions');

  // A. Room-Scoped Ephemeral Table Verification
  const roomTable = new RoomIdentityTable();
  const roomUsers = Array.from({ length: 100 }, (_, i) => `user-room-participant-${i}`);
  const assignedIndices = new Set<number>();
  for (const u of roomUsers) {
    const idx = roomTable.getOrAssign(u);
    assignedIndices.add(idx);
    Assertions.assertEqual(roomTable.resolve(idx), u, 'Room identity table reverse lookup mismatch');
  }
  Assertions.assertEqual(assignedIndices.size, 100, 'Room identity table must have 100 unique indices');
  BenchmarkLogger.success('RoomIdentityTable: 100 room users mapped to 100 unique indices (0.00% collision by construction)');

  // B. 12-Byte uint32 Codec Verification
  const sample32UserId = 3735928559; // 0xDEADBEEF
  const enc12 = encodeBitPackedCursor12(sample32UserId, 240, 15, 30, 1);
  const dec12 = decodeBitPackedCursor12(enc12);
  Assertions.assertEqual(dec12.userId, sample32UserId, '12-Byte userId mismatch');
  Assertions.assertEqual(dec12.lineNumber, 240, '12-Byte line mismatch');
  Assertions.assertEqual(dec12.column, 15, '12-Byte column mismatch');
  Assertions.assertEqual(dec12.selectionLength, 30, '12-Byte selection mismatch');
  Assertions.assertEqual(dec12.flags, 1, '12-Byte flags mismatch');

  const enc12Clamped = encodeBitPackedCursor12(sample32UserId, 80000, 90000, 100000);
  const dec12Clamped = decodeBitPackedCursor12(enc12Clamped);
  Assertions.assertEqual(dec12Clamped.lineNumber, 65535, '12-Byte line clamping failed');
  Assertions.assertEqual(dec12Clamped.column, 65535, '12-Byte column clamping failed');
  Assertions.assertEqual(dec12Clamped.selectionLength, 65535, '12-Byte selection clamping failed');

  const corrupted12 = new Uint8Array([1, 2, 3, 4, 5]);
  const decCorrupted12 = decodeCursorBatch12(corrupted12);
  Assertions.assertEqual(decCorrupted12.length, 0, '12-Byte corrupted batch must return 0 elements');
  BenchmarkLogger.success('12-Byte Codec: Round-trip fidelity, uint16 clamping, and corruption safety verified');

  // =========================================================================
  // 3. Multi-Collaborator Scaling Benchmarks (8-Byte vs 12-Byte vs JSON)
  // =========================================================================
  const collaboratorTiers = [1, 10, 50, 100, 250, 500];
  const resultsByTier: any = {};

  for (const count of collaboratorTiers) {
    BenchmarkLogger.section(`Evaluating ${count} Collaborators (10,000 iterations)`);

    // 8-Byte cursor batch
    const cursors8: CursorPosition[] = Array.from({ length: count }, (_, i) => ({
      userHash: (i * 123 + 45) & 0xFFFF,
      lineNumber: (i * 15) % 5000,
      column: (i * 7) % 200,
      selectionLength: i % 4 === 0 ? 12 : 0
    }));

    // 12-Byte cursor batch
    const cursors12: CursorPosition12[] = Array.from({ length: count }, (_, i) => ({
      userId: (i * 1234567 + 890) >>> 0,
      lineNumber: (i * 15) % 5000,
      column: (i * 7) % 200,
      selectionLength: i % 4 === 0 ? 12 : 0,
      flags: 0
    }));

    // JSON equivalent
    const jsonEquivalent = cursors8.map(c => ({
      userHash: c.userHash,
      lineNumber: c.lineNumber,
      column: c.column,
      selectionLength: c.selectionLength
    }));

    // Payload sizes
    const binary8Buffer = encodeCursorBatch(cursors8);
    const binary12Buffer = encodeCursorBatch12(cursors12);
    const jsonString = JSON.stringify(jsonEquivalent);
    const binary8Bytes = binary8Buffer.byteLength;
    const binary12Bytes = binary12Buffer.byteLength;
    const jsonBytes = Buffer.byteLength(jsonString, 'utf8');

    const reduction8Pct = Number(((1 - (binary8Bytes / jsonBytes)) * 100).toFixed(2));
    const reduction12Pct = Number(((1 - (binary12Bytes / jsonBytes)) * 100).toFixed(2));

    // Measure 8-byte encoding
    const binary8EncodeStats = Statistics.measureSync(() => {
      encodeCursorBatch(cursors8);
    }, 10000, 1000);

    // Measure 12-byte encoding
    const binary12EncodeStats = Statistics.measureSync(() => {
      encodeCursorBatch12(cursors12);
    }, 10000, 1000);

    // Measure JSON stringify
    const jsonEncodeStats = Statistics.measureSync(() => {
      JSON.stringify(jsonEquivalent);
    }, 10000, 1000);

    // Measure 8-byte decoding
    const binary8DecodeStats = Statistics.measureSync(() => {
      decodeCursorBatch(binary8Buffer);
    }, 10000, 1000);

    // Measure 12-byte decoding
    const binary12DecodeStats = Statistics.measureSync(() => {
      decodeCursorBatch12(binary12Buffer);
    }, 10000, 1000);

    // Measure JSON parse
    const jsonDecodeStats = Statistics.measureSync(() => {
      JSON.parse(jsonString);
    }, 10000, 1000);

    const encodeSpeedup8 = Number((binary8EncodeStats.opsPerSec / jsonEncodeStats.opsPerSec).toFixed(2));
    const decodeSpeedup8 = Number((binary8DecodeStats.opsPerSec / jsonDecodeStats.opsPerSec).toFixed(2));
    const encodeSpeedup12 = Number((binary12EncodeStats.opsPerSec / jsonEncodeStats.opsPerSec).toFixed(2));
    const decodeSpeedup12 = Number((binary12DecodeStats.opsPerSec / jsonDecodeStats.opsPerSec).toFixed(2));

    resultsByTier[count] = {
      collaboratorCount: count,
      payload: {
        binary8Bytes,
        binary12Bytes,
        jsonBytes,
        reduction8Pct,
        reduction12Pct
      },
      encoding: {
        binary8: binary8EncodeStats,
        binary12: binary12EncodeStats,
        json: jsonEncodeStats,
        speedup8Factor: encodeSpeedup8,
        speedup12Factor: encodeSpeedup12
      },
      decoding: {
        binary8: binary8DecodeStats,
        binary12: binary12DecodeStats,
        json: jsonDecodeStats,
        speedup8Factor: decodeSpeedup8,
        speedup12Factor: decodeSpeedup12
      }
    };

    console.log(`  Payload: 8-Byte ${binary8Bytes} B (${reduction8Pct}% drop) | 12-Byte ${binary12Bytes} B (${reduction12Pct}% drop) | JSON ${jsonBytes} B`);
    console.log(`  Decode:  8-Byte ${binary8DecodeStats.opsPerSec.toLocaleString()} ops/s (${decodeSpeedup8}x) | 12-Byte ${binary12DecodeStats.opsPerSec.toLocaleString()} ops/s (${decodeSpeedup12}x) | JSON ${jsonDecodeStats.opsPerSec.toLocaleString()} ops/s`);
  }

  // Save results
  const outputData = {
    benchmark: 'Binary Cursor Codec (Experimental 8-Byte vs Collision-Free 12-Byte vs JSON)',
    timestamp: new Date().toISOString(),
    environment: env,
    evidenceTier: 'Tier B (Component Microbenchmark)',
    productionSource: 'backend/src/services/cursorCodec.service.ts',
    statusNote: 'The 8-byte codec in backend/src/services/cursorCodec.service.ts is an experimental component microbenchmark; it is NOT integrated into the live websocketServer awareness channel.',
    correctness: {
      roundTrip8BytePassed: true,
      boundaryClamping8BytePassed: true,
      corruptedBufferSafety8BytePassed: true,
      roomIdentityTablePassed: true,
      roundTrip12BytePassed: true,
      boundaryClamping12BytePassed: true,
      corruptedBufferSafety12BytePassed: true,
      hashSpaceCollisionAnalysis: roomCollisions
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
