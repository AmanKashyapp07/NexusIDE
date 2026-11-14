/**
 * bench-container-pool.mjs
 * Benchmark: NexusIDE Docker Warm Container Pool
 *
 * SOURCE ANALYSIS (pool.ts):
 *   - Pool data structure: WarmContainer[] (simple array, O(1) shift/push)
 *   - Target pool size formula:
 *       TERMINAL_POOL_SIZE = clamp(POOL_MIN=1, POOL_MAX=2(demo)/5(prod), activeSessions + 2)
 *   - Fill strategy: SEQUENTIAL (while loop awaiting each createContainer in series)
 *   - CGroup constraints per container:
 *       Memory:    1 GB (Memory = MemorySwap = 1 * 1024^3)
 *       CPU:       1.5 cores (NanoCpus = 1_500_000_000)
 *       PID limit: 500
 *       tmpfs /tmp: rw,exec,size=256m
 *   - Warm allocation path: terminalPool.shift() → O(1)
 *   - On-demand path:  createContainer + start → ~3500ms estimated
 *   - Single-flight replenishment guard: replenishingTerminal boolean flag
 */

import { performance } from 'perf_hooks';
import { writeFileSync } from 'fs';

// ─── Pool Source Constants (mirrored from pool.ts) ────────────────────────────
const isDemoMode = true;              // assume non-production (DEMO_MODE)
const TERMINAL_POOL_MIN  = 1;
const TERMINAL_POOL_MAX  = isDemoMode ? 2 : 5;
let   TERMINAL_POOL_SIZE = isDemoMode ? 1 : 2;

// ─── WarmContainer model ──────────────────────────────────────────────────────
let _containerIdCounter = 0;
function makeWarmContainer() {
  const id = `bench-${(++_containerIdCounter).toString(16).padStart(12, '0')}`;
  return { id, hostPort: 30000 + _containerIdCounter, container: { id } };
}

// ─── Simulated async container creation latency (ms) ──────────────────────────
// Modelled on typical Docker createContainer+start observed latency distribution:
//   mean ~3500ms, stddev ~400ms (gaussian approximation via Box-Muller)
function gaussianMs(mean, stddev) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + stddev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function simulateDockerCreate(fast = false) {
  // fast=true: simulated ~3.5ms (intra-process overhead, no real Docker)
  const latencyMs = fast ? gaussianMs(3.5, 0.5) : gaussianMs(3500, 400);
  return new Promise(resolve => setTimeout(resolve, latencyMs));
}

// ─── Statistics helpers ───────────────────────────────────────────────────────
function stats(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((s, v) => s + v, 0);
  const mean = sum / n;
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);
  const pct = (p) => sorted[Math.floor(p * n / 100)] ?? sorted[n - 1];
  return {
    n,
    min:    +sorted[0].toFixed(4),
    max:    +sorted[n - 1].toFixed(4),
    mean:   +mean.toFixed(4),
    median: +pct(50).toFixed(4),
    p95:    +pct(95).toFixed(4),
    p99:    +pct(99).toFixed(4),
    stddev: +stddev.toFixed(4),
    ops_per_sec: +(1000 / mean).toFixed(2),
  };
}

// ─── SECTION 0: Docker Availability ──────────────────────────────────────────
const DOCKER_AVAILABLE = false;   // confirmed by connectivity check (ENOENT /var/run/docker.sock)

console.log('='.repeat(72));
console.log('NexusIDE Warm Container Pool Benchmark');
console.log('='.repeat(72));
console.log(`Docker Available: ${DOCKER_AVAILABLE}`);
console.log(`Mode: Simulation (data-structure + Promise-overhead benchmark)\n`);

// ─── SECTION 1: Pool Source Analysis ─────────────────────────────────────────
const sourceAnalysis = {
  poolDataStructure: 'WarmContainer[] (plain JS array)',
  allocationOp:      'Array.prototype.shift() — O(1) amortized',
  replenishOp:       'Array.prototype.push() — O(1)',
  fillStrategy:      'SEQUENTIAL (while loop, serial await per container)',
  targetPoolSizeFormula: 'clamp(POOL_MIN=1, POOL_MAX=2[demo]/5[prod], activeSessions + 2)',
  cgroupConstraints: {
    memory_bytes:  1024 * 1024 * 1024,
    memory_swap_bytes: 1024 * 1024 * 1024,
    nano_cpus:     1_500_000_000,
    cpu_cores:     1.5,
    pids_limit:    500,
    tmpfs_tmp:     'rw,exec,size=256m',
    rootfs_readonly: false,
  },
  singleFlightGuard: 'boolean replenishingTerminal flag',
  estimatedColdLatency_ms: '~3500 (createContainer + start, no image pull)',
  estimatedWarmLatency_ms: '< 1 (array shift + no I/O)',
};

