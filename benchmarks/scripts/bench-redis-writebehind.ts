import { performance } from 'perf_hooks';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import dotenv from 'dotenv';

// Ensure DATABASE_URL is set before db.ts initializes
dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../backend/.env') });
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://amankashyap@localhost:5432/sandbox';
}

import * as Y from 'yjs';

// Direct production imports
import { crdtWriteBehindService } from '../../backend/src/services/crdtWriteBehind.service.js';
import { RedisCache, redis } from '../../backend/src/utils/redisCache.js';
import { getPool } from '../../backend/src/db.js';

import { Statistics } from '../common/statistics.mjs';
import { CleanupManager } from '../common/cleanup.mjs';
import { Assertions } from '../common/assertions.mjs';
import { BenchmarkLogger } from '../common/logger.mjs';
import { detectEnvironment } from '../common/environment.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  BenchmarkLogger.header('Benchmark 2: Redis Write-Behind Buffer & Flush Lifecycle (Production)');
  const env = await detectEnvironment();

  if (!env.services.redis.available) {
    BenchmarkLogger.error('SKIPPED: REQUIRED INFRASTRUCTURE UNAVAILABLE (Redis server not responding)');
    process.exit(1);
  }

  // Ensure redis is ready
  if (redis.status !== 'ready') {
    await new Promise(resolve => redis.once('ready', resolve));
  }

  const results: any = {};
  const testWorkspaceId = crypto.randomUUID();
  const testFileId = crypto.randomUUID();

  try {
    // 0. Setup isolated DB entity for valid foreign keys in file_updates
    const pool = getPool();
    // Get an existing user or insert dummy user if table empty
    let userId: string;
    const userRes = await pool.query('SELECT id FROM users LIMIT 1');
    if (userRes.rows.length > 0) {
      userId = userRes.rows[0].id;
    } else {
      userId = crypto.randomUUID();
      await pool.query('INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)', [
        userId, `bench-${Date.now()}@test.local`, 'hash'
      ]);
    }

    await pool.query('INSERT INTO workspaces (id, owner_id, title) VALUES ($1, $2, $3)', [
      testWorkspaceId, userId, 'Benchmark WriteBehind Workspace'
    ]);
    await pool.query('INSERT INTO files (id, workspace_id, name, type) VALUES ($1, $2, $3, $4)', [
      testFileId, testWorkspaceId, 'bench_wb_file.ts', 'file'
    ]);
    BenchmarkLogger.success(`Isolated test file created in PostgreSQL: ${testFileId}`);

    // Pre-cleanup Redis
    await CleanupManager.cleanupRedis('bench:v2:*');
    await CleanupManager.cleanupRedis('crdt:buffer:bench-*');
    await redis.srem('crdt:dirty_files', testFileId);

    // =========================================================================
    // 1. SINGLE UPDATE INGESTION (bufferCrdtUpdate)
    // =========================================================================
    BenchmarkLogger.section('1. bufferCrdtUpdate Ingestion (1,000 iterations)');
    const sampleUpdate = Buffer.from('crdt-binary-keystroke-delta-sample');

    const singleIngestionSamples = [];
    for (let i = 0; i < 1000; i++) {
      const t0 = performance.now();
      await crdtWriteBehindService.bufferCrdtUpdate(testFileId, sampleUpdate);
      singleIngestionSamples.push(performance.now() - t0);
    }
    const singleIngestStats = Statistics.summarize(singleIngestionSamples);
    results['singleIngestion'] = singleIngestStats;
    console.log(`  bufferCrdtUpdate: Median ${singleIngestStats.median} ms | p95 ${singleIngestStats.p95} ms | p99 ${singleIngestStats.p99} ms | ${singleIngestStats.opsPerSec.toLocaleString()} ops/s`);

    // Verify buffer depth in Redis
    const queueDepth = await crdtWriteBehindService.getPendingBufferSize(testFileId);
    Assertions.assertEqual(queueDepth, 1000, `Queue depth should be 1000, got ${queueDepth}`);
    BenchmarkLogger.success(`Queue depth verified in Redis RAM: ${queueDepth} buffered updates`);

    // =========================================================================
    // 2. BATCH PIPELINE INGESTION (bufferCrdtUpdatesBatch)
    // =========================================================================
    BenchmarkLogger.section('2. bufferCrdtUpdatesBatch Effective Throughput');
    const batchSizes = [10, 50, 100];
    results['batchIngestion'] = {};

    for (const bSize of batchSizes) {
      const batchFileId = `bench-file-batch-${bSize}-${Date.now()}`;
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
        effectiveBatchUpdatesPerSec: effectiveUpdatesPerSec
      };

      console.log(`  Batch of ${bSize}: Batch Median ${batchStats.median} ms | Effective Per-Update ${perUpdateMedian} ms | ${effectiveUpdatesPerSec.toLocaleString()} updates/sec (effective batch throughput)`);

      // Clean up batch file buffer
      await redis.del(`crdt:buffer:${batchFileId}`);
      await redis.srem('crdt:dirty_files', batchFileId);
    }

    // =========================================================================
    // 3. PERSISTENCE FLUSH LIFECYCLE (flushFileBuffer -> PostgreSQL file_updates)
    // =========================================================================
    BenchmarkLogger.section('3. Production flushFileBuffer() Lifecycle (Redis -> DB Persistence)');

    // Clear buffer for testFileId first
    await redis.del(`crdt:buffer:${testFileId}`);
    await redis.srem('crdt:dirty_files', testFileId);

    // Create 50 realistic Yjs incremental binary updates
    const doc = new Y.Doc({ gc: false });
    const ytext = doc.getText('content');
    const realYjsUpdates: Buffer[] = [];

    doc.on('update', (u: Uint8Array) => {
      realYjsUpdates.push(Buffer.from(u));
    });

    for (let c = 0; c < 50; c++) {
      doc.transact(() => {
        ytext.insert(c, String.fromCharCode((c % 26) + 97));
      });
    }

    // Buffer these 50 updates into Redis
    await crdtWriteBehindService.bufferCrdtUpdatesBatch(testFileId, realYjsUpdates);
    const bufferedCountBeforeFlush = await crdtWriteBehindService.getPendingBufferSize(testFileId);
    Assertions.assertEqual(bufferedCountBeforeFlush, 50, 'Must have 50 buffered updates in Redis');

    // Measure production flushFileBuffer() execution
    const t0Flush = performance.now();
    const flushedCount = await crdtWriteBehindService.flushFileBuffer(testFileId);
    const flushDurationMs = performance.now() - t0Flush;

    Assertions.assertEqual(flushedCount, 50, 'flushFileBuffer must report 50 flushed updates');

    // Verify buffer is now empty in Redis
    const queueDepthAfterFlush = await crdtWriteBehindService.getPendingBufferSize(testFileId);
    Assertions.assertEqual(queueDepthAfterFlush, 0, 'Redis queue depth must be 0 after flush');

    // Verify compound update row in PostgreSQL file_updates
    const dbRowRes = await pool.query('SELECT count(*) as count FROM file_updates WHERE file_id = $1', [testFileId]);
    const persistedRowCount = Number(dbRowRes.rows[0].count);
    Assertions.assertEqual(persistedRowCount, 1, 'Should coalesce 50 updates into 1 compound row in PostgreSQL');

    results['flushLifecycle'] = {
      bufferedUpdatesCount: 50,
      flushedUpdatesCount: flushedCount,
      flushDurationMs: Number(flushDurationMs.toFixed(3)),
      persistedSqlRows: persistedRowCount,
      writeAmplificationReductionPct: 98.0 // 50 writes -> 1 write
    };

    console.log(`  Flushed ${flushedCount} updates in ${flushDurationMs.toFixed(2)} ms (Redis lock + Y.mergeUpdates + SQL INSERT)`);
    console.log(`  Write Coalescing: 50 keystrokes coalesced into ${persistedRowCount} SQL INSERT (98.0% IOPS reduction)`);
    console.log(`  Redis Queue Depth after flush: ${queueDepthAfterFlush}`);

    // =========================================================================
    // 4. REAL REDIS CACHE LATENCY (Properly Awaited Async Cache)
    // =========================================================================
    BenchmarkLogger.section('4. RedisCache Read & Write Latency (Real Async Execution)');
    const testCache = new RedisCache<string>('bench:cache:doc', 60);
    const cacheKey = 'metadata_document_123';
    const cacheVal = JSON.stringify({ id: 'doc-123', name: 'App.tsx', bytes: 4096 });

    // Measure SET
    const setSamples = [];
    for (let i = 0; i < 500; i++) {
      const t0 = performance.now();
      await testCache.set(cacheKey, cacheVal);
      setSamples.push(performance.now() - t0);
    }
    const setStats = Statistics.summarize(setSamples);

    // Measure GET (Cache Hit)
    const getSamples = [];
    for (let i = 0; i < 500; i++) {
      const t0 = performance.now();
      const val = await testCache.get(cacheKey);
      getSamples.push(performance.now() - t0);
    }
    const getStats = Statistics.summarize(getSamples);
    const cacheStats = testCache.stats();

    results['cacheOperations'] = {
      cacheSetStats: setStats,
      cacheGetHitStats: getStats,
      hitsRecorded: cacheStats.hits,
      missesRecorded: cacheStats.misses,
      hitRatePct: Number((cacheStats.hitRate * 100).toFixed(2))
    };

    console.log(`  RedisCache.set: Median ${setStats.median} ms | ${setStats.opsPerSec.toLocaleString()} ops/s`);
    console.log(`  RedisCache.get (HIT): Median ${getStats.median} ms | ${getStats.opsPerSec.toLocaleString()} ops/s`);
    console.log(`  Hits Recorded: ${cacheStats.hits} | Hit Rate: ${(cacheStats.hitRate * 100).toFixed(1)}%`);

  } finally {
    // Teardown and deterministic cleanup
    BenchmarkLogger.section('Teardown & Cleanup');
    await CleanupManager.cleanupRedis('bench:*');
    await CleanupManager.cleanupRedis('crdt:buffer:bench-*');
    await redis.srem('crdt:dirty_files', testFileId);
    await redis.del(`crdt:buffer:${testFileId}`);

    const pool = getPool();
    await pool.query('DELETE FROM file_updates WHERE file_id = $1', [testFileId]);
    await pool.query('DELETE FROM files WHERE id = $1', [testFileId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId]);
    BenchmarkLogger.success('Cleaned up Redis keys and PostgreSQL benchmark rows cleanly.');
  }

  // Save results
  const outputData = {
    benchmark: 'Redis Write-Behind Buffer & Flush Lifecycle',
    timestamp: new Date().toISOString(),
    environment: env,
    evidenceTier: 'Tier A (Live Redis 8.8 + Live PostgreSQL 14 + Production Service)',
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
