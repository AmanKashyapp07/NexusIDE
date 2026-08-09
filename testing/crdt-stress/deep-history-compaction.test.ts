import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

describe('Deep History CRDT Delta Compaction Suite', () => {
  it('compacts 1,000 incremental update deltas into a single snapshot buffer under 15ms', () => {
    const doc = new Y.Doc({ gc: false });
    const text = doc.getText('monaco');

    const updates: Uint8Array[] = [];
    const handler = (u: Uint8Array) => updates.push(u);
    doc.on('update', handler);

    for (let i = 0; i < 1000; i++) {
      text.insert(text.length, `char_${i},`);
    }

    expect(updates.length).toBe(1000);

    const start = Date.now();
    const compactedState = Y.encodeStateAsUpdate(doc);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(15);
    expect(compactedState.byteLength).toBeGreaterThan(0);

    doc.off('update', handler);
    doc.destroy();
  });
});
