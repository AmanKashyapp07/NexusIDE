import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';

describe('Awareness Reconnection & State Resynchronization Suite', () => {
  it('resynchronizes awareness cursor states cleanly after temporary socket disconnection', () => {
    const docServer = new Y.Doc();
    const docClient = new Y.Doc();

    const serverAwareness = new awarenessProtocol.Awareness(docServer);
    const clientAwareness = new awarenessProtocol.Awareness(docClient);

    serverAwareness.setLocalStateField('user', { name: 'Alice', color: '#ff0000' });
    serverAwareness.setLocalStateField('cursor', { anchor: 42, head: 42 });

    // Initial sync
    const initUpdate = awarenessProtocol.encodeAwarenessUpdate(
      serverAwareness,
      [serverAwareness.clientID]
    );
    awarenessProtocol.applyAwarenessUpdate(clientAwareness, initUpdate, 'test');

    expect(clientAwareness.getStates().get(serverAwareness.clientID)).toBeDefined();

    // Simulate disconnection -> client drops server state
    awarenessProtocol.removeAwarenessStates(clientAwareness, [serverAwareness.clientID], 'disconnect');
    expect(clientAwareness.getStates().get(serverAwareness.clientID)).toBeUndefined();

    // Reconnection -> re-broadcast server awareness state
    serverAwareness.setLocalStateField('cursor', { anchor: 42, head: 42 });
    const reconnectUpdate = awarenessProtocol.encodeAwarenessUpdate(
      serverAwareness,
      [serverAwareness.clientID]
    );
    awarenessProtocol.applyAwarenessUpdate(clientAwareness, reconnectUpdate, 'reconnect');

    const restoredState = clientAwareness.getStates().get(serverAwareness.clientID);
    expect(restoredState).toBeDefined();
    expect(restoredState?.user?.name).toBe('Alice');

    docServer.destroy();
    docClient.destroy();
    serverAwareness.destroy();
    clientAwareness.destroy();
  });
});