console.log('─── Pool Source Analysis ───────────────────────────────────────────────');
console.log(JSON.stringify(sourceAnalysis, null, 2));
console.log();

// ─── SECTION 2: O(1) Warm Allocation — 1000 iterations ───────────────────────
console.log('─── A. Warm Allocation: pool.shift() — 1000 iterations ─────────────────');
{
  // Pre-fill pool with 1000 objects, then measure shift()
  const pool = Array.from({ length: 1000 }, makeWarmContainer);
  const latencies = [];
  for (let i = 0; i < 1000; i++) {
    const t0 = performance.now();
    const c = pool.shift();
    const t1 = performance.now();
    latencies.push(t1 - t0);
    pool.push(makeWarmContainer()); // replenish immediately so pool never empties
  }
  const s = stats(latencies);
  console.log(`  Iterations: ${s.n}`);
  console.log(`  Min:        ${s.min} µs (×1000 for ms, so ${(s.min * 1000).toFixed(1)} ns)`);
  console.log(`  Mean:       ${s.mean} ms`);
  console.log(`  Median:     ${s.median} ms`);
  console.log(`  P95:        ${s.p95} ms`);
  console.log(`  P99:        ${s.p99} ms`);
  console.log(`  StdDev:     ${s.stddev} ms`);
  console.log(`  Throughput: ${s.ops_per_sec} ops/sec`);

  globalThis._shiftStats = s;
}

// ─── SECTION 3: O(1) Pool Replenishment — Array.push() ───────────────────────
console.log('\n─── B. Pool Replenishment: Array.push() — 1000 iterations ─────────────');
{
  const pool = [];
  const latencies = [];
  for (let i = 0; i < 1000; i++) {
    const c = makeWarmContainer();
    const t0 = performance.now();
    pool.push(c);
    const t1 = performance.now();
    latencies.push(t1 - t0);
    pool.shift(); // keep pool from growing unboundedly
  }
  const s = stats(latencies);
  console.log(`  Iterations: ${s.n}`);
  console.log(`  Mean:       ${s.mean} ms`);
  console.log(`  Median:     ${s.median} ms`);
  console.log(`  P95:        ${s.p95} ms`);
  console.log(`  P99:        ${s.p99} ms`);
  console.log(`  Throughput: ${s.ops_per_sec} ops/sec`);

  globalThis._pushStats = s;
}

// ─── SECTION 4: fillPool() Strategy: Sequential vs Parallel ──────────────────
console.log('\n─── C. fillPool() Strategy: Sequential vs Parallel Promise Overhead ───');

async function benchFillStrategy() {
  const N_CONTAINERS = 5; // typical pool max

  // Sequential (matches pool.ts implementation)
  const seqStart = performance.now();
  for (let i = 0; i < N_CONTAINERS; i++) {
    await simulateDockerCreate(true); // fast=true: ~3.5ms per container
    makeWarmContainer();
  }
  const seqElapsed = performance.now() - seqStart;

  // Parallel (alternative strategy)
  const parStart = performance.now();
  await Promise.all(Array.from({ length: N_CONTAINERS }, async () => {
    await simulateDockerCreate(true);
    makeWarmContainer();
  }));
  const parElapsed = performance.now() - parStart;

  console.log(`  Containers to provision: ${N_CONTAINERS}`);
  console.log(`  Sequential total time:   ${seqElapsed.toFixed(2)} ms  (matches pool.ts while-loop)`);
  console.log(`  Parallel total time:     ${parElapsed.toFixed(2)} ms  (theoretical improvement)`);
  console.log(`  Speedup (parallel/seq):  ${(seqElapsed / parElapsed).toFixed(2)}x`);
  console.log(`  NOTE: pool.ts uses SEQUENTIAL fill — parallel would be ~${N_CONTAINERS}x faster`);

  return { sequential_ms: +seqElapsed.toFixed(3), parallel_ms: +parElapsed.toFixed(3),
           speedup: +(seqElapsed / parElapsed).toFixed(2), containers: N_CONTAINERS };
}

const fillStrategyResult = await benchFillStrategy();

