import { performance } from 'perf_hooks';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../backend/.env') });
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://amankashyap@localhost:5432/sandbox';
}

import { Pool } from 'pg';

import { Statistics } from '../common/statistics.mjs';
import { Assertions } from '../common/assertions.mjs';
import { BenchmarkLogger } from '../common/logger.mjs';
import { detectEnvironment } from '../common/environment.mjs';

async function run() {
  BenchmarkLogger.header('Benchmark 5: PostgreSQL Persistence Engine (Isolated Production Configuration)');
  const env = await detectEnvironment();

  if (!env.services.postgres.available) {
    BenchmarkLogger.error('SKIPPED: REQUIRED INFRASTRUCTURE UNAVAILABLE (PostgreSQL not connected)');
    process.exit(1);
  }

  // Dedicated isolated connection pool using exact production configuration from backend/src/db.ts
  // This isolates lifecycle management so closing the pool cannot disrupt running applications.
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:my_secure_db_password@localhost:5432/sandbox',
    max: 30,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
    query_timeout: 5000,
    application_name: 'NexusIDE-Benchmark-Postgres'
  });

  const BENCH_TABLE = `bench_file_updates_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const results: any = {};

  try {
    // Setup isolated table matching production file_updates schema
    await pool.query(`
      CREATE TABLE ${BENCH_TABLE} (
        file_id UUID NOT NULL,
        seq BIGSERIAL PRIMARY KEY,
        update BYTEA NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    BenchmarkLogger.success(`Dedicated benchmark table '${BENCH_TABLE}' created`);

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
    const singleInsertSamples = [];
    const testFileUuid = crypto.randomUUID();
    const samplePayload = Buffer.from('CRDT_BINARY_DELTA_BLOCK_PAYLOAD_TEST');

    for (let i = 0; i < 500; i++) {
      const t0 = performance.now();
      await pool.query(
        `INSERT INTO ${BENCH_TABLE} (file_id, update) VALUES ($1, $2)`,
        [testFileUuid, samplePayload]
      );
      singleInsertSamples.push(performance.now() - t0);
    }
    const singleInsertStats = Statistics.summarize(singleInsertSamples);
    results['singleRowInsert'] = singleInsertStats;
    console.log(`  Single INSERT: Median ${singleInsertStats.median} ms | p95 ${singleInsertStats.p95} ms | p99 ${singleInsertStats.p99} ms | ${singleInsertStats.opsPerSec.toLocaleString()} rows/s`);

    // 3. Parameterized Multi-Row Batch Inserts
    BenchmarkLogger.section('3. Multi-Row Parameterized Batch Inserts (10, 50, 100 updates)');
    const batchSizes = [10, 50, 100];
    results['batchInserts'] = {};

    for (const bSize of batchSizes) {
      const batchSamples = [];
      for (let run = 0; run < 50; run++) {
        const fileId = crypto.randomUUID();
        const valuePlaceholders = [];
        const params: any[] = [];
        let pIdx = 1;

        for (let i = 0; i < bSize; i++) {
          valuePlaceholders.push(`($${pIdx++}, $${pIdx++})`);
          params.push(fileId, samplePayload);
        }

        const queryText = `INSERT INTO ${BENCH_TABLE} (file_id, update) VALUES ${valuePlaceholders.join(', ')}`;

        const t0 = performance.now();
        await pool.query(queryText, params);
        batchSamples.push(performance.now() - t0);
      }

      const batchStats = Statistics.summarize(batchSamples);
      const perRowMedian = Number((batchStats.median / bSize).toFixed(6));
      const effectiveThroughput = Math.round((bSize * 1000) / batchStats.median);

      results['batchInserts'][bSize] = {
        batchSize: bSize,
        batchStats,
        perUpdateMedianMs: perRowMedian,
        effectiveThroughputRowsPerSec: effectiveThroughput
      };

      console.log(`  Batch of ${bSize}: Batch Median ${batchStats.median} ms | Per-Row ${perRowMedian} ms | ${effectiveThroughput.toLocaleString()} rows/sec effective`);
    }

    // 4. Concurrent Multi-Client Writes (5 parallel workers)
    BenchmarkLogger.section('4. Concurrent Multi-Worker Database Writes (5 workers x 100 rows)');
    const numWorkers = 5;
    const writesPerWorker = 100;
    const t0Concurrent = performance.now();

    await Promise.all(
      Array.from({ length: numWorkers }, async (_, wIdx) => {
        const workerFileId = crypto.randomUUID();
        for (let i = 0; i < writesPerWorker; i++) {
          await pool.query(
            `INSERT INTO ${BENCH_TABLE} (file_id, update) VALUES ($1, $2)`,
            [workerFileId, samplePayload]
          );
        }
      })
    );

    const concurrentDurationMs = performance.now() - t0Concurrent;
    const totalConcurrentWrites = numWorkers * writesPerWorker;
    const burstThroughput = Math.round((totalConcurrentWrites * 1000) / concurrentDurationMs);

    results['concurrentWrites'] = {
      concurrentWorkers: numWorkers,
      updatesPerWorker: writesPerWorker,
      totalWrites: totalConcurrentWrites,
      totalDurationMs: Number(concurrentDurationMs.toFixed(2)),
      burstThroughputRowsPerSec: burstThroughput
    };
    console.log(`  ${numWorkers} Workers (${totalConcurrentWrites} total writes): Finished in ${concurrentDurationMs.toFixed(2)} ms (${burstThroughput.toLocaleString()} rows/s burst)`);

    // 5. Document State Replay / Read Latency
    BenchmarkLogger.section('5. Document State Replay (Reading 500 ordered updates)');
    const readSamples = [];
    for (let r = 0; r < 100; r++) {
      const t0 = performance.now();
      await pool.query(
        `SELECT update FROM ${BENCH_TABLE} WHERE file_id = $1 ORDER BY seq ASC`,
        [testFileUuid]
      );
      readSamples.push(performance.now() - t0);
    }
    const readStats = Statistics.summarize(readSamples);
    results['stateReplayRead'] = readStats;
    console.log(`  Replay Read: Median ${readStats.median} ms | p95 ${readStats.p95} ms | ${readStats.opsPerSec.toLocaleString()} reads/s`);

  } finally {
    // Teardown benchmark table and close dedicated benchmark pool cleanly in finally block
    try {
      try {
        await pool.query(`DROP TABLE IF EXISTS ${BENCH_TABLE}`);
        BenchmarkLogger.success(`Dedicated benchmark table '${BENCH_TABLE}' dropped.`);
      } catch (dropErr: any) {
        console.warn(`[Cleanup Warning] Could not drop ${BENCH_TABLE}:`, dropErr.message);
      } finally {
        await pool.end();
        BenchmarkLogger.success('Isolated benchmark connection pool closed cleanly.');
      }
    } catch (poolErr: any) {
      console.warn('[Cleanup Warning] Error closing benchmark pool:', poolErr.message);
    }
  }

  // Save results
  const outputData = {
    benchmark: 'PostgreSQL Persistence Engine',
    timestamp: new Date().toISOString(),
    environment: env,
    evidenceTier: 'Tier B (PostgreSQL Infrastructure Benchmark: Direct SQL with Dedicated Pool matching Production Parameters)',
    productionConfigurationRef: 'backend/src/db.ts',
    scopeQualification: 'Direct-SQL PostgreSQL infrastructure benchmark measuring raw row, parameterized batch, and concurrent burst write throughput using a dedicated pool with production settings. Evaluates raw DB engine capability; application write coalescing is benchmarked in bench-redis-writebehind.ts.',
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
