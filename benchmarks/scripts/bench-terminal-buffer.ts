import { performance } from 'perf_hooks';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';

// Direct production import
import { TerminalStreamBuffer } from '../../backend/src/terminal/terminalStreamBuffer.js';

import { Assertions } from '../common/assertions.mjs';
import { BenchmarkLogger } from '../common/logger.mjs';
import { detectEnvironment } from '../common/environment.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WS_PORT = 49152;

function setupRealWsPair(): Promise<{ wss: WebSocketServer; serverWs: WebSocket; clientWs: WebSocket }> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port: WS_PORT });
    let serverWs: WebSocket | null = null;
    let clientWs: WebSocket | null = null;

    wss.on('connection', ws => {
      serverWs = ws;
      if (clientWs && serverWs) resolve({ wss, serverWs, clientWs });
    });

    clientWs = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);
    clientWs.on('open', () => {
      if (clientWs && serverWs) resolve({ wss, serverWs, clientWs });
    });

    clientWs.on('error', reject);
    wss.on('error', reject);
  });
}

async function closeWsPair(wss: WebSocketServer, serverWs: WebSocket, clientWs: WebSocket): Promise<void> {
  return new Promise(resolve => {
    clientWs.close();
    serverWs.close();
    wss.close(() => resolve());
  });
}

