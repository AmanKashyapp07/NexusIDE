import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TerminalStreamBuffer } from '../../backend/src/terminal/terminalStreamBuffer.js';

describe('TerminalStreamBuffer & Micro-Batching Engine', () => {
   let mockWs: any;

   beforeEach(() => {
      vi.useFakeTimers();
      mockWs = {
         readyState: 1, // WebSocket.OPEN
         bufferedAmount: 0,
         send: vi.fn(),
      };
   });

   afterEach(() => {
      vi.useRealTimers();
   });

   it('coalesces micro-chunks into a single batch within the maxBatchMs window', () => {
      const buffer = new TerminalStreamBuffer(mockWs, { maxBatchMs: 10, maxBatchBytes: 16384 });

      buffer.push(Buffer.from('Hello '));
      buffer.push(Buffer.from('World!'));

      // Before timer fires, send has not been called yet
      expect(mockWs.send).not.toHaveBeenCalled();

      // Fast-forward 10ms
      vi.advanceTimersByTime(10);

      expect(mockWs.send).toHaveBeenCalledTimes(1);
      expect(mockWs.send.mock.calls[0][0].toString()).toBe('Hello World!');
   });

   it('flushes immediately when accumulated bytes reach maxBatchBytes threshold', () => {
      const buffer = new TerminalStreamBuffer(mockWs, { maxBatchMs: 10, maxBatchBytes: 10 });

      buffer.push(Buffer.from('012345'));
      expect(mockWs.send).not.toHaveBeenCalled();

      // Push 5 more bytes (total 11 >= 10 bytes) -> triggers immediate flush
      buffer.push(Buffer.from('67890'));

      expect(mockWs.send).toHaveBeenCalledTimes(1);
      expect(mockWs.send.mock.calls[0][0].toString()).toBe('01234567890');
   });

   it('respects socket backpressure when bufferedAmount exceeds maxBufferedAmount threshold', () => {
      mockWs.bufferedAmount = 100000; // > 64KB threshold
      const buffer = new TerminalStreamBuffer(mockWs, { maxBatchMs: 10, maxBufferedAmount: 64000 });

      buffer.push(Buffer.from('High velocity burst payload'));
      vi.advanceTimersByTime(10);

      // Backpressure prevents immediate send
      expect(mockWs.send).not.toHaveBeenCalled();

      // Simulate socket drain
      mockWs.bufferedAmount = 0;
      vi.advanceTimersByTime(20);

      expect(mockWs.send).toHaveBeenCalledTimes(1);
      expect(mockWs.send.mock.calls[0][0].toString()).toBe('High velocity burst payload');
   });

   it('clears internal buffer cleanly on socket disconnect', () => {
      const buffer = new TerminalStreamBuffer(mockWs, { maxBatchMs: 10 });

      buffer.push(Buffer.from('Pending data'));
      buffer.clear();

      vi.advanceTimersByTime(20);

      expect(mockWs.send).not.toHaveBeenCalled();
   });
});
