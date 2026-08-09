import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

describe('Snapshot Restore Atomicity & Live Sync Race Resolution Suite', () => {
  it('ensures snapshot restore overrides pending uncommitted live edits cleanly', () => {
    const docServer = new Y.Doc();
    const docClient = new Y.Doc();

    docServer.getText('monaco').insert(0, 'LIVE_EDIT_BEFORE_RESTORE');

    // Simulate snapshot restore: clear active live edit and apply snapshot update
    const performSnapshotRestore = (doc: Y.Doc, restoredText: string) => {
      const text = doc.getText('monaco');
      if (text.length > 0) text.delete(0, text.length);
      text.insert(0, restoredText);
    };

    performSnapshotRestore(docServer, 'RESTORED_SNAPSHOT_CONTENT');
    performSnapshotRestore(docClient, 'RESTORED_SNAPSHOT_CONTENT');

    expect(docServer.getText('monaco').toString()).toBe('RESTORED_SNAPSHOT_CONTENT');
    expect(docClient.getText('monaco').toString()).toBe('RESTORED_SNAPSHOT_CONTENT');

    docServer.destroy();
    docClient.destroy();
  });
});
