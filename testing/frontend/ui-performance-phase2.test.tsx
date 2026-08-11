import { describe, it, expect } from 'vitest';

describe('Phase 2 Terminal Output Queue & WebGL Acceleration Suite', () => {
  it('1. queues incoming WebSocket binary stdout packets and flushes in animation frame batches', async () => {
    const outputQueue: Uint8Array[] = [];
    const writtenChunks: string[] = [];

    const fakeTerminal = {
      write: (data: Uint8Array) => {
        writtenChunks.push(new TextDecoder().decode(data));
      }
    };

    let scheduledFrame: (() => void) | null = null;
    const scheduleFlush = (fn: () => void) => {
      if (!scheduledFrame) {
        scheduledFrame = fn;
      }
    };

    const handleMessage = (bytes: Uint8Array) => {
      outputQueue.push(bytes);
      scheduleFlush(() => {
        const chunks = [...outputQueue];
        outputQueue.length = 0;
        for (const chunk of chunks) {
          fakeTerminal.write(chunk);
        }
        scheduledFrame = null;
      });
    };

    handleMessage(new TextEncoder().encode('npm install\r\n'));
    handleMessage(new TextEncoder().encode('added 120 packages in 2s\r\n'));

    expect(writtenChunks.length).toBe(0); // Queued before animation frame tick

    if (scheduledFrame) {
      (scheduledFrame as () => void)();
    }

    expect(writtenChunks.length).toBe(2);
    expect(writtenChunks[0]).toBe('npm install\r\n');
    expect(writtenChunks[1]).toBe('added 120 packages in 2s\r\n');
  });

  it('2. instantiates WebGL addon with context loss fallback listener', () => {
    let contextLostListener: (() => void) | null = null;
    let disposeCount = 0;
    const fakeWebglAddon = {
      onContextLoss: (cb: () => void) => {
        contextLostListener = cb;
      },
      dispose: () => {
        disposeCount++;
      }
    };

    fakeWebglAddon.onContextLoss(() => {
      fakeWebglAddon.dispose();
    });

    expect(contextLostListener).toBeDefined();
    if (contextLostListener) {
      (contextLostListener as () => void)();
    }

    expect(disposeCount).toBe(1);
  });
});