// ─── SECTION 5: Pool Size Dynamics ───────────────────────────────────────────
console.log('\n─── D. Pool Size Formula: clamp(MIN, MAX, activeSessions + 2) ─────────');
{
  const cases = [0, 1, 2, 3, 4, 5, 10];
  console.log('  activeSessions → targetPoolSize (demo) → targetPoolSize (prod)');
  const rows = cases.map(active => {
    const demo = Math.max(1, Math.min(2, active + 2));
    const prod = Math.max(1, Math.min(5, active + 2));
    console.log(`    ${String(active).padStart(2)} sessions → demo:${demo}  prod:${prod}`);
    return { activeSessions: active, demo_pool_size: demo, prod_pool_size: prod };
  });
  globalThis._poolSizeRows = rows;
}

// ─── SECTION 6: Concurrent Request Simulation (N goroutines) ─────────────────
console.log('\n─── E. Concurrent Allocation: Promise.all(N requests) ──────────────────');

async function benchConcurrent(N) {
  // Seed pool with enough warm containers
  const pool = Array.from({ length: Math.max(N, 20) }, makeWarmContainer);
  let onDemandCount = 0;

  const latencies = [];
  const t0 = performance.now();

  await Promise.all(Array.from({ length: N }, async () => {
    const start = performance.now();
    let c;
    if (pool.length > 0) {
      c = pool.shift();
    } else {
      onDemandCount++;
      await simulateDockerCreate(true);
      c = makeWarmContainer();
    }
    const elapsed = performance.now() - start;
    latencies.push(elapsed);
    // Simulate session duration: 0ms (measure allocation only)
    pool.push(makeWarmContainer()); // immediate replenish
    return c;
  }));

  const wallClock = performance.now() - t0;
  const s = stats(latencies);
  const throughput = +(N / (wallClock / 1000)).toFixed(1);

  console.log(`  N=${String(N).padStart(2)} concurrent → wall:${wallClock.toFixed(2)}ms  throughput:${throughput} alloc/sec  mean:${s.mean}ms  p99:${s.p99}ms  onDemand:${onDemandCount}`);

  return { N, wall_ms: +wallClock.toFixed(3), throughput_alloc_per_sec: throughput,
           mean_ms: s.mean, p99_ms: s.p99, on_demand_count: onDemandCount };
}

const concurrentResults = [];
for (const N of [5, 10, 20]) {
  concurrentResults.push(await benchConcurrent(N));
}

// ─── SECTION 7: Cold vs Warm Latency Comparison ──────────────────────────────
console.log('\n─── F. Cold vs Warm Allocation Latency Comparison ──────────────────────');

const SIMULATED_COLD_MS  = 3500;  // typical Docker createContainer+start (no image pull)
const SIMULATED_WARM_MS  = globalThis._shiftStats.mean;
const speedup = (SIMULATED_COLD_MS / SIMULATED_WARM_MS).toFixed(0);
const reduction = (((SIMULATED_COLD_MS - SIMULATED_WARM_MS) / SIMULATED_COLD_MS) * 100).toFixed(2);

console.log(`  Cold provisioning (simulated):  ~${SIMULATED_COLD_MS} ms`);
console.log(`  Warm allocation (measured):      ${SIMULATED_WARM_MS} ms`);
console.log(`  Latency reduction:               ${reduction}%`);
console.log(`  Speedup factor:                  ~${speedup}x`);

// ─── FINAL RESULTS JSON ───────────────────────────────────────────────────────
const results = {
  timestamp:         new Date().toISOString(),
  benchmark:         'NexusIDE Warm Container Pool',
  node_version:      process.version,
  docker_available:  DOCKER_AVAILABLE,
  mode:              'simulation',
  source_analysis:   sourceAnalysis,
  pool_size_dynamics: {
    formula: 'clamp(POOL_MIN=1, POOL_MAX, activeSessions + 2)',
    demo_pool_max: TERMINAL_POOL_MAX,
    prod_pool_max: 5,
    cases: globalThis._poolSizeRows,
  },
  warm_allocation_shift: globalThis._shiftStats,
  pool_replenishment_push: globalThis._pushStats,
  fill_strategy: fillStrategyResult,
  concurrent_allocation: concurrentResults,
  cold_vs_warm: {
    cold_ms_simulated: SIMULATED_COLD_MS,
    warm_ms_measured:  SIMULATED_WARM_MS,
    latency_reduction_pct: +reduction,
    speedup_factor: +speedup,
  },
};

const OUTPUT_PATH = '/Users/amankashyap/Documents/nexusIDE/benchmarks/results/container-pool-results.json';
writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));
console.log('\n' + '='.repeat(72));
console.log(`Results written to: ${OUTPUT_PATH}`);
console.log('='.repeat(72));
