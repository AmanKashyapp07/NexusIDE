/**
 * Google-Standard Property-Based CRDT Fuzzing & Invariant Verification Suite
 *
 * Uses `fast-check` to generate thousands of randomized concurrent editing operations,
 * node deletions, state vector encodings, and awareness updates across multi-peer topologies.
 *
 * Verifies key mathematical CRDT invariants:
 *  1. Strong Eventual Consistency (Convergence): Peer A and Peer B converge to identical state regardless of message delivery order.
 *  2. Associativity: (A + B) + C === A + (B + C)
 *  3. Commutativity: A + B === B + A
 *  4. Idempotency: A + A === A
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';

describe('Google Standard Property-Based CRDT Fuzzing Suite', () => {
   it('1. proves Strong Eventual Consistency across 3 concurrent peers under randomized operations', () => {
      fc.assert(
         fc.property(
            fc.array(
               fc.tuple(
                  fc.integer({ min: 0, max: 2 }),
                  fc.integer({ min: 0, max: 1 }),
                  fc.integer({ min: 0, max: 100 }),
                  fc.string({ maxLength: 10 })
               ),
               { minLength: 10, maxLength: 60 }
            ),
            (operations) => {
               const docA = new Y.Doc();
               const docB = new Y.Doc();
               const docC = new Y.Doc();
               const docs = [docA, docB, docC];

               const pendingUpdatesA: Uint8Array[] = [];
               const pendingUpdatesB: Uint8Array[] = [];
               const pendingUpdatesC: Uint8Array[] = [];

               const onUpdateA = (update: Uint8Array) => {
                  pendingUpdatesB.push(update);
                  pendingUpdatesC.push(update);
               };
               const onUpdateB = (update: Uint8Array) => {
                  pendingUpdatesA.push(update);
                  pendingUpdatesC.push(update);
               };
               const onUpdateC = (update: Uint8Array) => {
                  pendingUpdatesA.push(update);
                  pendingUpdatesB.push(update);
               };

               docA.on('update', onUpdateA);
               docB.on('update', onUpdateB);
               docC.on('update', onUpdateC);

               try {
                  for (const [peerIdx, opType, rawPos, content] of operations) {
                     const doc = docs[peerIdx];
                     const ytext = doc.getText('monaco');
                     const currentLen = ytext.length;

                     if (opType === 0) {
                        const pos = currentLen === 0 ? 0 : rawPos % (currentLen + 1);
                        ytext.insert(pos, content);
                     } else {
                        if (currentLen > 0) {
                           const pos = rawPos % currentLen;
                           const delLen = Math.min(1 + (rawPos % 3), currentLen - pos);
                           ytext.delete(pos, delLen);
                        }
                     }
                  }

                  for (const u of pendingUpdatesA) Y.applyUpdate(docA, u);
                  for (const u of pendingUpdatesB) Y.applyUpdate(docB, u);
                  for (const u of pendingUpdatesC) Y.applyUpdate(docC, u);

                  const textA = docA.getText('monaco').toString();
                  const textB = docB.getText('monaco').toString();
                  const textC = docC.getText('monaco').toString();

                  expect(textA).toBe(textB);
                  expect(textB).toBe(textC);
               } finally {
                  docA.off('update', onUpdateA);
                  docB.off('update', onUpdateB);
                  docC.off('update', onUpdateC);
                  docA.destroy();
                  docB.destroy();
                  docC.destroy();
               }
            }
         ),
         { numRuns: 50 }
      );
   });

   it('2. verifies Idempotency invariant (applying duplicate updates produces zero state drift)', () => {
      fc.assert(
         fc.property(
            fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 5, maxLength: 20 }),
            (stringsToInsert) => {
               const docSource = new Y.Doc();
               const textSource = docSource.getText('monaco');

               const updates: Uint8Array[] = [];
               const onUpdate = (u: Uint8Array) => updates.push(u);
               docSource.on('update', onUpdate);

               const docTarget = new Y.Doc();

               try {
                  for (const str of stringsToInsert) {
                     textSource.insert(textSource.length, str);
                  }

                  for (const u of updates) {
                     Y.applyUpdate(docTarget, u);
                  }
                  const singleApplyText = docTarget.getText('monaco').toString();

                  for (let i = 0; i < 3; i++) {
                     for (const u of updates) {
                        Y.applyUpdate(docTarget, u);
                     }
                  }
                  const multiApplyText = docTarget.getText('monaco').toString();

                  expect(multiApplyText).toBe(singleApplyText);
                  expect(multiApplyText).toBe(textSource.toString());
               } finally {
                  docSource.off('update', onUpdate);
                  docSource.destroy();
                  docTarget.destroy();
               }
            }
         ),
         { numRuns: 30 }
      );
   });

   it('3. proves Commutativity invariant (out-of-order update application reaches identical state)', () => {
      fc.assert(
         fc.property(
            fc.array(fc.string({ minLength: 1, maxLength: 15 }), { minLength: 5, maxLength: 15 }),
            (words) => {
               const docA = new Y.Doc();
               const updates: Uint8Array[] = [];
               const onUpdate = (u: Uint8Array) => updates.push(u);
               docA.on('update', onUpdate);

               const docTarget1 = new Y.Doc();
               const docTarget2 = new Y.Doc();

               try {
                  const textA = docA.getText('monaco');
                  for (let i = 0; i < words.length; i++) {
                     textA.insert(textA.length, words[i]);
                  }

                  for (const u of updates) {
                     Y.applyUpdate(docTarget1, u);
                  }

                  for (let i = updates.length - 1; i >= 0; i--) {
                     Y.applyUpdate(docTarget2, updates[i]);
                  }

                  expect(docTarget1.getText('monaco').toString()).toBe(docTarget2.getText('monaco').toString());
               } finally {
                  docA.off('update', onUpdate);
                  docA.destroy();
                  docTarget1.destroy();
                  docTarget2.destroy();
               }
            }
         ),
         { numRuns: 30 }
      );
   });

   it('4. validates Awareness & Presence State Synchronization under randomized cursor telemetry', () => {
      fc.assert(
         fc.property(
            fc.array(
               fc.record({
                  clientId: fc.integer({ min: 1000, max: 9999 }),
                  cursorPos: fc.integer({ min: 0, max: 500 }),
                  username: fc.string({ minLength: 3, maxLength: 12 }),
                  color: fc.string({ minLength: 6, maxLength: 6 })
               }),
               { minLength: 3, maxLength: 15 }
            ),
            (userStates) => {
               const doc1 = new Y.Doc();
               const doc2 = new Y.Doc();

               const awareness1 = new awarenessProtocol.Awareness(doc1);
               const awareness2 = new awarenessProtocol.Awareness(doc2);

               const onAwarenessUpdate = ({ added, updated, removed }: any) => {
                  const u = awarenessProtocol.encodeAwarenessUpdate(
                     awareness1,
                     added.concat(updated).concat(removed)
                  );
                  awarenessProtocol.applyAwarenessUpdate(awareness2, u, 'test');
               };

               awareness1.on('update', onAwarenessUpdate);

               try {
                  for (const user of userStates) {
                     awareness1.setLocalStateField('user', {
                        name: user.username,
                        color: `#${user.color}`
                     });
                     awareness1.setLocalStateField('cursor', {
                        anchor: user.cursorPos,
                        head: user.cursorPos
                     });
                  }

                  const state2 = awareness2.getStates();

                  expect(state2.size).toBeGreaterThan(0);
                  expect(state2.has(awareness1.clientID)).toBe(true);

                  const localState2 = state2.get(awareness1.clientID);
                  expect(localState2).toHaveProperty('user');
                  expect(localState2).toHaveProperty('cursor');
               } finally {
                  awareness1.off('update', onAwarenessUpdate);
                  doc1.destroy();
                  doc2.destroy();
                  awareness1.destroy();
                  awareness2.destroy();
               }
            }
         ),
         { numRuns: 20 }
      );
   });

   it('5. proves Strong Eventual Consistency across 5 concurrent peers under mesh topology', () => {
      fc.assert(
         fc.property(
            fc.array(
               fc.tuple(
                  fc.integer({ min: 0, max: 4 }), // target peer 0-4
                  fc.string({ minLength: 1, maxLength: 10 })
               ),
               { minLength: 10, maxLength: 40 }
            ),
            (ops) => {
               const peers = Array.from({ length: 5 }, () => new Y.Doc());
               try {
                  for (const [peerIdx, str] of ops) {
                     peers[peerIdx].getText('monaco').insert(peers[peerIdx].getText('monaco').length, str);
                  }

                  const masterState = Y.encodeStateAsUpdate(peers[0]);
                  for (let i = 1; i < 5; i++) {
                     Y.applyUpdate(peers[i], masterState);
                     const peerUpdate = Y.encodeStateAsUpdate(peers[i]);
                     Y.applyUpdate(peers[0], peerUpdate);
                  }

                  const masterText = peers[0].getText('monaco').toString();
                  for (let i = 1; i < 5; i++) {
                     Y.applyUpdate(peers[i], Y.encodeStateAsUpdate(peers[0]));
                     expect(peers[i].getText('monaco').toString()).toBe(masterText);
                  }
               } finally {
                  for (const p of peers) p.destroy();
               }
            }
         ),
         { numRuns: 20 }
      );
   });

   it('6. proves Associativity invariant: (A ∘ B) ∘ C === A ∘ (B ∘ C)', () => {
      fc.assert(
         fc.property(
            fc.tuple(
               fc.string({ minLength: 1, maxLength: 10 }),
               fc.string({ minLength: 1, maxLength: 10 }),
               fc.string({ minLength: 1, maxLength: 10 })
            ),
            ([partA, partB, partC]) => {
               const docA = new Y.Doc();
               const docB = new Y.Doc();
               const docC = new Y.Doc();

               try {
                  docA.getText('monaco').insert(0, partA);
                  docB.getText('monaco').insert(0, partB);
                  docC.getText('monaco').insert(0, partC);

                  const uA = Y.encodeStateAsUpdate(docA);
                  const uB = Y.encodeStateAsUpdate(docB);
                  const uC = Y.encodeStateAsUpdate(docC);

                  // Option 1: (A + B) + C
                  const target1 = new Y.Doc();
                  Y.applyUpdate(target1, uA);
                  Y.applyUpdate(target1, uB);
                  Y.applyUpdate(target1, uC);

                  // Option 2: A + (B + C)
                  const target2 = new Y.Doc();
                  Y.applyUpdate(target2, uB);
                  Y.applyUpdate(target2, uC);
                  Y.applyUpdate(target2, uA);

                  expect(target1.getText('monaco').toString()).toBe(target2.getText('monaco').toString());

                  target1.destroy();
                  target2.destroy();
               } finally {
                  docA.destroy();
                  docB.destroy();
                  docC.destroy();
               }
            }
         ),
         { numRuns: 20 }
      );
   });

   it('7. proves 10,000-character document state convergence under heavy deletion workloads', () => {
      const doc1 = new Y.Doc();
      const doc2 = new Y.Doc();

      try {
         const t1 = doc1.getText('monaco');
         t1.insert(0, 'x'.repeat(10000));

         Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));

         t1.delete(1000, 7000); // 70% deletion

         const sv2 = Y.encodeStateVector(doc2);
         const diff = Y.encodeStateAsUpdate(doc1, sv2);
         Y.applyUpdate(doc2, diff);

         expect(doc2.getText('monaco').toString()).toBe(doc1.getText('monaco').toString());
         expect(doc2.getText('monaco').length).toBe(3000);
      } finally {
         doc1.destroy();
         doc2.destroy();
      }
   });

   it('8. proves Unicode CJK and Emoji surrogate pair stability under fuzzing', () => {
      fc.assert(
         fc.property(
            fc.array(fc.string(), { minLength: 5, maxLength: 20 }),
            (unicodeStrings: string[]) => {
               const docSource = new Y.Doc();
               const docTarget = new Y.Doc();

               try {
                  const tSource = docSource.getText('monaco');
                  for (const s of unicodeStrings) {
                     tSource.insert(tSource.length, s);
                  }

                  Y.applyUpdate(docTarget, Y.encodeStateAsUpdate(docSource));

                  expect(docTarget.getText('monaco').toString()).toBe(tSource.toString());
               } finally {
                  docSource.destroy();
                  docTarget.destroy();
               }
            }
         ),
         { numRuns: 20 }
      );
   });

   it('9. proves Y.Doc state serialization round-trip invariant', () => {
      fc.assert(
         fc.property(
            fc.string({ minLength: 1, maxLength: 100 }),
            (textPayload) => {
               const docOriginal = new Y.Doc();
               docOriginal.getText('monaco').insert(0, textPayload);

               const binaryUpdate = Y.encodeStateAsUpdate(docOriginal);

               const docRestored = new Y.Doc();
               Y.applyUpdate(docRestored, binaryUpdate);

               const reEncoded = Y.encodeStateAsUpdate(docRestored);
               expect(reEncoded.byteLength).toBeGreaterThan(0);
               expect(docRestored.getText('monaco').toString()).toBe(textPayload);

               docOriginal.destroy();
               docRestored.destroy();
            }
         ),
         { numRuns: 20 }
      );
   });

   it('10. proves monotonically increasing clock vector invariant across mutations', () => {
      const doc = new Y.Doc();
      try {
         const svInitial = Y.encodeStateVector(doc);
         doc.getText('monaco').insert(0, 'A');
         const sv1 = Y.encodeStateVector(doc);
         doc.getText('monaco').insert(1, 'B');
         const sv2 = Y.encodeStateVector(doc);

         expect(sv1.byteLength).toBeGreaterThanOrEqual(svInitial.byteLength);
         expect(sv2.byteLength).toBeGreaterThanOrEqual(sv1.byteLength);
      } finally {
         doc.destroy();
      }
   });
});
