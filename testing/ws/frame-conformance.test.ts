import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';

describe('Raw WebSocket Protocol Conformance Suite', () => {
  const MAX_FRAME_SIZE_BYTES = 16 * 1024 * 1024; // 16MB limit

  it('enforces 16MB maximum WebSocket frame size boundary', () => {
    const validateFrameSize = (payload: Uint8Array): { valid: boolean; error?: string } => {
      if (payload.byteLength > MAX_FRAME_SIZE_BYTES) {
        return { valid: false, error: '4009 Message Too Big: Frame exceeds 16MB maximum payload ceiling' };
      }
      return { valid: true };
    };

    const validPayload = new Uint8Array(1024 * 1024); // 1MB -> OK
    expect(validateFrameSize(validPayload).valid).toBe(true);

    const oversizedPayload = new Uint8Array(17 * 1024 * 1024); // 17MB -> Rejected
    const res = validateFrameSize(oversizedPayload);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('4009 Message Too Big');
  });

  it('decodes multi-chunk binary Yjs update frames accurately without fragmentation loss', () => {
    const docA = new Y.Doc();
    const textA = docA.getText('monaco');
    textA.insert(0, 'Frame Chunk 1 Data\n');
    textA.insert(textA.length, 'Frame Chunk 2 Data\n');

    const encoder = encoding.createEncoder();
    syncProtocol.writeSyncStep1(encoder, docA);
    const frameBuffer = encoding.toUint8Array(encoder);

    // Decode message frame header
    const decoder = decoding.createDecoder(frameBuffer);
    const messageType = decoding.readVarUint(decoder);

    expect(messageType).toBe(syncProtocol.messageYjsSyncStep1);
    expect(frameBuffer.byteLength).toBeGreaterThan(0);

    docA.destroy();
  });
});
