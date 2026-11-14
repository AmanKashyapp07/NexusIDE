import { performance } from 'perf_hooks';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { WebSocketServer, WebSocket } from 'ws';
import Redis from 'ioredis';
import crypto from 'crypto';
import dotenv from 'dotenv';

// Ensure DATABASE_URL is set before db.ts initializes
dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../backend/.env') });
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://amankashyap@localhost:5432/sandbox';
}

// Direct production imports
import { WSSharedDoc } from '../../backend/src/services/yjsSyncEngine.service.js';
import { publishYjsUpdate } from '../../backend/src/services/redisAdapter.service.js';

import { Statistics } from '../common/statistics.mjs';
import { Assertions } from '../common/assertions.mjs';
import { BenchmarkLogger } from '../common/logger.mjs';
import { detectEnvironment } from '../common/environment.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WS_PORT = 49153;

async function run() {
  BenchmarkLogger.header('Benchmark 6: Real-Time Yjs CRDT Collaboration (Production WSSharedDoc)');
  const env = await detectEnvironment();

  const results: any = {};

  // =========================================================================
  // LEVEL 1: Local Yjs Keystroke Microbenchmark (gc: false)
  // =========================================================================
  BenchmarkLogger.section('Level 1: Local Yjs Keystroke Throughput (gc: false)');
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
  // LEVEL 2: Real WS Collaboration via Production WSSharedDoc
  // =========================================================================
  BenchmarkLogger.section('Level 2: Production WSSharedDoc WebSocket Collaboration');

  const docName = `bench-ws-${Date.now()}`;
  const sharedDoc = new WSSharedDoc(docName, crypto.randomUUID(), crypto.randomUUID());
  
  // Spin up real WebSocket server hosting the production WSSharedDoc
  const wss = new WebSocketServer({ port: WS_PORT });

  wss.on('connection', ws => {
    sharedDoc.conns.set(ws, new Set());

    // Send initial sync step 1
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeSyncStep1(encoder, sharedDoc);
    ws.send(encoding.toUint8Array(encoder));

    ws.on('message', (message: Buffer) => {
      try {
        const uint8 = new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
        const decoder = decoding.createDecoder(uint8);
        const type = decoding.readVarUint(decoder);

        if (type === 0) { // Sync message
          const syncEncoder = encoding.createEncoder();
          encoding.writeVarUint(syncEncoder, 0);
          syncProtocol.readSyncMessage(decoder, syncEncoder, sharedDoc, ws);
          if (encoding.length(syncEncoder) > 1) {
            sharedDoc.send(ws, encoding.toUint8Array(syncEncoder));
          }
        }
      } catch {}
    });

    ws.on('close', () => {
      sharedDoc.conns.delete(ws);
    });
  });

  results['level2_productionWsSharedDoc'] = {};
  const clientTiers = [2, 5, 10];

  for (const clientCount of clientTiers) {
    const clients: { ws: WebSocket; doc: Y.Doc; text: Y.Text }[] = [];

    // Connect N real clients
    await new Promise<void>(resolve => {
      let ready = 0;
      for (let i = 0; i < clientCount; i++) {
        const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);
        const cDoc = new Y.Doc({ gc: false });
        const cText = cDoc.getText('content');

        ws.on('message', (data: Buffer) => {
          const uint8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          const dec = decoding.createDecoder(uint8);
          const type = decoding.readVarUint(dec);
          if (type === 0) {
            const enc = encoding.createEncoder();
            encoding.writeVarUint(enc, 0);
            syncProtocol.readSyncMessage(dec, enc, cDoc, ws);
            if (encoding.length(enc) > 1) {
              ws.send(encoding.toUint8Array(enc));
            }
          }
        });

        // Broadcast local client changes to server
        cDoc.on('update', (update: Uint8Array) => {
          const enc = encoding.createEncoder();
          encoding.writeVarUint(enc, 0);
          syncProtocol.writeUpdate(enc, update);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(encoding.toUint8Array(enc));
          }
        });

        ws.on('open', () => {
          clients.push({ ws, doc: cDoc, text: cText });
          ready++;
          if (ready === clientCount) resolve();
        });
      }
    });

    // Ensure initial handshake completes
    await new Promise(r => setTimeout(r, 20));

    const editsPerClient = 20;
    const totalTargetEdits = clientCount * editsPerClient;

    // Dynamically measure true convergence time (no static sleep delay)
    const convergencePromise = new Promise<{ durationMs: number; finalChars: number }>(resolve => {
      const t0 = performance.now();
      const checkConvergence = () => {
        const firstLen = clients[0].text.length;
        if (firstLen >= totalTargetEdits) {
          const allMatch = clients.every(c => c.text.length === firstLen && c.text.toString() === clients[0].text.toString());
          if (allMatch) {
            const durationMs = performance.now() - t0;
            resolve({ durationMs, finalChars: firstLen });
            return;
          }
        }
        setTimeout(checkConvergence, 2);
      };

      // Emit edits concurrently from each client
      for (let edit = 0; edit < editsPerClient; edit++) {
        for (let cIdx = 0; cIdx < clientCount; cIdx++) {
          const client = clients[cIdx];
          client.doc.transact(() => {
            client.text.insert(client.text.length, String.fromCharCode((cIdx % 26) + 65));
          });
        }
      }

      checkConvergence();
    });

    const convergence = await convergencePromise;

    results['level2_productionWsSharedDoc'][clientCount] = {
      clientCount,
      editsPerClient,
      totalEdits: totalTargetEdits,
      exactConvergenceMs: Number(convergence.durationMs.toFixed(2)),
      allClientsBitIdentical: true
    };

    console.log(`  ${clientCount} Real WS Clients on WSSharedDoc: True convergence in ${convergence.durationMs.toFixed(2)} ms (${totalTargetEdits} edits | Identical: YES ✓)`);

    // Teardown clients for next tier
    for (const c of clients) c.ws.close();
    await new Promise(r => setTimeout(r, 15));
  }

  wss.close();
  BenchmarkLogger.success('WSSharedDoc WebSocket server closed cleanly');

  // =========================================================================
  // LEVEL 3: Redis Pub/Sub Propagation Mesh & Cross-Instance Convergence
  // =========================================================================
  BenchmarkLogger.section('Level 3: Redis Pub/Sub Propagation & Cross-Instance State Convergence');
  const redisSub = new Redis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: 1 });
  const meshDocName = `bench-mesh-doc-${Date.now()}`;
  const clusterChannel = `yjs:update:${meshDocName}`;

  await redisSub.subscribe(clusterChannel);

  const originDoc = new Y.Doc({ gc: false });
  const replicaDoc = new Y.Doc({ gc: false });
  const originText = originDoc.getText('content');
  const replicaText = replicaDoc.getText('content');

  const propagationSamples: number[] = [];
  const testIterations = 100;

  await new Promise<void>(resolve => {
    let received = 0;
    let sendTime = 0;

    redisSub.on('messageBuffer', (_ch: string, message: Buffer) => {
      const receiveTime = performance.now();
      propagationSamples.push(receiveTime - sendTime);

      // Apply update to replica document (simulating second backend instance)
      const uint8 = new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
      Y.applyUpdate(replicaDoc, uint8);

      received++;
      if (received >= testIterations) resolve();
    });

    originDoc.on('update', async (update: Uint8Array) => {
      sendTime = performance.now();
      await publishYjsUpdate(meshDocName, update);
    });

    const sendStep = (step: number) => {
      if (step >= testIterations) return;
      originDoc.transact(() => {
        originText.insert(originText.length, String.fromCharCode((step % 26) + 97));
      });
      setTimeout(() => sendStep(step + 1), 2);
    };

    sendStep(0);
  });

  // Verify full convergence between origin and replica
  const originContent = originText.toString();
  const replicaContent = replicaText.toString();
  const contentMatches = originContent === replicaContent;
  const svOrigin = Buffer.from(Y.encodeStateVector(originDoc));
  const svReplica = Buffer.from(Y.encodeStateVector(replicaDoc));
  const stateVectorMatches = svOrigin.equals(svReplica);

  Assertions.assert(contentMatches, 'Replica document must match origin content after Redis propagation');
  Assertions.assert(stateVectorMatches, 'Replica document state vector must match origin state vector');

  const meshStats = Statistics.summarize(propagationSamples);
  results['level3_redisPubSubMesh'] = {
    iterations: testIterations,
    propagationStats: meshStats,
    crossInstanceConvergenceVerified: contentMatches && stateVectorMatches,
    replicatedCharacters: replicaText.length
  };
  console.log(`  Redis Mesh Propagation: Median ${meshStats.median} ms | p95 ${meshStats.p95} ms | Convergence Verified: YES ✓`);

  await redisSub.unsubscribe();
  await redisSub.quit();

  // =========================================================================
  // LEVEL 4: Encoded State Vector Tombstone Inflation under gc: false
  // =========================================================================
  BenchmarkLogger.section('Level 4: Tombstone Growth & Encoded State Vector Inflation (gc: false)');
  const deletionTiers = [0, 25, 50, 75];
  results['level4_tombstoneStateInflation'] = {};

  for (const delPct of deletionTiers) {
    const doc = new Y.Doc({ gc: false });
    const text = doc.getText('content');

    text.insert(0, 'A'.repeat(1000));
    if (delPct > 0) {
      const delCount = Math.floor(1000 * (delPct / 100));
      text.delete(0, delCount);
    }

    const stateBytes = Y.encodeStateAsUpdate(doc).byteLength;
    const remainingChars = 1000 - Math.floor(1000 * (delPct / 100));

    const freshDoc = new Y.Doc({ gc: false });
    if (remainingChars > 0) freshDoc.getText('content').insert(0, 'A'.repeat(remainingChars));
    const freshStateBytes = Y.encodeStateAsUpdate(freshDoc).byteLength;

    const inflationPct = freshStateBytes > 0 ? Number((((stateBytes - freshStateBytes) / freshStateBytes) * 100).toFixed(2)) : 0;

    results['level4_tombstoneStateInflation'][`${delPct}%_deleted`] = {
      initialChars: 1000,
      deletedPct: delPct,
      remainingChars,
      gcFalseStateVectorBytes: stateBytes,
      freshDocStateVectorBytes: freshStateBytes,
      tombstoneInflationPct: inflationPct
    };

    console.log(`  ${delPct}% Deleted: ${stateBytes} B (with tombstones) vs ${freshStateBytes} B (fresh doc) -> +${inflationPct}% state vector inflation`);
  }

  // Save results
  const outputData = {
    benchmark: 'Yjs CRDT Real-Time Collaboration',
    timestamp: new Date().toISOString(),
    environment: env,
    evidenceTier: 'Tier B / Component Harness (Production WSSharedDoc Class + Single-Host Redis Pub/Sub Mesh)',
    productionSources: [
      'backend/src/services/yjsSyncEngine.service.ts',
      'backend/src/services/redisAdapter.service.ts'
    ],
    scopeQualification: 'Measures production WSSharedDoc synchronization concurrency over real WebSockets and Redis Pub/Sub update replication between document instances in a single-host environment. Full multi-instance production clustering with HTTP upgrade auth was not evaluated.',
    results
  };

  const resultsDir = path.resolve(__dirname, '..', 'results', 'raw');
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(
    path.join(resultsDir, 'yjs-crdt-production.json'),
    JSON.stringify(outputData, null, 2)
  );

  BenchmarkLogger.success(`Results written to ${path.join(resultsDir, 'yjs-crdt-production.json')}`);
  process.exit(0);
}

run().catch(err => {
  BenchmarkLogger.error(`Benchmark failed: ${err.message}\n${err.stack}`);
  process.exit(1);
});
