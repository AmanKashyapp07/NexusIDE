import { describe, it, expect } from 'vitest';
import {
   hashUserIdToUint16,
   encodeBitPackedCursor,
   decodeBitPackedCursor,
   encodeCursorBatch,
   decodeCursorBatch,
   CURSOR_FRAME_BYTES
} from '../../backend/src/services/cursorCodec.service.js';

describe('Bit-Packed Binary Cursor Codec (Networking Bandwidth Optimization)', () => {
   it('hashes string user IDs into deterministic 16-bit integers', () => {
      const hash1 = hashUserIdToUint16('user-alice-1234');
      const hash2 = hashUserIdToUint16('user-alice-1234');
      const hashBob = hashUserIdToUint16('user-bob-5678');

      expect(hash1).toBe(hash2);
      expect(hash1).toBeGreaterThanOrEqual(0);
      expect(hash1).toBeLessThanOrEqual(65535);
      expect(hash1).not.toBe(hashBob);
   });

   it('encodes cursor position into exactly 8 bytes and decodes bit-for-bit', () => {
      const userHash = hashUserIdToUint16('user-charlie-99');
      const line = 142;
      const col = 18;
      const selection = 25;

      const encoded = encodeBitPackedCursor(userHash, line, col, selection);
      expect(encoded.byteLength).toBe(CURSOR_FRAME_BYTES);
      expect(encoded.byteLength).toBe(8);

      const decoded = decodeBitPackedCursor(encoded);
      expect(decoded.userHash).toBe(userHash);
      expect(decoded.lineNumber).toBe(142);
      expect(decoded.column).toBe(18);
      expect(decoded.selectionLength).toBe(25);
   });

   it('packs multiple collaborator cursors into a contiguous binary batch frame', () => {
      const cursors = [
         { userHash: 101, lineNumber: 12, column: 4, selectionLength: 0 },
         { userHash: 202, lineNumber: 85, column: 30, selectionLength: 15 },
         { userHash: 303, lineNumber: 400, column: 1, selectionLength: 50 },
         { userHash: 404, lineNumber: 1024, column: 80, selectionLength: 0 },
      ];

      const batchBuffer = encodeCursorBatch(cursors);
      expect(batchBuffer.byteLength).toBe(4 * 8); // exactly 32 bytes

      const decodedBatch = decodeCursorBatch(batchBuffer);
      expect(decodedBatch).toHaveLength(4);
      expect(decodedBatch[0]).toEqual({ userHash: 101, lineNumber: 12, column: 4, selectionLength: 0 });
      expect(decodedBatch[1]).toEqual({ userHash: 202, lineNumber: 85, column: 30, selectionLength: 15 });
      expect(decodedBatch[2]).toEqual({ userHash: 303, lineNumber: 400, column: 1, selectionLength: 50 });
      expect(decodedBatch[3]).toEqual({ userHash: 404, lineNumber: 1024, column: 80, selectionLength: 0 });
   });

   it('handles boundary coordinates and clamps to uint16 limits', () => {
      const encoded = encodeBitPackedCursor(99999, 70000, 80000, 90000);
      const decoded = decodeBitPackedCursor(encoded);

      expect(decoded.lineNumber).toBe(65535);
      expect(decoded.column).toBe(65535);
      expect(decoded.selectionLength).toBe(65535);
   });
});
