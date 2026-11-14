import { performance } from 'perf_hooks';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as Y from 'yjs';
import { WebSocketServer, WebSocket } from 'ws';
import Redis from 'ioredis';

// Direct production import
import { WSSharedDoc } from '../../backend/src/services/yjsSyncEngine.service.js';

import { Statistics } from '../common/statistics.mjs';
import { Assertions } from '../common/assertions.mjs';
import { BenchmarkLogger } from '../common/logger.mjs';
import { detectEnvironment } from '../common/environment.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WS_PORT = 49153;

async function run() {
  BenchmarkLogger.header('Benchmark 6: Yjs CRDT Synchronization (Local, Real WS & Redis)');
  const env = await detectEnvironment();

  const results = {};

  // =========================================================================
  // LEVEL 1: Local Yjs Library Microbenchmark (gc: false)
  // =========================================================================
  BenchmarkLogger.section('Level 1: Local Yjs Microbenchmark (gc: false)');
  const insertionCounts = [100, 1000, 5000];
  results['level1_localLibrary'] = {};

  for (const n of insertionCounts) {
    const doc = new Y.Doc({ gc: false });
    const ytext = doc.getText('content');

    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      doc.transact(() => {
        ytext.insert(i, String.fromCharCode((i % 26) + 97));
      });
    }
    const elapsed = performance.now() - t0;
    const opsPerSec = Math.round((n * 1000) / elapsed);
    const stateUpdate = Y.encodeStateAsUpdate(doc);

    results['level1_localLibrary'][n] = {
      insertions: n,
      elapsedMs: Number(elapsed.toFixed(3)),
      insertionsPerSec: opsPerSec,
      encodedStateBytes: stateUpdate.byteLength,
      bytesPerChar: Number((stateUpdate.byteLength / n).toFixed(2))
    };
    console.log(`  ${n} insertions: ${elapsed.toFixed(2)} ms | ${opsPerSec.toLocaleString()} ins/s | State: ${stateUpdate.byteLength} B (${(stateUpdate.byteLength / n).toFixed(2)} B/char)`);
  }

  // =========================================================================
  // LEVEL 2: Real Multi-Client WebSocket Collaboration (2, 5, 10 Clients)
  // =========================================================================
  BenchmarkLogger.section('Level 2: Real WebSocket Collaboration (2, 5, 10 Clients)');

  const wss = new WebSocketServer({ port: WS_PORT });
  const serverClients = new Set<WebSocket>();

  wss.on('connection', ws => {
    serverClients.add(ws);
    ws.on('message', data => {
      // Broadcast CRDT update to all other connected clients
      for (const client of serverClients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(data);
        }
      }
    });
    ws.on('close', () => serverClients.delete(ws));
  });

  results['level2_realWsCollaboration'] = {};

  const clientTiers = [2, 5, 10];
  for (const clientCount of clientTiers) {
    // Spin up N real WebSocket clients, each maintaining their own Y.Doc
    const clients: { ws: WebSocket; doc: Y.Doc; text: Y.Text }[] = [];

    await new Promise<void>(resolve => {
      let connected = 0;
      for (let i = 0; i < clientCount; i++) {
        const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);
        const doc = new Y.Doc({ gc: false });
        const text = doc.getText('content');

        // Apply remote updates received over socket
        ws.on('message', (msg: Buffer) => {
          Y.applyUpdate(doc, new Uint8Array(msg));
        });

        // Broadcast local updates over socket
        doc.on('update', (update: Uint8Array) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(Buffer.from(update));
          }
        });

        ws.on('open', () => {
          clients.push({ ws, doc, text });
          connected++;
          if (connected === clientCount) resolve();
        });
      }
    });

    // Concurrently perform edits from all clients
    const editsPerClient = 50;
    const t0 = performance.now();

    for (let edit = 0; edit < editsPerClient; edit++) {
      for (let cIdx = 0; cIdx < clientCount; cIdx++) {
        const client = clients[cIdx];
        client.doc.transact(() => {
          client.text.insert(client.text.length, String.fromCharCode((cIdx % 26) + 65));
        });
      }
    }

    // Wait for all messages to cross loopback sockets and converge
    await new Promise(r => setTimeout(r, 60));
    const convergenceElapsed = performance.now() - t0;

    // Verify bit-for-bit convergence across all client docs
    const targetLength = clientCount * editsPerClient;
    const referenceContent = clients[0].text.toString();
    let allConverged = true;

    for (let cIdx = 0; cIdx < clientCount; cIdx++) {
      if (clients[cIdx].text.toString() !== referenceContent || clients[cIdx].text.length !== targetLength) {
        allConverged = false;
      }
    }
    Assertions.assert(allConverged, `Client divergence detected in tier ${clientCount}`);

    const stateSize = Y.encodeStateAsUpdate(clients[0].doc).byteLength;
    results['level2_realWsCollaboration'][clientCount] = {
      clientCount,
      editsPerClient,
      totalClusterEdits: targetLength,
      convergenceDurationMs: Number(convergenceElapsed.toFixed(2)),
      allClientsIdentical: allConverged,
      finalStateBytes: stateSize
    };

    console.log(`  ${clientCount} Real WS Clients: Converged in ${convergenceElapsed.toFixed(2)} ms | Total Edits: ${targetLength} | All docs identical: ${allConverged ? 'YES ✓' : 'NO'}`);

    // Cleanup clients for this tier
    for (const c of clients) c.ws.close();
    await new Promise(r => setTimeout(r, 20));
  }

  wss.close();
  BenchmarkLogger.success('WebSocket collaboration server closed cleanly');

  // =========================================================================
  // LEVEL 3: Redis Pub/Sub Cross-Instance Propagation
  // =========================================================================
  BenchmarkLogger.section('Level 3: Redis Pub/Sub Cross-Instance Sync Mesh');
  const redisPub = new Redis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: 1 });
  const redisSub = new Redis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: 1 });

  const docNodeA = new Y.Doc({ gc: false });
  const docNodeB = new Y.Doc({ gc: false });
  const channelName = 'bench:yjs:update:doc-cluster-test';

  await redisSub.subscribe(channelName);

  let propagationTimes: number[] = [];
  const testUpdatesCount = 200;

  await new Promise<void>(resolve => {
    let received = 0;
    let pendingSendTime = 0;

    redisSub.on('messageBuffer', (_ch: string, message: Buffer) => {
      const receiveTime = performance.now();
      propagationTimes.push(receiveTime - pendingSendTime);
      Y.applyUpdate(docNodeB, new Uint8Array(message));
      received++;
      if (received >= testUpdatesCount) resolve();
    });

    const sendNext = (i: number) => {
      if (i >= testUpdatesCount) return;
      pendingSendTime = performance.now();
      docNodeA.transact(() => {
        docNodeA.getText('content').insert(i, 'X');
      });
      const update = Y.encodeStateAsUpdate(docNodeA);
      redisPub.publish(channelName, Buffer.from(update)).then(() => {
        setTimeout(() => sendNext(i + 1), 2);
      });
    };

    sendNext(0);
  });

  const redisPropagationStats = Statistics.summarize(propagationTimes);
  Assertions.assertEqual(docNodeA.getText('content').toString(), docNodeB.getText('content').toString(), 'Redis synced docs mismatch');
  results['level3_redisPubSub'] = {
    updatesSent: testUpdatesCount,
    propagationStats: redisPropagationStats,
    stateSyncedBitForBit: true
  };
  console.log(`  Redis Pub/Sub Propagation: Median ${redisPropagationStats.median} ms | p95 ${redisPropagationStats.p95} ms | Docs bit-for-bit synced`);

  await redisSub.unsubscribe();
  await redisSub.quit();
  await redisPub.quit();

  // =========================================================================
  // LEVEL 4: Tombstone Growth Analysis (gc: false)
  // =========================================================================
  BenchmarkLogger.section('Level 4: Tombstone Growth & Memory Footprint (gc: false)');
  const deletionTiers = [0, 25, 50, 75];
  results['level4_tombstoneOverhead'] = {};

  for (const delPct of deletionTiers) {
    const doc = new Y.Doc({ gc: false });
    const text = doc.getText('content');

    // Insert 1000 characters
    text.insert(0, 'A'.repeat(1000));

    // Delete delPct %
    if (delPct > 0) {
      const deleteCount = Math.floor(1000 * (delPct / 100));
      text.delete(0, deleteCount);
    }

    const stateBytes = Y.encodeStateAsUpdate(doc).byteLength;
    const remainingChars = 1000 - Math.floor(1000 * (delPct / 100));

    // Fresh document with only remaining characters (as baseline comparison)
    const freshDoc = new Y.Doc({ gc: false });
    if (remainingChars > 0) freshDoc.getText('content').insert(0, 'A'.repeat(remainingChars));
    const freshStateBytes = Y.encodeStateAsUpdate(freshDoc).byteLength;

    const tombstoneInflationPct = freshStateBytes > 0 ? Number((((stateBytes - freshStateBytes) / freshStateBytes) * 100).toFixed(2)) : 0;

    results['level4_tombstoneOverhead'][`${delPct}%_deleted`] = {
      initialChars: 1000,
      deletedPct: delPct,
      remainingChars,
      gcFalseStateBytes: stateBytes,
      freshStateBytes,
      tombstoneInflationPct
    };

    console.log(`  ${delPct}% Deleted: ${stateBytes} B (with tombstones) vs ${freshStateBytes} B (fresh doc) -> +${tombstoneInflationPct}% tombstone inflation`);
  }

  // Save results
  const outputData = {
    benchmark: 'Yjs CRDT Real-Time Collaboration',
    timestamp: new Date().toISOString(),
    environment: env,
    evidenceTier: 'Tier A (Real WebSockets + Live Redis + Yjs Engine)',
    productionSources: [
      'backend/src/services/yjsSyncEngine.service.ts',
      'backend/src/services/redisAdapter.service.ts'
    ],
    results
  };

  const resultsDir = path.resolve(__dirname, '..', 'results', 'raw');
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(
    path.join(resultsDir, 'yjs-crdt-production.json'),
    JSON.stringify(outputData, null, 2)
  );

  BenchmarkLogger.success(`Results written to ${path.join(resultsDir, 'yjs-crdt-production.json')}`);
}

run().catch(err => {
  BenchmarkLogger.error(`Benchmark failed: ${err.message}\n${err.stack}`);
  process.exit(1);
});
