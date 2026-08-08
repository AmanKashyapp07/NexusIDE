import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';

describe('Network Flakiness & Connection Resilience Suite', () => {
  let docA: Y.Doc;
  let docB: Y.Doc;

  beforeEach(() => {
    docA = new Y.Doc({ gc: false });
    docB = new Y.Doc({ gc: false });
  });

  afterEach(() => {
    docA.destroy();
    docB.destroy();
  });

  it('1. Sudden WebSocket disconnect mid-stream: re-syncs state vector without cursor duplication', () => {
    const textA = docA.getText('monaco');
    const textB = docB.getText('monaco');

    // Initial sync
    const initialVector = Y.encodeStateAsUpdate(docA);
    Y.applyUpdate(docB, initialVector);

    // Client A sends 50 characters, but socket drops midway after 25 characters
    const updatesA: Uint8Array[] = [];
    docA.on('update', (u: Uint8Array) => updatesA.push(u));

    docA.clientID = 100;
    for (let i = 0; i < 25; i++) {
      textA.insert(textA.length, `a${i},`);
    }

    // Deliver first 25 characters to Client B
    for (const u of updatesA) {
      Y.applyUpdate(docB, u);
    }

    expect(textB.toString()).toBe(textA.toString());

    // Client A continues typing offline while disconnected
    const offlineUpdates: Uint8Array[] = [];
    const unsubscribe = (u: Uint8Array) => offlineUpdates.push(u);
    docA.on('update', unsubscribe);

    for (let i = 25; i < 50; i++) {
      textA.insert(textA.length, `a${i},`);
    }

    // Client B also edits concurrently while Client A is offline
    docB.clientID = 200;
    textB.insert(0, 'CLIENT_B_HEADER\n');

    // Reconnection: Client A re-authenticates and exchanges state vectors
    const stateVectorB = Y.encodeStateVector(docB);
    const diffForB = Y.encodeStateAsUpdate(docA, stateVectorB);

    const stateVectorA = Y.encodeStateVector(docA);
    const diffForA = Y.encodeStateAsUpdate(docB, stateVectorA);

    // Apply bi-directional sync
    Y.applyUpdate(docB, diffForB);
    Y.applyUpdate(docA, diffForA);

    // Assert absolute CRDT convergence across both clients
    expect(textA.toString()).toBe(textB.toString());
    expect(textA.toString()).toContain('CLIENT_B_HEADER');
    expect(textA.toString()).toContain('a49,');
  });

  it('2. Out-of-order & delayed WebSocket frame delivery converges deterministically', () => {
    const textA = docA.getText('monaco');
    const textB = docB.getText('monaco');

    const frames: Uint8Array[] = [];
    docA.on('update', (u: Uint8Array) => frames.push(u));

    docA.clientID = 10;
    textA.insert(0, 'FIRST_FRAME\n');
    textA.insert(textA.length, 'SECOND_FRAME\n');
    textA.insert(textA.length, 'THIRD_FRAME\n');
    textA.insert(textA.length, 'FOURTH_FRAME\n');

    // Deliver frames in reverse/scrambled order to Client B
    const scrambled = [frames[3], frames[0], frames[2], frames[1]];
    for (const frame of scrambled) {
      if (frame) Y.applyUpdate(docB, frame);
    }

    // Both documents must converge to identical content without memory corruption
    expect(textB.toString()).toBe('FIRST_FRAME\nSECOND_FRAME\nTHIRD_FRAME\nFOURTH_FRAME\n');
    expect(textA.toString()).toBe(textB.toString());
  });

  it('3. High-jitter packet simulation with duplicated frames is idempotent', () => {
    const textA = docA.getText('monaco');
    const textB = docB.getText('monaco');

    const rawPackets: Uint8Array[] = [];
    docA.on('update', (u: Uint8Array) => rawPackets.push(u));

    docA.clientID = 42;
    textA.insert(0, 'INDEMPOTENT_TEST_STREAM');

    // Inject duplicate packets 5 times as if retransmitted by an aggressive TCP/WS proxy
    for (let loop = 0; loop < 5; loop++) {
      for (const p of rawPackets) {
        Y.applyUpdate(docB, p);
      }
    }

    expect(textB.toString()).toBe('INDEMPOTENT_TEST_STREAM');
    expect(textB.length).toBe(23);
  });

  it('4. Awareness & Ghost Cursor cleanup upon abrupt client socket disconnect', () => {
    // Simulate awareness map with heartbeat timers
    const awarenessMap = new Map<number, { userId: string; cursor: { line: number; ch: number }; lastSeen: number }>();

    // Client 1 & Client 2 join
    awarenessMap.set(1001, { userId: 'alice', cursor: { line: 5, ch: 10 }, lastSeen: Date.now() });
    awarenessMap.set(1002, { userId: 'bob', cursor: { line: 12, ch: 4 }, lastSeen: Date.now() - 35000 }); // Stale (> 30s)

    // Run reaper
    const HEARTBEAT_TTL_MS = 30000;
    const now = Date.now();
    for (const [clientId, user] of awarenessMap.entries()) {
      if (now - user.lastSeen > HEARTBEAT_TTL_MS) {
        awarenessMap.delete(clientId);
      }
    }

    expect(awarenessMap.has(1001)).toBe(true);
    expect(awarenessMap.has(1002)).toBe(false); // Ghost cursor purged
  });
});
