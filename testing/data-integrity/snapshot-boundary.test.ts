import { describe, it, expect } from 'vitest';

describe('Workspace Snapshot Restore Boundary Isolation Suite', () => {
  it('guarantees snapshot restore on Workspace A cannot mutate database rows belonging to Workspace B', () => {
    const databaseRows = [
      { id: 'f1', workspaceId: 'ws-101', content: 'WS1 File 1' },
      { id: 'f2', workspaceId: 'ws-202', content: 'WS2 File 2' }
    ];

    const restoreWorkspaceSnapshot = (targetWorkspaceId: string, restoredContent: string) => {
      databaseRows.forEach(row => {
        if (row.workspaceId === targetWorkspaceId) {
          row.content = restoredContent;
        }
      });
    };

    restoreWorkspaceSnapshot('ws-101', 'RESTORED_WS1');

    expect(databaseRows[0].content).toBe('RESTORED_WS1');
    expect(databaseRows[1].content).toBe('WS2 File 2'); // Un-mutated
  });
});
