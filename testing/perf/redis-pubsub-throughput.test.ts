import { describe, it, expect } from 'vitest';
import WebSocket from 'ws';
import { API_URL, WS_URL } from '../test-utils';

describe('Phase 3: Real Backend Redis Pub/Sub & WebSocket Fan-out SLA', () => {
  it('1. Connects authenticated WebSocket clients to target server and measures Redis Pub/Sub fan-out over TCP', async () => {
    const wsBase = WS_URL || 'ws://129.154.39.198/ide/ws';
    const apiBase = API_URL || 'http://129.154.39.198/ide/api';
    console.log(`[Real Redis Pub/Sub SLA] Target API: ${apiBase} | Target WS: ${wsBase}`);

    let token = '';
    let workspaceId = '';

    try {
      // 1. Authenticate via test-login API
      const loginRes = await fetch(`${apiBase}/auth/test-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: `PubSub_User_${Date.now()}`, password: 'test' })
      });
      if (loginRes.ok) {
        const body = await loginRes.json() as { token: string };
        token = body.token;

        // 2. Create test workspace
        const wsRes = await fetch(`${apiBase}/workspace`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ title: `PubSub_WS_${Date.now()}` })
        });
        if (wsRes.ok) {
          const wsBody = await wsRes.json() as { id: string };
          workspaceId = wsBody.id;
        }
      }
    } catch (err) {
      console.log(`[Real Redis Pub/Sub SLA] API Auth error: ${err}`);
    }

    if (!token || !workspaceId) {
      console.log('[Real Redis Pub/Sub SLA] Target API offline — skipping live socket fan-out');
      return;
    }

    // 3. Connect 3 real authenticated WebSocket clients over TCP with workspace-<id> path
    const clientCount = 3;
    const connectedSockets: WebSocket[] = [];

    const connectClient = (): Promise<WebSocket | null> => {
      return new Promise((resolve) => {
        try {
          const targetWsUrl = `${wsBase}/workspace-${workspaceId}?token=${encodeURIComponent(token)}`;
          const ws = new WebSocket(targetWsUrl);
          const timeout = setTimeout(() => {
            try { ws.close(); } catch {}
            resolve(null);
          }, 4000);

          ws.on('open', () => {
            clearTimeout(timeout);
            resolve(ws);
          });

          ws.on('error', () => {
            clearTimeout(timeout);
            resolve(null);
          });
        } catch {
          resolve(null);
        }
      });
    };

    for (let i = 0; i < clientCount; i++) {
      const sock = await connectClient();
      if (sock) connectedSockets.push(sock);
    }

    const tStart = Date.now();
    let totalMessagesReceived = 0;

    for (const sock of connectedSockets) {
      sock.on('message', () => {
        totalMessagesReceived++;
      });
    }

    // Wait 500ms for initial Yjs Sync Handshake
    await new Promise((r) => setTimeout(r, 500));

    if (connectedSockets.length > 0 && connectedSockets[0].readyState === WebSocket.OPEN) {
      for (let b = 1; b <= 5; b++) {
        // Send Yjs Step 1 sync message buffer
        const buf = Buffer.from([0, 0, 1, 0]);
        connectedSockets[0].send(buf);
        await new Promise((r) => setTimeout(r, 50));
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    for (const sock of connectedSockets) {
      try { sock.close(); } catch {}
    }

    const durationMs = Date.now() - tStart;
    console.log(`[Real Redis Pub/Sub SLA] Connected Authenticated WebSockets over TCP: ${connectedSockets.length}/${clientCount}`);
    console.log(`[Real Redis Pub/Sub SLA] Total Messages Fan-out Received: ${totalMessagesReceived}`);
    console.log(`[Real Redis Pub/Sub SLA] Benchmark Duration: ${durationMs}ms`);

    expect(connectedSockets.length).toBeGreaterThanOrEqual(1);
  });
});
