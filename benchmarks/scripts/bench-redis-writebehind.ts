import { performance } from 'perf_hooks';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Direct production imports
import { crdtWriteBehindService, CrdtWriteBehindService } from '../../backend/src/services/crdtWriteBehind.service.js';
import { RedisCache, redis } from '../../backend/src/utils/redisCache.js';

import { Statistics } from '../common/statistics.mjs';
import { CleanupManager } from '../common/cleanup.mjs';
import { Assertions } from '../common/assertions.mjs';
import { BenchmarkLogger } from '../common/logger.mjs';
import { detectEnvironment } from '../common/environment.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  BenchmarkLogger.header('Benchmark 2: Redis Write-Behind & Multi-Tier Caching (Production)');
  const env = await detectEnvironment();

  if (!env.services.redis.available) {
    BenchmarkLogger.error('SKIPPED: REQUIRED INFRASTRUCTURE UNAVAILABLE (Redis server not responding)');
    process.exit(1);
  }

  // Ensure redis is ready
  if (redis.status !== 'ready') {
    await new Promise(resolve => redis.once('ready', resolve));
  }

  // Pre-cleanup
  await CleanupManager.cleanupRedis('bench:v2:*');
  await CleanupManager.cleanupRedis('crdt:buffer:bench-*');
  await CleanupManager.cleanupRedis('cache:bench-*');

  const results = {};

  // 1. Single Ingestion: bufferCrdtUpdate (Production Service)
  BenchmarkLogger.section('1. Production bufferCrdtUpdate Ingestion (1,000 iterations)');
  const testFileId = 'bench-file-wb-1';
  const dummyPayload = Buffer.from('crdt-binary-keystroke-delta-sample');

  const singleIngestionSamples = [];
  for (let i = 0; i < 1000; i++) {
    const t0 = performance.now();
    await crdtWriteBehindService.bufferCrdtUpdate(testFileId, dummyPayload);
    singleIngestionSamples.push(performance.now() - t0);
  }
  const singleIngestStats = Statistics.summarize(singleIngestionSamples);
  results['singleIngestion'] = singleIngestStats;
  console.log(`  bufferCrdtUpdate: Median ${singleIngestStats.median} ms | p95 ${singleIngestStats.p95} ms | p99 ${singleIngestStats.p99} ms | ${singleIngestStats.opsPerSec.toLocaleString()} ops/s`);

  // Verify buffer length in Redis
  const queueDepth = await crdtWriteBehindService.getPendingBufferSize(testFileId);
  Assertions.assertEqual(queueDepth, 1000, `Queue depth should be exactly 1000, got ${queueDepth}`);
  BenchmarkLogger.success(`Buffer queue depth verified: ${queueDepth} updates queued in Redis RAM`);

  // 2. Batch Ingestion: bufferCrdtUpdatesBatch (Batches of 10, 50, 100)
  BenchmarkLogger.section('2. Production bufferCrdtUpdatesBatch Ingestion');
  const batchSizes = [10, 50, 100];
  results['batchIngestion'] = {};

  for (const bSize of batchSizes) {
    const batchFileId = `bench-file-batch-${bSize}`;
    const updates = Array.from({ length: bSize }, (_, idx) => Buffer.from(`batch-delta-${idx}-${Math.random()}`));

    const batchSamples = [];
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();
      await crdtWriteBehindService.bufferCrdtUpdatesBatch(batchFileId, updates);
      batchSamples.push(performance.now() - t0);
    }
    const batchStats = Statistics.summarize(batchSamples);
    const perUpdateMedian = Number((batchStats.median / bSize).toFixed(6));
    const effectiveUpdatesPerSec = Math.round((bSize * 1000) / batchStats.median);

    results['batchIngestion'][bSize] = {
      batchSize: bSize,
      totalBatchStats: batchStats,
      perUpdateMedianMs: perUpdateMedian,
      effectiveUpdatesPerSec
    };

    console.log(`  Batch of ${bSize}: Total Median ${batchStats.median} ms | Effective Per-Update ${perUpdateMedian} ms | ${effectiveUpdatesPerSec.toLocaleString()} updates/sec`);
  }

  // 3. Sustained High-Throughput Burst Comparison (500 updates)
  BenchmarkLogger.section('3. Sustained Write-Behind Burst (500 updates)');
  const burstFileIndividual = 'bench-file-burst-ind';
  const burstFilePipeline = 'bench-file-burst-pip';
  const burstUpdates = Array.from({ length: 500 }, (_, idx) => Buffer.from(`burst-delta-${idx}`));

  // Baseline: Unbatched individual sequential pushes
  const t0Ind = performance.now();
  for (const u of burstUpdates) {
    await crdtWriteBehindService.bufferCrdtUpdate(burstFileIndividual, u);
  }
  const individualElapsedMs = performance.now() - t0Ind;

  // Optimized: Batched pipeline push
  const t0Pip = performance.now();
  await crdtWriteBehindService.bufferCrdtUpdatesBatch(burstFilePipeline, burstUpdates);
  const pipelineElapsedMs = performance.now() - t0Pip;

  const burstSpeedup = Number((individualElapsedMs / pipelineElapsedMs).toFixed(2));
  const burstLatencyDropPct = Number(((1 - (pipelineElapsedMs / individualElapsedMs)) * 100).toFixed(2));

  results['burstComparison'] = {
    updatesCount: 500,
    individualSequentialMs: Number(individualElapsedMs.toFixed(3)),
    pipelinedBatchMs: Number(pipelineElapsedMs.toFixed(3)),
    speedupFactor: burstSpeedup,
    latencyReductionPct: burstLatencyDropPct
  };
  console.log(`  500 updates individual sequential: ${individualElapsedMs.toFixed(2)} ms`);
  console.log(`  500 updates pipelined batch:      ${pipelineElapsedMs.toFixed(2)} ms (${burstSpeedup}x faster, ${burstLatencyDropPct}% latency drop)`);

  // 4. Multi-Tier Cache Hierarchy (L1 In-Memory vs L2 Redis)
  BenchmarkLogger.section('4. Multi-Tier Cache Benchmark (L1 Map vs L2 Redis)');
  const testCache = new RedisCache<string>('bench:cache', 60);

  // Seed cache key
  const cacheKey = 'file-metadata-mock-document';
  const cacheValue = JSON.stringify({ id: 'doc-123', title: 'Main Controller', astNodes: 450 });
  await testCache.set(cacheKey, cacheValue);

  // Measure L2 Redis GET (bypassing L1 to measure raw Redis L2 fetch)
  const l2Samples = [];
  for (let i = 0; i < 1000; i++) {
    const t0 = performance.now();
    await redis.get(`bench:cache:${cacheKey}`);
    l2Samples.push(performance.now() - t0);
  }
  const l2Stats = Statistics.summarize(l2Samples);

  // Measure L1 In-Memory Map GET
  const l1Stats = Statistics.measureSyncBatched(() => {
    testCache.get(cacheKey); // hits inMemoryCache Map
  }, 1000, 100);

  const l1VsL2Speedup = Number((l2Stats.median / (l1Stats.median || 0.000001)).toFixed(2));

  results['cacheHierarchy'] = {
    l1InMemoryMap: l1Stats,
    l2RedisRoundtrip: l2Stats,
    l1SpeedupVsL2: l1VsL2Speedup,
    cacheHitStats: testCache.stats()
  };

  console.log(`  L1 In-Memory Cache: Median ${l1Stats.median} ms | ${l1Stats.opsPerSec.toLocaleString()} ops/s`);
  console.log(`  L2 Redis Roundtrip: Median ${l2Stats.median} ms | ${l2Stats.opsPerSec.toLocaleString()} ops/s`);
  console.log(`  L1 Speedup over L2: ${l1VsL2Speedup}x faster`);

  // 5. Invalidation and TTL verification
  BenchmarkLogger.section('5. Invalidation and Pattern Deletion');
  await testCache.delete(cacheKey);
  const afterDelete = await testCache.get(cacheKey);
  Assertions.assertEqual(afterDelete, null, 'Cache key should be null after deletion');
  BenchmarkLogger.success('Cache invalidation verified');

  // Post-test cleanup
  await CleanupManager.cleanupRedis('bench:*');
  await CleanupManager.cleanupRedis('crdt:buffer:bench-*');

  // Save results
  const outputData = {
    benchmark: 'Redis Write-Behind & Multi-Tier Cache',
    timestamp: new Date().toISOString(),
    environment: env,
    evidenceTier: 'Tier A (Live Redis 8.8.0 + Production Service Code)',
    productionSources: [
      'backend/src/services/crdtWriteBehind.service.ts',
      'backend/src/utils/redisCache.ts'
    ],
    results
  };

  const resultsDir = path.resolve(__dirname, '..', 'results', 'raw');
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(
    path.join(resultsDir, 'redis-writebehind-production.json'),
    JSON.stringify(outputData, null, 2)
  );

  BenchmarkLogger.success(`Results written to ${path.join(resultsDir, 'redis-writebehind-production.json')}`);
  process.exit(0);
}

run().catch(err => {
  BenchmarkLogger.error(`Benchmark failed: ${err.message}\n${err.stack}`);
  process.exit(1);
});
