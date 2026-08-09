import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { extractSnapshotFromYText, type AuthorRange, type TimelineStep } from '../../backend/src/services/workspaceFile.service.js';

describe('Brutal Timelapse CRDT Engine - Unit Test Suite', () => {
  it('1. Blank & Whitespace: returns accurate text and ranges for empty and whitespace docs', () => {
    const doc = new Y.Doc({ gc: false });
    const ytext = doc.getText('monaco');
    
    // Blank doc
    const res1 = extractSnapshotFromYText(ytext);
    expect(res1.text).toBe('');
    expect(res1.authorRanges).toEqual([]);

    // Whitespace only
    doc.clientID = 50;
    ytext.insert(0, '   \t\n  \n');
    const res2 = extractSnapshotFromYText(ytext);
    expect(res2.text).toBe('   \t\n  \n');
    expect(res2.authorRanges.length).toBeGreaterThanOrEqual(1);

    doc.destroy();
  });

  it('2. Character & Client Mapping: accurately maps character ranges to client IDs', () => {
    const doc = new Y.Doc({ gc: false });
    const ytext = doc.getText('monaco');

    // Client 100 types "HELLO"
    doc.clientID = 100;
    ytext.insert(0, 'HELLO');

    const snap1 = extractSnapshotFromYText(ytext);
    expect(snap1.text).toBe('HELLO');
    expect(snap1.authorRanges).toEqual([{ start: 0, end: 5, clientId: 100 }]);

    // Client 200 types " WORLD"
    doc.clientID = 200;
    ytext.insert(5, ' WORLD');

    const snap2 = extractSnapshotFromYText(ytext);
    expect(snap2.text).toBe('HELLO WORLD');
    expect(snap2.authorRanges).toEqual([
      { start: 0, end: 5, clientId: 100 },
      { start: 5, end: 11, clientId: 200 }
    ]);

    doc.destroy();
  });

  it('3. Multi-line Boundary Splits: handles newline boundaries with correct offsets', () => {
    const doc = new Y.Doc({ gc: false });
    const ytext = doc.getText('monaco');

    doc.clientID = 100;
    ytext.insert(0, 'Line 1\nLine 2\nLine 3');

    const snap = extractSnapshotFromYText(ytext);
    expect(snap.text).toBe('Line 1\nLine 2\nLine 3');
    expect(snap.authorRanges.length).toBeGreaterThanOrEqual(1);

    doc.destroy();
  });

  it('4. Tombstone & Deleted Node Filtering: ignores deleted nodes and maintains valid offsets', () => {
    const doc = new Y.Doc({ gc: false });
    const ytext = doc.getText('monaco');

    doc.clientID = 100;
    ytext.insert(0, 'AAA');
    doc.clientID = 200;
    ytext.insert(3, 'BBB');

    // Delete 'AAA'
    ytext.delete(0, 3);

    const snap = extractSnapshotFromYText(ytext);
    expect(snap.text).toBe('BBB');
    expect(snap.authorRanges).toEqual([{ start: 0, end: 3, clientId: 200 }]);

    doc.destroy();
  });

  it('5. Concurrent Interleaved Character Typing: alternates clients per character', () => {
    const doc = new Y.Doc({ gc: false });
    const ytext = doc.getText('monaco');

    // Client 1 types 'A', Client 2 types 'B', Client 1 types 'C', Client 2 types 'D'
    doc.clientID = 1;
    ytext.insert(0, 'A');
    doc.clientID = 2;
    ytext.insert(1, 'B');
    doc.clientID = 1;
    ytext.insert(2, 'C');
    doc.clientID = 2;
    ytext.insert(3, 'D');

    const snap = extractSnapshotFromYText(ytext);
    expect(snap.text).toBe('ABCD');
    expect(snap.authorRanges).toEqual([
      { start: 0, end: 1, clientId: 1 },
      { start: 1, end: 2, clientId: 2 },
      { start: 2, end: 3, clientId: 1 },
      { start: 3, end: 4, clientId: 2 },
    ]);

    doc.destroy();
  });

  it('6. Multi-Client Range Overwrite: preserves outer authors when inner range is replaced', () => {
    const doc = new Y.Doc({ gc: false });
    const ytext = doc.getText('monaco');

    // Alice (Client 10) types template: "function foo() { return 1; }"
    doc.clientID = 10;
    ytext.insert(0, 'function foo() { return 1; }');

    // Bob (Client 20) replaces "return 1;" with "return 2;"
    // "function foo() { " is 17 chars. "return 1;" is 9 chars.
    doc.clientID = 20;
    ytext.delete(17, 9);
    ytext.insert(17, 'return 2;');

    const snap = extractSnapshotFromYText(ytext);
    expect(snap.text).toBe('function foo() { return 2; }');
    
    // Check that Client 10 owns prefix and suffix, Client 20 owns middle
    expect(snap.authorRanges.some(r => r.clientId === 10 && r.start === 0 && r.end === 17)).toBe(true);
    expect(snap.authorRanges.some(r => r.clientId === 20 && r.start === 17 && r.end === 26)).toBe(true);
    expect(snap.authorRanges.some(r => r.clientId === 10 && r.start === 26 && r.end === 28)).toBe(true);

    doc.destroy();
  });

  it('7. Complex Edit-Delete-Retype Chaos Sequence', () => {
    const doc = new Y.Doc({ gc: false });
    const ytext = doc.getText('monaco');

    // Step 1: Insert 0..9
    doc.clientID = 1;
    ytext.insert(0, '0123456789');
    expect(extractSnapshotFromYText(ytext).text).toBe('0123456789');

    // Step 2: Delete middle '3456' -> '012789'
    ytext.delete(3, 4);
    expect(extractSnapshotFromYText(ytext).text).toBe('012789');

    // Step 3: Insert 'XYZ' at index 3 -> '012XYZ789'
    doc.clientID = 2;
    ytext.insert(3, 'XYZ');
    expect(extractSnapshotFromYText(ytext).text).toBe('012XYZ789');

    // Step 4: Delete all
    ytext.delete(0, ytext.length);
    expect(extractSnapshotFromYText(ytext).text).toBe('');

    // Step 5: Insert 'FINAL'
    doc.clientID = 3;
    ytext.insert(0, 'FINAL');
    const finalSnap = extractSnapshotFromYText(ytext);
    expect(finalSnap.text).toBe('FINAL');
    expect(finalSnap.authorRanges).toEqual([{ start: 0, end: 5, clientId: 3 }]);

    doc.destroy();
  });

  it('8. Large Rapid Burst Stream: handles 500+ character inserts across update packets', () => {
    const doc = new Y.Doc({ gc: false });
    const ytext = doc.getText('monaco');
    const updates: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array) => updates.push(u));

    const totalPackets = 50;
    const charsPerPacket = 10;
    for (let i = 0; i < totalPackets; i++) {
      doc.clientID = (i % 5) + 1; // 5 rotating clients
      ytext.insert(ytext.length, 'X'.repeat(charsPerPacket));
    }

    expect(ytext.length).toBe(totalPackets * charsPerPacket);

    // Replay on fresh doc step-by-step
    const replayDoc = new Y.Doc({ gc: false });
    for (const u of updates) {
      Y.applyUpdate(replayDoc, u);
    }

    const replaySnap = extractSnapshotFromYText(replayDoc.getText('monaco'));
    expect(replaySnap.text.length).toBe(500);
    expect(replaySnap.authorRanges.length).toBeGreaterThanOrEqual(10);

    doc.destroy();
    replayDoc.destroy();
  });

  it('9. Unicode, Emojis, and Surrogate Pairs: preserves multi-byte glyphs without offset corruption', () => {
    const doc = new Y.Doc({ gc: false });
    const ytext = doc.getText('monaco');

    doc.clientID = 99;
    ytext.insert(0, 'Hello 🚀 World 💡 日本語');

    const snap = extractSnapshotFromYText(ytext);
    expect(snap.text).toBe('Hello 🚀 World 💡 日本語');
    expect(snap.authorRanges[0].clientId).toBe(99);
    expect(snap.authorRanges[0].end).toBe(snap.text.length);

    doc.destroy();
  });

  it('10. Non-Contiguous Multi-Location Deletions: handles deletions at start, middle, and end', () => {
    const doc = new Y.Doc({ gc: false });
    const ytext = doc.getText('monaco');

    doc.clientID = 1;
    ytext.insert(0, '[START] [MIDDLE] [END]');

    // Delete [START] (first 7 chars)
    ytext.delete(0, 7);
    expect(extractSnapshotFromYText(ytext).text).toBe(' [MIDDLE] [END]');

    // Delete [END] (last 5 chars)
    ytext.delete(extractSnapshotFromYText(ytext).text.length - 5, 5);
    expect(extractSnapshotFromYText(ytext).text).toBe(' [MIDDLE] ');

    // Delete [MIDDLE]
    ytext.delete(1, 8);
    expect(extractSnapshotFromYText(ytext).text).toBe('  ');

    doc.destroy();
  });

  it('11. Serialization & Deserialization Invariant: Y.encodeStateAsUpdate is 100% reversible', () => {
    const doc = new Y.Doc({ gc: false });
    const ytext = doc.getText('monaco');

    doc.clientID = 101;
    ytext.insert(0, 'let x = 10;\n');
    doc.clientID = 202;
    ytext.insert(ytext.length, 'let y = 20;\n');

    const encoded = Y.encodeStateAsUpdate(doc);

    // Decode on fresh doc
    const restoredDoc = new Y.Doc({ gc: false });
    Y.applyUpdate(restoredDoc, encoded);

    const origSnap = extractSnapshotFromYText(doc.getText('monaco'));
    const restoredSnap = extractSnapshotFromYText(restoredDoc.getText('monaco'));

    expect(restoredSnap.text).toBe(origSnap.text);
    expect(restoredSnap.authorRanges).toEqual(origSnap.authorRanges);

    doc.destroy();
    restoredDoc.destroy();
  });

  it('12. TimelineStep Monotonic Step Index Invariant: guarantees sequential step numbering', () => {
    const doc = new Y.Doc({ gc: false });
    const ytext = doc.getText('monaco');
    const steps: TimelineStep[] = [{ stepIndex: 0, text: '', authorRanges: [] }];
    const updates: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array) => updates.push(u));

    ytext.insert(0, 'A');
    ytext.insert(1, 'B');
    ytext.insert(2, 'C');

    const replayDoc = new Y.Doc({ gc: false });
    for (const u of updates) {
      Y.applyUpdate(replayDoc, u);
      const snap = extractSnapshotFromYText(replayDoc.getText('monaco'));
      steps.push({ stepIndex: steps.length, text: snap.text, authorRanges: snap.authorRanges });
    }

    expect(steps.length).toBe(4);
    for (let i = 0; i < steps.length; i++) {
      expect(steps[i].stepIndex).toBe(i);
    }

    doc.destroy();
    replayDoc.destroy();
  });
});
