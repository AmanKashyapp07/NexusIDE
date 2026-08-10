/**
 * Purpose: High-Throughput Terminal Stream Buffer & Adaptive Backpressure Coordinator.
 * High-Level Architecture: Coalesces rapid micro-chunks emitted by Docker PTY streams into batched 10ms/16KB WebSocket frames.
 * Reduces socket frame overhead by up to 90% and prevents main-thread browser freezing during high-velocity terminal output.
 */

import type { WebSocket } from 'ws';
import { WebSocket as WS } from 'ws';

export interface StreamBufferOptions {
   maxBatchMs?: number;
   maxBatchBytes?: number;
   maxBufferedAmount?: number;
}

export class TerminalStreamBuffer {
   private ws: WebSocket;
   private maxBatchMs: number;
   private maxBatchBytes: number;
   private maxBufferedAmount: number;
   private chunks: Buffer[] = [];
   private currentBytes = 0;
   private flushTimer: NodeJS.Timeout | null = null;
   private isFlushing = false;

   constructor(ws: WebSocket, options: StreamBufferOptions = {}) {
      this.ws = ws;
      this.maxBatchMs = options.maxBatchMs ?? 10; // 10ms micro-coalescing window
      this.maxBatchBytes = options.maxBatchBytes ?? 16384; // 16KB max batch threshold
      this.maxBufferedAmount = options.maxBufferedAmount ?? 64 * 1024; // 64KB backpressure threshold
   }

   /**
    * Push a raw chunk from Docker PTY stream.
    */
   push(chunk: Buffer): void {
      if (this.ws.readyState !== WS.OPEN) return;

      this.chunks.push(chunk);
      this.currentBytes += chunk.length;

      // Immediate flush if max batch threshold reached or maxBatchMs is 0
      if (this.currentBytes >= this.maxBatchBytes || this.maxBatchMs === 0) {
         if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
         }
         this.flush();
         return;
      }

      // Schedule debounced flush timer if not already pending
      if (!this.flushTimer) {
         this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            this.flush();
         }, this.maxBatchMs);
      }
   }

   /**
    * Flushes accumulated chunks over WebSocket.
    */
   flush(): void {
      if (this.isFlushing || this.chunks.length === 0) return;
      if (this.ws.readyState !== WS.OPEN) {
         this.clear();
         return;
      }

      // Respect socket backpressure
      if (this.ws.bufferedAmount > this.maxBufferedAmount) {
         // Reschedule flush once socket drains
         if (!this.flushTimer) {
            this.flushTimer = setTimeout(() => {
               this.flushTimer = null;
               this.flush();
            }, this.maxBatchMs * 2);
         }
         return;
      }

      this.isFlushing = true;
      try {
         const combined = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks, this.currentBytes);
         this.chunks = [];
         this.currentBytes = 0;

         if (this.ws.readyState === WS.OPEN && combined && combined.length > 0) {
            this.ws.send(combined);
         }
      } finally {
         this.isFlushing = false;
      }
   }

   /**
    * Clears all pending timers and buffers on teardown.
    */
   clear(): void {
      if (this.flushTimer) {
         clearTimeout(this.flushTimer);
         this.flushTimer = null;
      }
      this.chunks = [];
      this.currentBytes = 0;
   }
}
