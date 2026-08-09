import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

describe('Cross-Pod Redis Fan-Out State Sync Suite', () => {
  it('relays document updates across simulated multi-pod instances via Redis PubSub channel', () => {
    const podADoc = new Y.Doc();
    const podBDoc = new Y.Doc();

    const redisChannelBus: Uint8Array[] = [];

    // Pod A publishes update to Redis PubSub bus
    podADoc.on('update', (u: Uint8Array) => {
      redisChannelBus.push(u);
    });

    podADoc.getText('monaco').insert(0, 'Cross-Pod Synchronized Edit');

    expect(redisChannelBus.length).toBe(1);

    // Pod B receives payload from Redis PubSub bus and applies to local Y.Doc
    for (const msg of redisChannelBus) {
      Y.applyUpdate(podBDoc, msg);
    }

    expect(podBDoc.getText('monaco').toString()).toBe('Cross-Pod Synchronized Edit');

    podADoc.destroy();
    podBDoc.destroy();
  });
});
