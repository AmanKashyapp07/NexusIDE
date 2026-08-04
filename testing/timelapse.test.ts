import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { 
  buildFullFidelityTimeline, 
  snapshotFromYText, 
  downsampleActivity,
  offsetToPosition
} from '../frontend/src/hooks/useTimelapsePlayer';

describe('Timelapse Logic', () => {
  it('snapshotFromYText correctly extracts text and author ranges', () => {
    const ydoc = new Y.Doc({ gc: false });
    // Simulate user 1
    ydoc.clientID = 1;
    const ytext = ydoc.getText('monaco');
    ytext.insert(0, 'Hello');

    // Simulate user 2
    ydoc.clientID = 2;
    ytext.insert(5, ' World');

    const snap = snapshotFromYText(ytext);
    
    expect(snap.text).toBe('Hello World');
    expect(snap.authorRanges).toEqual([
      { start: 0, end: 5, clientId: 1 },
      { start: 5, end: 11, clientId: 2 }
    ]);
  });

  it('buildFullFidelityTimeline reconstructs snapshots and activity', () => {
    // We create some raw updates
    const updates: string[] = [];
    const ydoc = new Y.Doc({ gc: false });
    ydoc.clientID = 1;
    const ytext = ydoc.getText('monaco');

    // First update
    ydoc.on('update', (u: Uint8Array) => {
      updates.push(btoa(String.fromCharCode(...u)));
    });

    ytext.insert(0, 'A');
    ytext.insert(1, 'B');
    ytext.insert(2, 'C');

    const timeline = buildFullFidelityTimeline(updates);

    expect(timeline.snapshots.length).toBe(4); // initial empty + 3 inserts
    expect(timeline.snapshots[3].text).toBe('ABC');
    expect(timeline.activity.length).toBe(4);
    expect(timeline.allClientIds).toEqual([1]);
  });

  it('downsampleActivity buckets correctly', () => {
    const activity = [1, 2, 3, 4, 5, 6, 7, 8];
    // 8 items, into 4 buckets. Size = 2 per bucket.
    // B0: 1+2 = 3
    // B1: 3+4 = 7
    // B2: 5+6 = 11
    // B3: 7+8 = 15
    // Max = 15.
    // Normalized: 3/15, 7/15, 11/15, 15/15 -> 0.2, 0.466, 0.733, 1
    
    const buckets = downsampleActivity(activity, 4);
    
    expect(buckets.length).toBe(4);
    expect(buckets[0]).toBeCloseTo(0.2);
    expect(buckets[3]).toBe(1);
  });

  it('offsetToPosition calculates monaco 1-based coordinates accurately', () => {
    const text = 'Line1\nLine2\nLine3';
    // L1: 0-5
    // L2: 6-11
    // L3: 12-17
    
    expect(offsetToPosition(text, 0)).toEqual({ lineNumber: 1, column: 1 });
    expect(offsetToPosition(text, 2)).toEqual({ lineNumber: 1, column: 3 });
    expect(offsetToPosition(text, 6)).toEqual({ lineNumber: 2, column: 1 }); // Start of Line2
    expect(offsetToPosition(text, 12)).toEqual({ lineNumber: 3, column: 1 }); // Start of Line3
    expect(offsetToPosition(text, 17)).toEqual({ lineNumber: 3, column: 6 }); // End of Line3
  });
});
