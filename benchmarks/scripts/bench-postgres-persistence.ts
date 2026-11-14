import { performance } from 'perf_hooks';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import pg from 'pg';

import { Statistics } from '../common/statistics.mjs';
import { CleanupManager } from '../common/cleanup.mjs';
import { Assertions } from '../common/assertions.mjs';
import { BenchmarkLogger } from '../common/logger.mjs';
import { detectEnvironment } from '../common/environment.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  BenchmarkLogger.header('Benchmark 5: PostgreSQL Persistence Engine (Live Database)');
  const env = await detectEnvironment();

  if (!env.services.postgres.available) {
    BenchmarkLogger.error('SKIPPED: REQUIRED INFRASTRUCTURE UNAVAILABLE (PostgreSQL not connected)');
    process.exit(1);
  }

  const pool = new pg.Pool({
    connectionString: 'postgresql://amankashyap@localhost:5432/sandbox',
    max: 10,
    idleTimeoutMillis: 5000
  });

  const BENCH_TABLE = 'bench_production_file_updates';

  // Setup isolated table matching production file_updates schema
  await pool.query(`DROP TABLE IF EXISTS ${BENCH_TABLE}`);
  await pool.query(`
    CREATE TABLE ${BENCH_TABLE} (
      file_id UUID NOT NULL,
      seq BIGSERIAL PRIMARY KEY,
      update BYTEA NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  BenchmarkLogger.success(`Dedicated benchmark table '${BENCH_TABLE}' created`);

  const results = {};

  // 1. Connection Ping Latency
  BenchmarkLogger.section('1. PostgreSQL Connection Ping Latency (SELECT 1 - 500 iters)');
  const pingSamples = [];
  for (let i = 0; i < 500; i++) {
    const t0 = performance.now();
    await pool.query('SELECT 1');
    pingSamples.push(performance.now() - t0);
  }
  const pingStats = Statistics.summarize(pingSamples);
  results['pingLatency'] = pingStats;
  console.log(`  Ping (SELECT 1): Median ${pingStats.median} ms | p95 ${pingStats.p95} ms | ${pingStats.opsPerSec.toLocaleString()} queries/s`);

  // 2. Single-Row Insert Latency (500 iters)
  BenchmarkLogger.section('2. Single-Row CRDT BYTEA Insert (500 iterations)');
  const testFileUuid = crypto.randomUUID();
  const sampleUpdateBytea = Buffer.from('crdt-binary-state-vector-transaction-frame');

  const singleInsertSamples = [];
  for (let i = 0; i < 500; i++) {
    const t0 = performance.now();
    await pool.query(
      `INSERT INTO ${BENCH_TABLE} (file_id, update, created_at) VALUES ($1, $2, NOW())`,
      [testFileUuid, sampleUpdateBytea]
    );
    singleInsertSamples.push(performance.now() - t0);
  }
  const singleInsertStats = Statistics.summarize(singleInsertSamples);
  results['singleRowInsert'] = singleInsertStats;
  console.log(`  Single INSERT: Median ${singleInsertStats.median} ms | p95 ${singleInsertStats.p95} ms | p99 ${singleInsertStats.p99} ms | ${singleInsertStats.opsPerSec.toLocaleString()} rows/s`);

  // 3. Batch Inserts (10, 50, 100 updates per multi-row statement)
  BenchmarkLogger.section('3. Parameterized Multi-Row Batch Inserts');
  const batchSizes = [10, 50, 100];
  results['batchInserts'] = {};

  for (const bSize of batchSizes) {
    const bSamples = [];
    for (let run = 0; run < 50; run++) {
      const rows = Array.from({ length: bSize }, (_, idx) => [
        testFileUuid,
        Buffer.from(`batch-delta-${run}-${idx}-${Math.random()}`)
      ]);
      const valueClauses = rows.map((_, idx) => `($1, $${idx + 2}, NOW())`).join(', ');
      const params = [testFileUuid, ...rows.map(r => r[1])];

      const t0 = performance.now();
      await pool.query(`INSERT INTO ${BENCH_TABLE} (file_id, update, created_at) VALUES ${valueClauses}`, params);
      bSamples.push(performance.now() - t0);
    }

    const bStats = Statistics.summarize(bSamples);
    const perUpdateMedian = Number((bStats.median / bSize).toFixed(6));
    const effectiveThroughput = Math.round((bSize * 1000) / bStats.median);

    results['batchInserts'][bSize] = {
      batchSize: bSize,
      batchStats: bStats,
      perUpdateMedianMs: perUpdateMedian,
      effectiveThroughputRowsPerSec: effectiveThroughput
    };

    console.log(`  Batch of ${bSize}: Batch Median ${bStats.median} ms | Per-Row ${perUpdateMedian} ms | ${effectiveThroughput.toLocaleString()} rows/sec effective`);
  }

  // 4. Concurrent Multi-Client Writes (5 parallel client workers)
  BenchmarkLogger.section('4. Concurrent Multi-Client Writers (5 parallel workers)');
  const concurrentWorkers = 5;
  const updatesPerWorker = 100;

  const t0Concurrent = performance.now();
  await Promise.all(
    Array.from({ length: concurrentWorkers }, async (_, wId) => {
      const clientFileUuid = crypto.randomUUID();
      for (let i = 0; i < updatesPerWorker; i++) {
        await pool.query(
          `INSERT INTO ${BENCH_TABLE} (file_id, update, created_at) VALUES ($1, $2, NOW())`,
          [clientFileUuid, Buffer.from(`worker-${wId}-update-${i}`)]
        );
      }
    })
  );
  const totalConcurrentDuration = performance.now() - t0Concurrent;
  const totalConcurrentWrites = concurrentWorkers * updatesPerWorker;
  const concurrentThroughput = Math.round((totalConcurrentWrites * 1000) / totalConcurrentDuration);

  results['concurrentWrites'] = {
    concurrentWorkers,
    updatesPerWorker,
    totalWrites: totalConcurrentWrites,
    totalDurationMs: Number(totalConcurrentDuration.toFixed(2)),
    sustainedThroughputRowsPerSec: concurrentThroughput
  };
  console.log(`  5 Workers (${totalConcurrentWrites} total writes): Finished in ${totalConcurrentDuration.toFixed(2)} ms (${concurrentThroughput.toLocaleString()} rows/s sustained)`);

  // 5. Document State Replay / Read Latency
  BenchmarkLogger.section('5. Document State Replay (Reading 500 ordered updates)');
  const readSamples = [];
  for (let r = 0; r < 100; r++) {
    const t0 = performance.now();
    const res = await pool.query(
      `SELECT update FROM ${BENCH_TABLE} WHERE file_id = $1 ORDER BY seq ASC`,
      [testFileUuid]
    );
    readSamples.push(performance.now() - t0);
  }
  const readStats = Statistics.summarize(readSamples);
  results['stateReplayRead'] = readStats;
  console.log(`  Replay Read: Median ${readStats.median} ms | p95 ${readStats.p95} ms | ${readStats.opsPerSec.toLocaleString()} reads/s`);

  // Cleanup benchmark table
  await pool.query(`DROP TABLE IF EXISTS ${BENCH_TABLE}`);
  await pool.end();
  BenchmarkLogger.success('Database benchmark table dropped and pool closed cleanly');

  // Save results
  const outputData = {
    benchmark: 'PostgreSQL Persistence Engine',
    timestamp: new Date().toISOString(),
    environment: env,
    evidenceTier: 'Tier A (Live PostgreSQL 14+ Database)',
    productionSource: 'backend/src/db.ts',
    results
  };

  const resultsDir = path.resolve(__dirname, '..', 'results', 'raw');
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(
    path.join(resultsDir, 'postgres-persistence-production.json'),
    JSON.stringify(outputData, null, 2)
  );

  BenchmarkLogger.success(`Results written to ${path.join(resultsDir, 'postgres-persistence-production.json')}`);
}

run().catch(err => {
  BenchmarkLogger.error(`Benchmark failed: ${err.message}\n${err.stack}`);
  process.exit(1);
});
