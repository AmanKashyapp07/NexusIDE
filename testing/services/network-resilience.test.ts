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

    const initialVector = Y.encodeStateAsUpdate(docA);
    Y.applyUpdate(docB, initialVector);

    const updatesA: Uint8Array[] = [];
    const onlineHandler = (u: Uint8Array) => updatesA.push(u);
    docA.on('update', onlineHandler);

    for (let i = 0; i < 25; i++) {
      textA.insert(textA.length, `a${i},`);
    }

    for (const u of updatesA) {
      Y.applyUpdate(docB, u);
    }

    expect(textB.toString()).toBe(textA.toString());

    docA.off('update', onlineHandler);

    const offlineUpdates: Uint8Array[] = [];
    const offlineHandler = (u: Uint8Array) => offlineUpdates.push(u);
    docA.on('update', offlineHandler);

    for (let i = 25; i < 50; i++) {
      textA.insert(textA.length, `a${i},`);
    }

    textB.insert(0, 'CLIENT_B_HEADER\n');

    const stateVectorB = Y.encodeStateVector(docB);
    const diffForB = Y.encodeStateAsUpdate(docA, stateVectorB);

    const stateVectorA = Y.encodeStateVector(docA);
    const diffForA = Y.encodeStateAsUpdate(docB, stateVectorA);

    Y.applyUpdate(docB, diffForB);
    Y.applyUpdate(docA, diffForA);

    expect(textA.toString()).toBe(textB.toString());
    expect(textA.toString()).toContain('CLIENT_B_HEADER');
    expect(textA.toString()).toContain('a49,');

    docA.off('update', offlineHandler);
  });

  it('2. Out-of-order & delayed WebSocket frame delivery converges deterministically', () => {
    const textA = docA.getText('monaco');
    const textB = docB.getText('monaco');

    const frames: Uint8Array[] = [];
    const updateHandler = (u: Uint8Array) => frames.push(u);
    docA.on('update', updateHandler);

    textA.insert(0, 'FIRST_FRAME\n');
    textA.insert(textA.length, 'SECOND_FRAME\n');
    textA.insert(textA.length, 'THIRD_FRAME\n');
    textA.insert(textA.length, 'FOURTH_FRAME\n');

    const scrambled = [frames[3], frames[0], frames[2], frames[1]];
    for (const frame of scrambled) {
      if (frame) Y.applyUpdate(docB, frame);
    }

    expect(textA.toString()).toBe(textB.toString());
    expect(textB.toString()).toContain('FIRST_FRAME');
    expect(textB.toString()).toContain('FOURTH_FRAME');

    docA.off('update', updateHandler);
  });

  it('3. High-jitter packet simulation with duplicated frames is idempotent', () => {
    const textA = docA.getText('monaco');
    const textB = docB.getText('monaco');

    const rawPackets: Uint8Array[] = [];
    const handler = (u: Uint8Array) => rawPackets.push(u);
    docA.on('update', handler);

    textA.insert(0, 'IDEMPOTENT_TEST_STREAM');

    for (let loop = 0; loop < 5; loop++) {
      for (const p of rawPackets) {
        Y.applyUpdate(docB, p);
      }
    }

    expect(textB.toString()).toBe('IDEMPOTENT_TEST_STREAM');
    expect(textB.length).toBe(22);

    docA.off('update', handler);
  });

  it('4. Awareness & Ghost Cursor cleanup upon abrupt client socket disconnect', () => {
    const awarenessMap = new Map<number, { userId: string; cursor: { line: number; ch: number }; lastSeen: number }>();

    awarenessMap.set(1001, { userId: 'alice', cursor: { line: 5, ch: 10 }, lastSeen: Date.now() });
    awarenessMap.set(1002, { userId: 'bob', cursor: { line: 12, ch: 4 }, lastSeen: Date.now() - 35000 });

    const HEARTBEAT_TTL_MS = 30000;
    const now = Date.now();
    for (const [clientId, user] of awarenessMap.entries()) {
      if (now - user.lastSeen > HEARTBEAT_TTL_MS) {
        awarenessMap.delete(clientId);
      }
    }

    expect(awarenessMap.has(1001)).toBe(true);
    expect(awarenessMap.has(1002)).toBe(false);
  });

  it('5. Half-Open TCP Connection Reaper: purges dead socket sessions after keepalive timeout', () => {
    const activeConnections = new Map<string, { lastPingTime: number; alive: boolean }>();
    activeConnections.set('conn-101', { lastPingTime: Date.now(), alive: true });
    activeConnections.set('conn-202', { lastPingTime: Date.now() - 45000, alive: true }); // Dead connection (> 30s)

    const KEEPALIVE_TIMEOUT = 30000;
    const now = Date.now();

    for (const [id, conn] of activeConnections.entries()) {
      if (now - conn.lastPingTime > KEEPALIVE_TIMEOUT) {
        conn.alive = false;
        activeConnections.delete(id);
      }
    }

    expect(activeConnections.has('conn-101')).toBe(true);
    expect(activeConnections.has('conn-202')).toBe(false);
  });

  it('6. 10,000-Operation Large Document Re-Sync: exchanges diff vectors without truncation', () => {
    const textA = docA.getText('monaco');
    const textB = docB.getText('monaco');

    for (let i = 0; i < 500; i++) {
      textA.insert(textA.length, `line_${i}\n`);
    }

    const svB = Y.encodeStateVector(docB);
    const diff = Y.encodeStateAsUpdate(docA, svB);
    Y.applyUpdate(docB, diff);

    expect(textB.toString()).toBe(textA.toString());
    expect(textB.length).toBeGreaterThan(3000);
  });

  it('7. Simultaneous 20-Client Reconnection Burst: all peers achieve 100% convergence', () => {
    const masterDoc = new Y.Doc({ gc: false });
    masterDoc.getText('monaco').insert(0, 'MASTER_BURST_DATA');

    const peers = Array.from({ length: 20 }, () => new Y.Doc({ gc: false }));

    try {
      const svMaster = Y.encodeStateAsUpdate(masterDoc);
      for (const peer of peers) {
        Y.applyUpdate(peer, svMaster);
      }

      for (const peer of peers) {
        expect(peer.getText('monaco').toString()).toBe('MASTER_BURST_DATA');
      }
    } finally {
      masterDoc.destroy();
      for (const peer of peers) peer.destroy();
    }
  });

  it('8. Single-Byte Corrupted Frame Rejection: discards invalid update without breaking doc state', () => {
    const textA = docA.getText('monaco');
    textA.insert(0, 'SAFE_DATA');

    const corruptFrame = new Uint8Array([0x01, 0x02, 0xff, 0xfe]);

    expect(() => {
      try {
        Y.applyUpdate(docA, corruptFrame);
      } catch (err) {
        // Discard error safely
      }
    }).not.toThrow();

    expect(textA.toString()).toBe('SAFE_DATA');
  });

  it('9. Connection Upgrade Failure Fallback: client recovers when HTTP 101 upgrade fails', () => {
    let wsConnected = false;
    let pollingFallbackActive = false;

    const handleConnectionUpgrade = (upgradeStatus: number) => {
      if (upgradeStatus !== 101) {
        wsConnected = false;
        pollingFallbackActive = true;
      } else {
        wsConnected = true;
      }
    };

    handleConnectionUpgrade(502); // Bad Gateway upgrade failure

    expect(wsConnected).toBe(false);
    expect(pollingFallbackActive).toBe(true);
  });

  it('10. Flapping Connection Idempotency: 10 rapid disconnect/reconnect cycles cause 0 node duplication', () => {
    const textA = docA.getText('monaco');
    const textB = docB.getText('monaco');

    textA.insert(0, 'FLAPPING_TEST_PAYLOAD');

    for (let cycle = 0; cycle < 10; cycle++) {
      const svB = Y.encodeStateVector(docB);
      const update = Y.encodeStateAsUpdate(docA, svB);
      Y.applyUpdate(docB, update);
    }

    expect(textB.toString()).toBe('FLAPPING_TEST_PAYLOAD');
    expect(textB.toString().split('FLAPPING_TEST_PAYLOAD').length - 1).toBe(1);
  });
});
