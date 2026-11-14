/**
 * Benchmark: TerminalStreamBuffer for NexusIDE
 * Inlines the TS logic as plain JS, uses mock WebSockets.
 * Runs each scenario 100 times and reports median results.
 */

import { performance } from 'perf_hooks';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ─── Inlined TerminalStreamBuffer (from terminalStreamBuffer.ts) ──────────────

const WS_OPEN = 1; // WebSocket.OPEN constant

class TerminalStreamBuffer {
  constructor(ws, options = {}) {
    this.ws = ws;
    this.maxBatchMs = options.maxBatchMs ?? 10;
    this.maxBatchBytes = options.maxBatchBytes ?? 16384;
    this.maxBufferedAmount = options.maxBufferedAmount ?? 64 * 1024;
    this.chunks = [];
    this.currentBytes = 0;
    this.flushTimer = null;
    this.isFlushing = false;
  }

  push(chunk) {
    if (this.ws.readyState !== WS_OPEN) return;

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

  flush() {
    if (this.isFlushing || this.chunks.length === 0) return;
    if (this.ws.readyState !== WS_OPEN) {
      this.clear();
      return;
    }

    // Respect socket backpressure
    if (this.ws.bufferedAmount > this.maxBufferedAmount) {
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
      const combined =
        this.chunks.length === 1
          ? this.chunks[0]
          : Buffer.concat(this.chunks, this.currentBytes);
      this.chunks = [];
      this.currentBytes = 0;

      if (this.ws.readyState === WS_OPEN && combined && combined.length > 0) {
        this.ws.send(combined);
      }
    } finally {
      this.isFlushing = false;
    }
  }

  clear() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.chunks = [];
    this.currentBytes = 0;
  }
}

// ─── Mock WebSocket ───────────────────────────────────────────────────────────

