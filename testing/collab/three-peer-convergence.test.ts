import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

describe('Asymmetric 3-Peer CRDT Convergence Suite', () => {
  it('converges 3 peers with asymmetric network delays and concurrent edits to identical text', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const docC = new Y.Doc();

    try {
      docA.getText('monaco').insert(0, 'Peer A Header\n');
      docB.getText('monaco').insert(0, 'Peer B Section\n');
      docC.getText('monaco').insert(0, 'Peer C Footer\n');

      const uA = Y.encodeStateAsUpdate(docA);
      const uB = Y.encodeStateAsUpdate(docB);
      const uC = Y.encodeStateAsUpdate(docC);

      // Asymmetric application order
      // Node A receives B then C
      Y.applyUpdate(docA, uB);
      Y.applyUpdate(docA, uC);

      // Node B receives C then A
      Y.applyUpdate(docB, uC);
      Y.applyUpdate(docB, uA);

      // Node C receives A then B
      Y.applyUpdate(docC, uA);
      Y.applyUpdate(docC, uB);

      const textA = docA.getText('monaco').toString();
      const textB = docB.getText('monaco').toString();
      const textC = docC.getText('monaco').toString();

      expect(textA).toBe(textB);
      expect(textB).toBe(textC);
      expect(textA.length).toBeGreaterThan(0);
    } finally {
      docA.destroy();
      docB.destroy();
      docC.destroy();
    }
  });
});
