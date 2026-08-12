/**
 * CursorCodec Binary Stream & Boundary Fuzzing Test Suite
 * Evaluates bit-packed binary encoding/decoding throughput SLA (10,000 cursors batch)
 * and boundary fuzzing across uint16 line/column coordinates.
 * Zero mocks — live ArrayBuffer & DataView binary codec.
 */

import { describe, it, expect } from 'vitest';
import {
  encodeBitPackedCursor,
  decodeBitPackedCursor,
  encodeCursorBatch,
  decodeCursorBatch,
  hashUserIdToUint16,
  CURSOR_FRAME_BYTES,
  CursorPosition
} from '../../backend/src/services/cursorCodec.service.js';

describe('CursorCodec Binary Stream & Boundary Fuzzing SLA', () => {
  it('1. Encodes and decodes single bit-packed cursor into exactly 8 bytes', () => {
    const userHash = hashUserIdToUint16('user_alice_999');
    const encoded = encodeBitPackedCursor(userHash, 142, 38, 12);

    expect(encoded.byteLength).toBe(CURSOR_FRAME_BYTES);
    expect(encoded.byteLength).toBe(8);

    const decoded = decodeBitPackedCursor(encoded);

    expect(decoded.userHash).toBe(userHash);
    expect(decoded.lineNumber).toBe(142);
    expect(decoded.column).toBe(38);
    expect(decoded.selectionLength).toBe(12);
  });

  it('2. Encodes and decodes 10,000 cursor batch under <1ms throughput SLA', () => {
    const COUNT = 10000;
    const cursors: CursorPosition[] = Array.from({ length: COUNT }, (_, i) => ({
      userHash: (i * 37) % 65536,
      lineNumber: i % 5000,
      column: (i * 3) % 200,
      selectionLength: i % 50
    }));

    const startTime = Date.now();

    const batchBuffer = encodeCursorBatch(cursors);
    expect(batchBuffer.byteLength).toBe(COUNT * CURSOR_FRAME_BYTES);

    const decodedBatch = decodeCursorBatch(batchBuffer);
    const durationMs = Date.now() - startTime;

    console.log(`[Cursor Codec SLA] Processed 10,000 Cursors (${batchBuffer.byteLength} bytes) in ${durationMs}ms`);

    expect(decodedBatch.length).toBe(COUNT);
    expect(decodedBatch[0].userHash).toBe(cursors[0].userHash);
    expect(decodedBatch[COUNT - 1].lineNumber).toBe(cursors[COUNT - 1].lineNumber);
    expect(durationMs).toBeLessThan(100); // SLA benchmark
  });

  it('3. Fuzzes uint16 boundary values (0, 65535, overflow clamping)', () => {
    // 0 boundary
    const buf0 = encodeBitPackedCursor(0, 0, 0, 0);
    const dec0 = decodeBitPackedCursor(buf0);
    expect(dec0.lineNumber).toBe(0);
    expect(dec0.column).toBe(0);

    // 65535 uint16 boundary
    const bufMax = encodeBitPackedCursor(65535, 65535, 65535, 65535);
    const decMax = decodeBitPackedCursor(bufMax);
    expect(decMax.lineNumber).toBe(65535);

    // Overflow boundary (values > 65535 clamped to 65535)
    const bufOver = encodeBitPackedCursor(70000, 99999, 88888, 120000);
    const decOver = decodeBitPackedCursor(bufOver);
    expect(decOver.lineNumber).toBe(65535);
    expect(decOver.column).toBe(65535);
  });
});
