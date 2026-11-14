import pg from '/Users/amankashyap/Documents/nexusIDE/backend/node_modules/pg/lib/index.js';
import { performance } from 'perf_hooks';
import crypto from 'crypto';
import fs from 'fs';

const pool = new pg.Pool({
  connectionString: 'postgresql://amankashyap@localhost:5432/sandbox',
  max: 10
});

async function run() {
  console.log('=== Benchmarking PostgreSQL Persistence & Query Latency ===');
  
  // 1. Measure raw query latency (SELECT 1)
  const pingLatencies = [];
  for (let i = 0; i < 500; i++) {
    const start = performance.now();
    await pool.query('SELECT 1');
    pingLatencies.push(performance.now() - start);
  }
  pingLatencies.sort((a, b) => a - b);
  const medianPing = pingLatencies[Math.floor(pingLatencies.length / 2)];
  const p95Ping = pingLatencies[Math.floor(pingLatencies.length * 0.95)];
  const p99Ping = pingLatencies[Math.floor(pingLatencies.length * 0.99)];

  // 2. Setup isolated benchmark table matching file_updates structure
  await pool.query(`
    CREATE TEMP TABLE bench_file_updates (
      file_id UUID NOT NULL,
      seq BIGSERIAL PRIMARY KEY,
      update BYTEA NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const testFileUuid = crypto.randomUUID();
  const dummyPayload = Buffer.from('benchmark-crdt-binary-state-vector-payload');

  // 3. Measure single-row INSERT latency into bench_file_updates
  const insertLatencies = [];
  for (let i = 0; i < 500; i++) {
    const start = performance.now();
    await pool.query(
      'INSERT INTO bench_file_updates (file_id, update, created_at) VALUES ($1, $2, NOW())',
      [testFileUuid, dummyPayload]
    );
    insertLatencies.push(performance.now() - start);
  }

  insertLatencies.sort((a, b) => a - b);
  const medianInsert = insertLatencies[Math.floor(insertLatencies.length / 2)];
  const p95Insert = insertLatencies[Math.floor(insertLatencies.length * 0.95)];
  const p99Insert = insertLatencies[Math.floor(insertLatencies.length * 0.99)];
  const insertOpsPerSec = Math.round(1000 / medianInsert);

  // 4. Batch insert latency (50 updates in single multi-row INSERT)
  const batchLatencies = [];
  for (let i = 0; i < 50; i++) {
    const rows = Array.from({ length: 50 }, (_, idx) => [
      testFileUuid,
      Buffer.from(`batch-update-${i}-${idx}-${Math.random()}`),
    ]);
    const start = performance.now();
    const valueClauses = rows.map((_, idx) => `($1, $${idx + 2}, NOW())`).join(', ');
    const params = [testFileUuid, ...rows.map(r => r[1])];
    await pool.query(`INSERT INTO bench_file_updates (file_id, update, created_at) VALUES ${valueClauses}`, params);
    batchLatencies.push(performance.now() - start);
  }
  
  batchLatencies.sort((a, b) => a - b);
  const medianBatch = batchLatencies[Math.floor(batchLatencies.length / 2)];
  const p95Batch = batchLatencies[Math.floor(batchLatencies.length * 0.95)];
  const p99Batch = batchLatencies[Math.floor(batchLatencies.length * 0.99)];

  // 5. Read back / fetch updates latency (simulating Yjs initial state reconstruct)
  const readLatencies = [];
  for (let i = 0; i < 200; i++) {
    const start = performance.now();
    await pool.query('SELECT update FROM bench_file_updates WHERE file_id = $1 ORDER BY seq ASC LIMIT 50', [testFileUuid]);
    readLatencies.push(performance.now() - start);
  }
  readLatencies.sort((a, b) => a - b);
  const medianRead = readLatencies[Math.floor(readLatencies.length / 2)];
  const p95Read = readLatencies[Math.floor(readLatencies.length * 0.95)];
  const p99Read = readLatencies[Math.floor(readLatencies.length * 0.99)];

  const results = {
    timestamp: new Date().toISOString(),
    postgres_ping_latency_ms: {
      median: medianPing,
      p95: p95Ping,
      p99: p99Ping,
      ops_per_sec: Math.round(1000 / medianPing)
    },
    postgres_single_insert_ms: {
      median: medianInsert,
      p95: p95Insert,
      p99: p99Insert,
      ops_per_sec: insertOpsPerSec
    },
    postgres_batch_50_insert_ms: {
      median_total: medianBatch,
      p95_total: p95Batch,
      p99_total: p99Batch,
      per_update_median_ms: medianBatch / 50,
      effective_throughput_updates_sec: Math.round((50 * 1000) / medianBatch)
    },
    postgres_fetch_updates_ms: {
      median: medianRead,
      p95: p95Read,
      p99: p99Read,
      ops_per_sec: Math.round(1000 / medianRead)
    }
  };

  console.log('PostgreSQL Benchmark Results:\n', JSON.stringify(results, null, 2));
  fs.writeFileSync(
    '/Users/amankashyap/Documents/nexusIDE/benchmarks/results/postgres-results.json',
    JSON.stringify(results, null, 2)
  );

  await pool.end();
}

run().catch(console.error);
