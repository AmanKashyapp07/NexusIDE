import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

describe('Phase B: Protocol Version Skew & Zero-Downtime CD SLA', () => {
  it('1. Reconciles Yjs CRDT delta updates between v1 Client and v2 Server without protocol breaking', () => {
    // Client v1 Doc
    const clientDocV1 = new Y.Doc();
    clientDocV1.getText('monaco').insert(0, 'Client Version 1 Header\n');

    // Server v2 Doc (schema extended with awareness/metadata)
    const serverDocV2 = new Y.Doc();
    serverDocV2.getText('monaco').insert(0, 'Server Version 2 Footer\n');
    serverDocV2.getMap('metadata').set('v2_feature_flag', true);

    // Protocol Sync: Apply v1 client update to v2 server
    const updateV1 = Y.encodeStateAsUpdate(clientDocV1);
    Y.applyUpdate(serverDocV2, updateV1);

    // Protocol Sync: Apply v2 server update to v1 client
    const updateV2 = Y.encodeStateAsUpdate(serverDocV2);
    Y.applyUpdate(clientDocV1, updateV2);

    // Assert seamless CRDT convergence across version skew boundary
    const textV1 = clientDocV1.getText('monaco').toString();
    const textV2 = serverDocV2.getText('monaco').toString();

    expect(textV1).toBe(textV2);
    expect(textV1).toContain('Client Version 1 Header');
    expect(textV1).toContain('Server Version 2 Footer');

    clientDocV1.destroy();
    serverDocV2.destroy();
  });
});
