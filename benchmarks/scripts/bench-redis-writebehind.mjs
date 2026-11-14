/**
 * bench-redis-writebehind.mjs
 * Benchmarks Redis Write-Behind caching and in-memory cache tier for NexusIDE.
 * Scenarios modelled after: crdtWriteBehind.service.ts, redisCache.ts
 */

import Redis from '/Users/amankashyap/Documents/nexusIDE/backend/node_modules/ioredis/built/index.js';
import { writeFileSync, mkdirSync } from 'fs';
import { performance } from 'perf_hooks';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomBytes(min, max) {
  const len = min + Math.floor(Math.random() * (max - min + 1));
  const buf = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) buf[i] = Math.floor(Math.random() * 256);
  return buf;
}

function randomString(len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, idx)];
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / sorted.length;
  const median = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const opsPerSec = Math.round(1000 / mean);
  return { mean: +mean.toFixed(4), median: +median.toFixed(4), p95: +p95.toFixed(4), p99: +p99.toFixed(4), opsPerSec };
}

function printSection(title) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

async function cleanupKeys(redis, pattern) {
  let cursor = '0';
  const keys = [];
  do {
    const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== '0');
  if (keys.length > 0) await redis.del(...keys);
  return keys.length;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const NAMESPACE = 'bench:crdt:';
const results = {};

const redis = new Redis({ host: '127.0.0.1', port: 6379, lazyConnect: false });

await new Promise((res, rej) => {
  redis.once('ready', res);
  redis.once('error', rej);
});
console.log('[Redis] Connected — starting benchmarks...');

// Pre-cleanup
const cleaned = await cleanupKeys(redis, 'bench:*');
if (cleaned > 0) console.log(`[cleanup] Removed ${cleaned} stale bench:* keys.`);

// ═══════════════════════════════════════════════════════════════════════════════
// A. Single RPUSH (bufferCrdtUpdate simulation)
// ═══════════════════════════════════════════════════════════════════════════════
printSection('A. Single RPUSH — simulating bufferCrdtUpdate (1000 iters)');

{
  const ITERS = 1000;
  const listKey = `${NAMESPACE}single-rpush`;
  const latencies = [];

  for (let i = 0; i < ITERS; i++) {
    const update = randomBytes(50, 200);
    const hex = update.toString('hex');
    const t0 = performance.now();
    await redis.rpush(listKey, hex);
    latencies.push(performance.now() - t0);
  }

  await redis.del(listKey);
  const s = stats(latencies);
  results.A_single_rpush = s;
  console.log(`  Median: ${s.median}ms | p95: ${s.p95}ms | p99: ${s.p99}ms | ops/sec: ${s.opsPerSec}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// B. Pipeline batch RPUSH (bufferCrdtUpdatesBatch simulation)
// ═══════════════════════════════════════════════════════════════════════════════
printSection('B. Pipeline batch RPUSH — simulating bufferCrdtUpdatesBatch');

results.B_pipeline_batch = {};
for (const batchSize of [10, 50, 100]) {
  const ITERS = 100;
  const listKey = `${NAMESPACE}pipeline-rpush-${batchSize}`;
  const totalLatencies = [];
  const perUpdateLatencies = [];

  for (let i = 0; i < ITERS; i++) {
    const updates = Array.from({ length: batchSize }, () => randomBytes(50, 200).toString('hex'));
    const t0 = performance.now();
    const pipeline = redis.pipeline();
    pipeline.rpush(listKey, ...updates);
    pipeline.sadd(`${NAMESPACE}dirty_files`, `file-${i}`);
    pipeline.expire(listKey, 3600);
    await pipeline.exec();
    const elapsed = performance.now() - t0;
    totalLatencies.push(elapsed);
    perUpdateLatencies.push(elapsed / batchSize);
  }

  await redis.del(listKey);
  const total = stats(totalLatencies);
  const perUpdate = stats(perUpdateLatencies);
  results.B_pipeline_batch[`batch_${batchSize}`] = {
    total_ms: total,
    per_update_ms: perUpdate,
  };
  console.log(`  Batch ${batchSize.toString().padStart(3)}: total median=${total.median}ms p95=${total.p95}ms | per-update median=${perUpdate.median}ms ops/sec=${perUpdate.opsPerSec}`);
}
await cleanupKeys(redis, `${NAMESPACE}*`);

// ═══════════════════════════════════════════════════════════════════════════════
// C. Write-behind simulation — 500 cursor/keystroke updates in 100ms window
// ═══════════════════════════════════════════════════════════════════════════════
printSection('C. Write-behind simulation — 500 updates in 100ms window');

{
  const TOTAL_UPDATES = 500;
  const listKey = `${NAMESPACE}wb-simulation`;
  const dirtyKey = `${NAMESPACE}wb-dirty`;

  // Without write-behind: individual writes
  let individualWrites = 0;
  const t0Individual = performance.now();
  const indivLatencies = [];
  for (let i = 0; i < TOTAL_UPDATES; i++) {
    const update = randomBytes(50, 200).toString('hex');
    const t = performance.now();
    await redis.rpush(listKey, update);
    indivLatencies.push(performance.now() - t);
    individualWrites++;
  }
  const totalIndividual = performance.now() - t0Individual;
  await redis.del(listKey);

  // With write-behind: pipeline in one call
  const updates = Array.from({ length: TOTAL_UPDATES }, () => randomBytes(50, 200).toString('hex'));
  const t0Pipeline = performance.now();
  const pipeline = redis.pipeline();
  pipeline.rpush(listKey, ...updates);
  pipeline.sadd(dirtyKey, 'file-wb-test');
  pipeline.expire(listKey, 3600);
  await pipeline.exec();
  const totalPipeline = performance.now() - t0Pipeline;
  await redis.del(listKey, dirtyKey);

  const reduction = ((1 - totalPipeline / totalIndividual) * 100).toFixed(1);
  const indivStats = stats(indivLatencies);

  results.C_write_behind = {
    updates: TOTAL_UPDATES,
    individual_total_ms: +totalIndividual.toFixed(2),
    individual_ops: individualWrites,
    individual_per_op_median_ms: indivStats.median,
    pipeline_total_ms: +totalPipeline.toFixed(2),
    pipeline_calls: 1,
    time_reduction_pct: +reduction,
    speedup_factor: +(totalIndividual / totalPipeline).toFixed(2),
  };

  console.log(`  Individual (${TOTAL_UPDATES} calls): ${totalIndividual.toFixed(2)}ms total | ${indivStats.median}ms/op median`);
  console.log(`  Pipeline   (1 call):        ${totalPipeline.toFixed(2)}ms total`);
  console.log(`  Time reduction: ${reduction}%  |  Speedup: ${(totalIndividual / totalPipeline).toFixed(2)}x`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// D. Cache read latency — simulating RedisCache.get (GET)
// ═══════════════════════════════════════════════════════════════════════════════
printSection('D. Cache read latency — RedisCache.get simulation (1000 iters)');

{
  const ITERS = 1000;
  const cacheKey = `${NAMESPACE}cache-read-test`;
  const value = randomString(500); // ~500 byte string

  await redis.set(cacheKey, value);

  const latencies = [];
  for (let i = 0; i < ITERS; i++) {
    const t0 = performance.now();
    await redis.get(cacheKey);
    latencies.push(performance.now() - t0);
  }

  await redis.del(cacheKey);
  const s = stats(latencies);
  results.D_cache_read = s;
  console.log(`  Median: ${s.median}ms | p95: ${s.p95}ms | p99: ${s.p99}ms | ops/sec: ${s.opsPerSec}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// E. In-memory (L1) cache vs Redis GET
// ═══════════════════════════════════════════════════════════════════════════════
printSection('E. In-memory Map (L1) vs Redis GET — 10000 iters each');

{
  const ITERS = 10000;
  const mapKey = `${NAMESPACE}l1-test`;
  const value = randomString(500);

  // L1: JavaScript Map
  const inMemoryCache = new Map();
  inMemoryCache.set(mapKey, { value, expiresAt: Infinity });

  const mapLatencies = [];
  for (let i = 0; i < ITERS; i++) {
    const t0 = performance.now();
    const entry = inMemoryCache.get(mapKey);
    if (!entry || (entry.expiresAt !== Infinity && Date.now() > entry.expiresAt)) {
      // miss
    } else {
      entry.value; // simulate access
    }
    mapLatencies.push(performance.now() - t0);
  }

  // Redis GET
  await redis.set(mapKey, value);
  const redisLatencies = [];
  for (let i = 0; i < ITERS; i++) {
    const t0 = performance.now();
    await redis.get(mapKey);
    redisLatencies.push(performance.now() - t0);
  }
  await redis.del(mapKey);

  const mapStats = stats(mapLatencies);
  const redisStats = stats(redisLatencies);
  const speedup = +(redisStats.median / (mapStats.median || 0.0001)).toFixed(1);

  results.E_memory_vs_redis = {
    iterations: ITERS,
    map_l1: mapStats,
    redis_get: redisStats,
    l1_speedup_vs_redis: speedup,
  };

  console.log(`  Map (L1):   Median=${mapStats.median}ms  p95=${mapStats.p95}ms  p99=${mapStats.p99}ms  ops/sec=${mapStats.opsPerSec}`);
  console.log(`  Redis GET:  Median=${redisStats.median}ms  p95=${redisStats.p95}ms  p99=${redisStats.p99}ms  ops/sec=${redisStats.opsPerSec}`);
  console.log(`  L1 is ~${speedup}x faster than Redis GET (median)`);
}

// ─── Final cleanup & verify ────────────────────────────────────────────────────
const remaining = await cleanupKeys(redis, 'bench:*');
console.log(`\n[cleanup] Removed ${remaining} bench:* keys post-benchmark.`);

// Verify via SCAN
const { execSync } = await import('child_process');
try {
  const scanOut = execSync("redis-cli --scan --pattern 'bench:*'", { timeout: 5000 }).toString().trim();
  console.log(`[verify]  Keys remaining after cleanup: ${scanOut.length > 0 ? scanOut : '(none) ✓'}`);
} catch (e) {
  console.log('[verify]  redis-cli scan skipped:', e.message);
}

// ─── Write JSON results ────────────────────────────────────────────────────────
const output = {
  timestamp: new Date().toISOString(),
  environment: { redis: '127.0.0.1:6379', nodeVersion: process.version },
  results,
};

mkdirSync('/Users/amankashyap/Documents/nexusIDE/benchmarks/results', { recursive: true });
writeFileSync(
  '/Users/amankashyap/Documents/nexusIDE/benchmarks/results/redis-results.json',
  JSON.stringify(output, null, 2)
);
console.log('\n[done] Results written to benchmarks/results/redis-results.json');

await redis.quit();