function createMockWS() {
  return {
    readyState: WS_OPEN,
    bufferedAmount: 0,
    sendCount: 0,
    totalBytes: 0,
    sendTimestamps: [],
    send(data) {
      this.sendCount++;
      const bytes = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data);
      this.totalBytes += bytes;
      this.sendTimestamps.push(performance.now());
    },
    reset() {
      this.sendCount = 0;
      this.totalBytes = 0;
      this.sendTimestamps = [];
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeChunk(size) {
  return Buffer.alloc(size, 0x41); // fill with 'A'
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Wait for a given number of ms */
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Scenario Runners ─────────────────────────────────────────────────────────

/**
 * A. DIRECT — no buffering, send each chunk immediately (baseline).
 *    Uses TerminalStreamBuffer with maxBatchMs=0 to bypass timer.
 */
async function runDirect(chunks) {
  const ws = createMockWS();
  const buf = new TerminalStreamBuffer(ws, { maxBatchMs: 0 });

  const t0 = performance.now();
  for (const chunk of chunks) {
    buf.push(chunk);
  }
  const elapsed = performance.now() - t0;
  buf.clear();

  return { ws, elapsed, chunksIn: chunks.length };
}

/**
 * B–E. BUFFERED scenarios — push all chunks, wait 15ms for flush.
 */
async function runBuffered(chunks, options = {}) {
  const ws = createMockWS();
  const buf = new TerminalStreamBuffer(ws, { maxBatchMs: 10, ...options });

  const t0 = performance.now();
  for (const chunk of chunks) {
    buf.push(chunk);
  }
  await wait(15); // let the 10ms timer fire and flush
  const elapsed = performance.now() - t0;
  buf.clear();

  return { ws, elapsed, chunksIn: chunks.length };
}

// ─── Scenario Definitions ─────────────────────────────────────────────────────

const SCENARIOS = [
  {
    name: 'A. DIRECT',
    description: 'No buffering — send each chunk immediately (baseline)',
    async run() {
      // 100 chunks × 256 bytes as a representative workload
      const chunks = Array.from({ length: 100 }, () => makeChunk(256));
      return runDirect(chunks);
    },
  },
  {
    name: 'B. BUFFERED',
    description: 'TerminalStreamBuffer with 10ms window, 100 chunks × 256B',
    async run() {
      const chunks = Array.from({ length: 100 }, () => makeChunk(256));
      return runBuffered(chunks);
    },
  },
  {
    name: 'C. HIGH_VELOCITY',
    description: '1000 chunks of 64 bytes each arriving in <1ms burst',
    async run() {
      const chunks = Array.from({ length: 1000 }, () => makeChunk(64));
      return runBuffered(chunks);
    },
  },
  {
    name: 'D. LARGE_CHUNKS',
    description: '10 chunks of 8KB each',
    async run() {
      const chunks = Array.from({ length: 10 }, () => makeChunk(8192));
      return runBuffered(chunks);
    },
  },
  {
    name: 'E. MIXED',
    description: 'Alternating small (32B) and large (4KB) chunks (100 total)',
    async run() {
      const chunks = Array.from({ length: 100 }, (_, i) =>
        i % 2 === 0 ? makeChunk(32) : makeChunk(4096)
      );
      return runBuffered(chunks);
    },
  },
];

// ─── Run & Collect ────────────────────────────────────────────────────────────

const ITERATIONS = 100;

async function runScenario(scenario) {
  const sendCounts = [];
  const totalBytesArr = [];
  const elapsedArr = [];
  const frameReductions = [];
  const avgBatchSizes = [];

  for (let i = 0; i < ITERATIONS; i++) {
    const { ws, elapsed, chunksIn } = await scenario.run();
    const framesOut = ws.sendCount;
    const bytesOut = ws.totalBytes;

    sendCounts.push(framesOut);
    totalBytesArr.push(bytesOut);
    elapsedArr.push(elapsed);
    frameReductions.push(framesOut === 0 ? 1 : 1 - framesOut / chunksIn);
    avgBatchSizes.push(framesOut === 0 ? bytesOut : bytesOut / framesOut);
  }

  // Grab chunksIn from last run (constant per scenario)
  const { chunksIn } = await scenario.run();

  return {
    scenario: scenario.name,
    description: scenario.description,
    iterations: ITERATIONS,
    chunksIn,
    median_framesOut: median(sendCounts),
    median_frameReductionPct: +(median(frameReductions) * 100).toFixed(2),
    median_totalBytes: median(totalBytesArr),
    median_elapsedMs: +median(elapsedArr).toFixed(4),
    median_avgBatchBytes: +median(avgBatchSizes).toFixed(1),
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(70));
  console.log('  TerminalStreamBuffer Benchmark — NexusIDE');
  console.log(`  ${ITERATIONS} iterations per scenario`);
  console.log('='.repeat(70));

  const results = [];

  for (const scenario of SCENARIOS) {
    process.stdout.write(`\nRunning ${scenario.name} ...`);
    const result = await runScenario(scenario);
    results.push(result);
    process.stdout.write(' done\n');

    console.log(`  Description   : ${result.description}`);
    console.log(`  Chunks In     : ${result.chunksIn}`);
    console.log(`  Frames Out    : ${result.median_framesOut}  (median)`);
    console.log(`  Frame Reduc.  : ${result.median_frameReductionPct}%`);
    console.log(`  Total Bytes   : ${result.median_totalBytes} B`);
    console.log(`  Elapsed       : ${result.median_elapsedMs} ms`);
    console.log(`  Avg Batch     : ${result.median_avgBatchBytes} B`);
  }

  console.log('\n' + '='.repeat(70));

  // Write JSON output
  const outPath = '/Users/amankashyap/Documents/nexusIDE/benchmarks/results/terminal-buffer-results.json';
  const output = {
    benchmark: 'TerminalStreamBuffer',
    timestamp: new Date().toISOString(),
    node_version: process.version,
    iterations_per_scenario: ITERATIONS,
    results,
  };
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nResults written to: ${outPath}`);
}

main().catch((err) => {
  console.error('Benchmark error:', err);
  process.exit(1);
});