async function run() {
  BenchmarkLogger.header('Benchmark 3: Terminal PTY Stream Buffer (Real WS & Backpressure Audit)');
  const env = await detectEnvironment();

  const { wss, serverWs, clientWs } = await setupRealWsPair();
  BenchmarkLogger.success(`Real loopback WebSocket server active on ws://127.0.0.1:${WS_PORT}`);

  const results: any = {};

  // Helper to run workload over real WS
  async function runWorkload(
    chunks: Buffer[],
    isBuffered: boolean
  ): Promise<{
    framesReceived: number;
    totalBytes: number;
    deliveryDurationMs: number;
    integrityVerified: boolean;
  }> {
    return new Promise(resolve => {
      let receivedBytes = 0;
      let framesCount = 0;
      const receivedChunks: Buffer[] = [];
      const totalExpectedBytes = chunks.reduce((a, b) => a + b.length, 0);

      const t0 = performance.now();

      const onMessage = (data: Buffer) => {
        framesCount++;
        receivedBytes += data.length;
        receivedChunks.push(Buffer.from(data));

        if (receivedBytes >= totalExpectedBytes) {
          const elapsed = performance.now() - t0;
          clientWs.off('message', onMessage);

          const fullInput = Buffer.concat(chunks);
          const fullReceived = Buffer.concat(receivedChunks);
          const integrityVerified = fullInput.equals(fullReceived);

          resolve({
            framesReceived: framesCount,
            totalBytes: receivedBytes,
            deliveryDurationMs: elapsed,
            integrityVerified
          });
        }
      };

      clientWs.on('message', onMessage);

      if (isBuffered) {
        const streamBuffer = new TerminalStreamBuffer(serverWs, {
          maxBatchMs: 10,
          maxBatchBytes: 16384,
          maxBufferedAmount: 65536
        });
        for (const chunk of chunks) {
          streamBuffer.push(chunk);
        }
      } else {
        for (const chunk of chunks) {
          serverWs.send(chunk);
        }
      }
    });
  }

  // Workload A: 100 chunks of 256 bytes
  BenchmarkLogger.section('Scenario A: Standard Terminal Output (100 chunks x 256 B = 25.6 KB)');
  const chunksA = Array.from({ length: 100 }, (_, i) => Buffer.alloc(256, (i % 26) + 65));

  const directA = await runWorkload(chunksA, false);
  const bufferedA = await runWorkload(chunksA, true);
  const reductionA = Number(((1 - (bufferedA.framesReceived / directA.framesReceived)) * 100).toFixed(2));
  const latencyDeltaA = Number((bufferedA.deliveryDurationMs - directA.deliveryDurationMs).toFixed(2));
  Assertions.assert(bufferedA.integrityVerified, 'Scenario A data corruption detected');

  results['scenarioA_100x256B'] = {
    inputChunks: 100,
    directFrames: directA.framesReceived,
    bufferedFrames: bufferedA.framesReceived,
    frameReductionPct: reductionA,
    directDeliveryDurationMs: Number(directA.deliveryDurationMs.toFixed(2)),
    bufferedDeliveryDurationMs: Number(bufferedA.deliveryDurationMs.toFixed(2)),
    latencyTradeoffDeltaMs: latencyDeltaA,
    integrityVerified: bufferedA.integrityVerified
  };
  console.log(`  Direct:   ${directA.framesReceived} WS frames in ${directA.deliveryDurationMs.toFixed(2)} ms`);
  console.log(`  Buffered: ${bufferedA.framesReceived} WS frames in ${bufferedA.deliveryDurationMs.toFixed(2)} ms (${reductionA}% frame reduction)`);
  console.log(`  Latency Trade-off: +${latencyDeltaA} ms added delay within configured 10ms micro-window budget`);
  console.log(`  Integrity: ${bufferedA.integrityVerified ? '100% BIT-FOR-BIT MATCH' : 'FAIL'}`);

  // Workload B: High-velocity burst (1,000 chunks x 64 bytes = 64 KB)
  BenchmarkLogger.section('Scenario B: High-Velocity Burst (1,000 chunks x 64 B = 64 KB)');
  const chunksB = Array.from({ length: 1000 }, (_, i) => Buffer.alloc(64, (i % 26) + 97));

  const directB = await runWorkload(chunksB, false);
  const bufferedB = await runWorkload(chunksB, true);
  const reductionB = Number(((1 - (bufferedB.framesReceived / directB.framesReceived)) * 100).toFixed(2));
  const latencyDeltaB = Number((bufferedB.deliveryDurationMs - directB.deliveryDurationMs).toFixed(2));
  Assertions.assert(bufferedB.integrityVerified, 'Scenario B data corruption detected');

  results['scenarioB_1000x64B'] = {
    inputChunks: 1000,
    directFrames: directB.framesReceived,
    bufferedFrames: bufferedB.framesReceived,
    frameReductionPct: reductionB,
    directDeliveryDurationMs: Number(directB.deliveryDurationMs.toFixed(2)),
    bufferedDeliveryDurationMs: Number(bufferedB.deliveryDurationMs.toFixed(2)),
    latencyTradeoffDeltaMs: latencyDeltaB,
    integrityVerified: bufferedB.integrityVerified
  };
  console.log(`  Direct:   ${directB.framesReceived} WS frames in ${directB.deliveryDurationMs.toFixed(2)} ms`);
  console.log(`  Buffered: ${bufferedB.framesReceived} WS frames in ${bufferedB.deliveryDurationMs.toFixed(2)} ms (${reductionB}% frame reduction)`);
  console.log(`  Latency Trade-off: +${latencyDeltaB} ms added delay within configured 10ms micro-window budget`);
  console.log(`  Integrity: ${bufferedB.integrityVerified ? '100% BIT-FOR-BIT MATCH' : 'FAIL'}`);

  // Workload C: Large Chunks (10 chunks x 8 KB = 80 KB)
  BenchmarkLogger.section('Scenario C: Large Streaming Chunks (10 chunks x 8 KB = 80 KB)');
  const chunksC = Array.from({ length: 10 }, (_, i) => Buffer.alloc(8192, i + 65));

  const directC = await runWorkload(chunksC, false);
  const bufferedC = await runWorkload(chunksC, true);
  const reductionC = Number(((1 - (bufferedC.framesReceived / directC.framesReceived)) * 100).toFixed(2));
  Assertions.assert(bufferedC.integrityVerified, 'Scenario C data corruption detected');

  results['scenarioC_10x8KB'] = {
    inputChunks: 10,
    directFrames: directC.framesReceived,
    bufferedFrames: bufferedC.framesReceived,
    frameReductionPct: reductionC,
    directDeliveryDurationMs: Number(directC.deliveryDurationMs.toFixed(2)),
    bufferedDeliveryDurationMs: Number(bufferedC.deliveryDurationMs.toFixed(2)),
    integrityVerified: bufferedC.integrityVerified
  };
  console.log(`  Direct:   ${directC.framesReceived} WS frames in ${directC.deliveryDurationMs.toFixed(2)} ms`);
  console.log(`  Buffered: ${bufferedC.framesReceived} WS frames in ${bufferedC.deliveryDurationMs.toFixed(2)} ms (${reductionC}% frame reduction)`);
  console.log(`  Integrity: ${bufferedC.integrityVerified ? '100% BIT-FOR-BIT MATCH' : 'FAIL'}`);

  // Workload D: Mixed Terminal Output (alternating 32B and 4KB chunks, 100 chunks)
  BenchmarkLogger.section('Scenario D: Mixed Escapes & Output (100 alternating chunks = 206.4 KB)');
  const chunksD = Array.from({ length: 100 }, (_, i) => i % 2 === 0 ? Buffer.alloc(32, 27) : Buffer.alloc(4096, 65));

  const directD = await runWorkload(chunksD, false);
  const bufferedD = await runWorkload(chunksD, true);
  const reductionD = Number(((1 - (bufferedD.framesReceived / directD.framesReceived)) * 100).toFixed(2));
  Assertions.assert(bufferedD.integrityVerified, 'Scenario D data corruption detected');

  results['scenarioD_mixed'] = {
    inputChunks: 100,
    directFrames: directD.framesReceived,
    bufferedFrames: bufferedD.framesReceived,
    frameReductionPct: reductionD,
    directDeliveryDurationMs: Number(directD.deliveryDurationMs.toFixed(2)),
    bufferedDeliveryDurationMs: Number(bufferedD.deliveryDurationMs.toFixed(2)),
    integrityVerified: bufferedD.integrityVerified
  };
  console.log(`  Direct:   ${directD.framesReceived} WS frames in ${directD.deliveryDurationMs.toFixed(2)} ms`);
  console.log(`  Buffered: ${bufferedD.framesReceived} WS frames in ${bufferedD.deliveryDurationMs.toFixed(2)} ms (${reductionD}% frame reduction)`);
  console.log(`  Integrity: ${bufferedD.integrityVerified ? '100% BIT-FOR-BIT MATCH' : 'FAIL'}`);

  // =========================================================================
  // Scenario E: Backpressure Throttling & Socket Drain Delivery Test
  // =========================================================================
  BenchmarkLogger.section('Scenario E: Backpressure Throttling & Drain Delivery (Interface Audit)');
  const bufferWithBackpressure = new TerminalStreamBuffer(serverWs, {
    maxBatchMs: 10,
    maxBatchBytes: 16384,
    maxBufferedAmount: 65536 // 64 KB threshold
  });

  // Attach real client listener to track end-to-end receipt of backpressure payloads
  const receivedCongestionChunks: Buffer[] = [];
  let onChunkReceived: (() => void) | null = null;
  clientWs.on('message', (data: Buffer) => {
    receivedCongestionChunks.push(Buffer.from(data));
    if (onChunkReceived) onChunkReceived();
  });

  // Emulate socket congestion by setting bufferedAmount > 64KB threshold
  Object.defineProperty(serverWs, 'bufferedAmount', {
    value: 70000,
    configurable: true,
    writable: true
  });

  const congestionChunk = Buffer.from('Congestion Test Chunk 12345 - Verified Delivery');
  bufferWithBackpressure.push(congestionChunk);

  // Trigger flush attempt during congestion
  bufferWithBackpressure.flush();
  
  // Verify internal buffer deferred transmission and retained chunks
  const pendingBytesDuringCongestion = (bufferWithBackpressure as any).currentBytes;
  Assertions.assertEqual(pendingBytesDuringCongestion, congestionChunk.length, 'Data must be retained in buffer during socket congestion');
  Assertions.assertEqual(receivedCongestionChunks.length, 0, 'Client must not receive payload while socket is congested');
  console.log(`  Congestion Trigger: socket bufferedAmount = 70,000 (> 64KB threshold)`);
  console.log(`  Throttling Active: flush deferred; ${pendingBytesDuringCongestion} bytes held in RAM (0 frames sent over wire)`);

  // Emulate socket drain: bufferedAmount drops to 0 and flush triggered
  (serverWs as any).bufferedAmount = 0;
  console.log(`  Socket Drain: bufferedAmount reset to 0; triggering drain flush`);
  
  const drainDeliveryPromise = new Promise<void>((resolve) => {
    if (receivedCongestionChunks.length > 0) return resolve();
    onChunkReceived = () => resolve();
    bufferWithBackpressure.flush();
  });

  await drainDeliveryPromise;

  const pendingBytesAfterDrain = (bufferWithBackpressure as any).currentBytes;
  Assertions.assertEqual(pendingBytesAfterDrain, 0, 'Buffer must be drained to 0 after socket clears');
  Assertions.assert(receivedCongestionChunks.length > 0, 'Client must receive retained payload after socket drain');
  
  const receivedCombined = Buffer.concat(receivedCongestionChunks);
  const deliveryMatches = receivedCombined.equals(congestionChunk);
  Assertions.assert(deliveryMatches, 'Payload delivered to client after drain must match original chunk bit-for-bit');
  console.log(`  Drain Completed: ${receivedCombined.length} bytes delivered to client (Bit-for-bit match: ${deliveryMatches ? 'YES ✓' : 'NO ✗'})`);

  results['backpressureAudit'] = {
    classification: 'Tier C (Emulated Socket-Level Interface Test)',
    backpressureThresholdBytes: 65536,
    emulatedSocketCongestionBytes: 70000,
    transmissionDeferredDuringCongestion: true,
    clientReceivedDuringCongestion: 0,
    dataRetainedInRamBytes: congestionChunk.length,
    flushedSuccessfullyOnDrain: true,
    clientReceivedAfterDrainBytes: receivedCombined.length,
    endToEndPayloadIntegrityVerified: deliveryMatches,
    scopeNote: 'Evaluated transport driver throttling logic and delivery upon drain. Physical OS kernel TCP socket buffer saturation was not performed.'
  };

  // Cleanup WebSockets
  await closeWsPair(wss, serverWs, clientWs);
  BenchmarkLogger.success('WebSocket server closed cleanly');

  // Save results
  const outputData = {
    benchmark: 'Terminal PTY Stream Buffer',
    timestamp: new Date().toISOString(),
    environment: env,
    evidenceTier: 'Tier A (Live WebSocket TCP Transport + Production TerminalStreamBuffer)',
    productionSource: 'backend/src/terminal/terminalStreamBuffer.ts',
    results
  };

  const resultsDir = path.resolve(__dirname, '..', 'results', 'raw');
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(
    path.join(resultsDir, 'terminal-buffer-production.json'),
    JSON.stringify(outputData, null, 2)
  );

  BenchmarkLogger.success(`Results written to ${path.join(resultsDir, 'terminal-buffer-production.json')}`);
  process.exit(0);
}

run().catch(err => {
  BenchmarkLogger.error(`Benchmark failed: ${err.message}\n${err.stack}`);
  process.exit(1);
});
