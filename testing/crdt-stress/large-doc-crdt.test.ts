import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

describe('Extremely Large Document CRDT Stress Suite', () => {
  it('converges 100,000-character document across 3 peers in < 50ms', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();
    const doc3 = new Y.Doc();

    try {
      const text1 = doc1.getText('monaco');
      text1.insert(0, 'A'.repeat(50000));
      text1.insert(25000, 'B'.repeat(50000));

      const start = Date.now();
      const update1 = Y.encodeStateAsUpdate(doc1);
      Y.applyUpdate(doc2, update1);
      Y.applyUpdate(doc3, update1);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(50);
      expect(doc2.getText('monaco').length).toBe(100000);
      expect(doc3.getText('monaco').length).toBe(100000);
    } finally {
      doc1.destroy();
      doc2.destroy();
      doc3.destroy();
    }
  });
});
