import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import {
  WSSharedDoc,
  BACKPRESSURE_WARN_THRESHOLD,
  BACKPRESSURE_MAX_THRESHOLD,
} from '../../backend/src/services/yjsSyncEngine.service.js';

describe('Phase 2: High-Velocity WebSocket I/O & Network Backpressure Suite', () => {
  // Mock WebSocket helper with configurable bufferedAmount and readyState
  function createMockSocket(overrides: Partial<WebSocket & { bufferedAmount?: number }> = {}): WebSocket {
    const events: Record<string, Function[]> = {};
    let closed = false;

    const mock: any = {
      readyState: WebSocket.OPEN,
      bufferedAmount: 0,
      send: (data: any) => {
        if (closed) throw new Error('WebSocket closed');
      },
      close: (code?: number, reason?: string) => {
        closed = true;
        mock.readyState = WebSocket.CLOSED;
        if (events['close']) {
          events['close'].forEach((fn) => fn(code, reason));
        }
      },
      terminate: () => {
        mock.close();
      },
      on: (event: string, fn: Function) => {
        if (!events[event]) events[event] = [];
        events[event].push(fn);
      },
      ping: () => {},
      ...overrides,
    };

    return mock as WebSocket;
  }

  // ===========================================================================
  // 1. WEBSOCKET BACKPRESSURE PROTECTION (1MB SOFT / 5MB HARD LIMIT)
  // ===========================================================================

  it('WSSharedDoc.send allows normal frames when socket buffer is under 1MB threshold', () => {
    const doc = new WSSharedDoc('test-ws-doc', 'ws-123', 'file-456');
    let sentMessage: Uint8Array | null = null;
    const socket = createMockSocket({
      bufferedAmount: 500 * 1024, // 500 KB (well under 1MB)
      send: (msg: any) => {
        sentMessage = msg;
      },
    });

    const testPayload = new Uint8Array([1, 2, 3, 4]);
    doc.send(socket, testPayload, true); // awareness frame

    expect(sentMessage).not.toBeNull();
    expect(sentMessage).toEqual(testPayload);
    expect(socket.readyState).toBe(WebSocket.OPEN);
  });

  it('WSSharedDoc.send drops awareness frames when socket buffer exceeds 1MB soft limit', () => {
    const doc = new WSSharedDoc('test-ws-doc-soft', 'ws-123', 'file-456');
    let sentMessage: Uint8Array | null = null;
    const socket = createMockSocket({
      bufferedAmount: BACKPRESSURE_WARN_THRESHOLD + 1024, // 1 MB + 1 KB
      send: (msg: any) => {
        sentMessage = msg;
      },
    });

    const awarenessPayload = new Uint8Array([1, 0, 0, 1]);
    doc.send(socket, awarenessPayload, true); // isAwareness = true

    // Non-essential awareness update dropped due to backpressure
    expect(sentMessage).toBeNull();
    expect(socket.readyState).toBe(WebSocket.OPEN);
  });

  it('WSSharedDoc.send allows critical document sync frames even under 1MB buffer pressure', () => {
    const doc = new WSSharedDoc('test-ws-doc-sync', 'ws-123', 'file-456');
    let sentMessage: Uint8Array | null = null;
    const socket = createMockSocket({
      bufferedAmount: BACKPRESSURE_WARN_THRESHOLD + 1024, // 1 MB + 1 KB
      send: (msg: any) => {
        sentMessage = msg;
      },
    });

    const syncPayload = new Uint8Array([0, 1, 2, 3]);
    doc.send(socket, syncPayload, false); // isAwareness = false (critical sync update)

    // Critical sync update delivered despite soft buffer warning
    expect(sentMessage).not.toBeNull();
    expect(sentMessage).toEqual(syncPayload);
  });

  it('WSSharedDoc.send closes choked connection when buffer exceeds 5MB hard limit', () => {
    const doc = new WSSharedDoc('test-ws-doc-hard', 'ws-123', 'file-456');
    let closedCode: number | null = null;
    const socket = createMockSocket({
      bufferedAmount: BACKPRESSURE_MAX_THRESHOLD + 1024, // 5 MB + 1 KB
      close: (code?: number) => {
        closedCode = code || null;
        (socket as any).readyState = WebSocket.CLOSED;
      },
    });

    const anyPayload = new Uint8Array([0, 9, 9]);
    doc.send(socket, anyPayload, false);

    // Socket closed due to hard limit breach to protect server RAM
    expect(closedCode).toBe(1008);
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  });

  // ===========================================================================
  // 2. MICRO-TICK AWARENESS FRAME COALESCING (16MS TICK BATCHING)
  // ===========================================================================

  it('Coalesces multiple rapid cursor updates within 16ms into a single batch broadcast', async () => {
    const doc = new WSSharedDoc('test-batch-doc', 'ws-789', 'file-999');
    const sentFrames: Uint8Array[] = [];

    const mockConn = createMockSocket({
      send: (msg: any) => {
        sentFrames.push(msg);
      },
    });

    doc.conns.set(mockConn, new Set([101, 102, 103]));

    // Simulate 5 rapid cursor awareness update triggers in quick succession
    doc.awareness.setLocalState({ user: { id: 'u1', name: 'Alice', color: '#ff0000' }, cursor: { line: 1, ch: 5 } });
    doc.awareness.setLocalState({ user: { id: 'u1', name: 'Alice', color: '#ff0000' }, cursor: { line: 1, ch: 10 } });
    doc.awareness.setLocalState({ user: { id: 'u1', name: 'Alice', color: '#ff0000' }, cursor: { line: 2, ch: 0 } });

    // Instantly, 0 frames sent because they are coalescing on micro-tick
    expect(sentFrames.length).toBe(0);

    // Wait 25ms for 16ms tick frame flush
    await new Promise((resolve) => setTimeout(resolve, 25));

    // Coalesced into exactly 1 batch broadcast frame
    expect(sentFrames.length).toBe(1);
  });
});
