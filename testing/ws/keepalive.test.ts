import { describe, it, expect } from 'vitest';

describe('WebSocket KeepAlive & Stale Connection Enforcement Suite', () => {
  it('detects un-acknowledged heartbeat pings and closes stale socket (code 4001)', () => {
    const clients = new Map<string, { lastPongTime: number; isAlive: boolean; closeCode?: number }>();

    clients.set('client-active', { lastPongTime: Date.now(), isAlive: true });
    clients.set('client-stale', { lastPongTime: Date.now() - 40000, isAlive: true }); // Stale (> 30s)

    const HEARTBEAT_INTERVAL_MS = 30000;
    const now = Date.now();

    for (const [id, client] of clients.entries()) {
      if (now - client.lastPongTime > HEARTBEAT_INTERVAL_MS) {
        client.isAlive = false;
        client.closeCode = 4001; // Heartbeat Timeout Close Code
        clients.delete(id);
      }
    }

    expect(clients.has('client-active')).toBe(true);
    expect(clients.has('client-stale')).toBe(false);
  });

  it('updates lastPongTime upon receiving client PONG frame response', () => {
    const client = { lastPongTime: Date.now() - 15000, isAlive: true };

    const handlePongMessage = () => {
      client.lastPongTime = Date.now();
      client.isAlive = true;
    };

    handlePongMessage();
    expect(Date.now() - client.lastPongTime).toBeLessThan(100);
  });
});
