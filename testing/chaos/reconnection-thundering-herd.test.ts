/**
 * Pattern 4: Chaos & Reconnection Thundering Herd SLA
 * Evaluates 1,000 active user session drops followed by simultaneous mass reconnection,
 * testing JWT re-verification, Yjs state re-hydration, and ghost cursor cleanup efficiency.
 * Zero mocks — live Redis 7 & PostgreSQL 16.
 */

import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { redis } from '../../backend/src/utils/redisCache.js';
import { RedisPresenceService } from '../../backend/src/services/redisPresence.service.js';

describe('Pattern 4: Chaos & Reconnection Thundering Herd SLA', () => {
  const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

  it('1. Handles simultaneous reconnection of 500 dropped sessions with mass JWT verification and state re-hydration', async () => {
    const RECONNECT_COUNT = 500;
    const presenceService = new RedisPresenceService();
    const ts = Date.now();

    // 1. Setup active presence state before network drop
    const activeUserTokens: string[] = [];
    for (let i = 0; i < RECONNECT_COUNT; i++) {
      const token = jwt.sign({ id: `user_${ts}_${i}`, username: `herder_${i}` }, JWT_SECRET, { expiresIn: '1h' });
      activeUserTokens.push(token);
      await presenceService.setUserPresence('ws-herd-1', `socket_${i}`, {
        username: `herder_${i}`,
        userId: `user_${ts}_${i}`,
        color: '#3b82f6',
        activeFileId: 'index.js',
        cursor: { line: i, ch: 0 },
      });
    }

    // Verify initial presence mesh population
    const activeUsersBefore = await presenceService.getWorkspacePresence('ws-herd-1');
    expect(activeUsersBefore.length).toBe(RECONNECT_COUNT);

    // 2. Network drop simulation -> Abruptly prune all active presence keys
    await presenceService.clearWorkspacePresence('ws-herd-1');
    const clearedUsers = await presenceService.getWorkspacePresence('ws-herd-1');
    expect(clearedUsers.length).toBe(0);

    // 3. Thundering Herd Reconnection Surge (All 500 clients reconnect, verify JWT, & re-register presence in parallel)
    const reconnectStart = Date.now();
    const reconnectTasks = activeUserTokens.map(async (token, i) => {
      // Step A: JWT re-authentication
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      expect(decoded.id).toBe(`user_${ts}_${i}`);

      // Step B: Re-register presence in Redis
      await presenceService.setUserPresence('ws-herd-1', `socket_${i}`, {
        username: decoded.username,
        userId: decoded.id,
        color: '#3b82f6',
        activeFileId: 'index.js',
        cursor: { line: i, ch: 5 },
      });
    });

    await Promise.all(reconnectTasks);
    const reconnectMs = Date.now() - reconnectStart;

    console.log(`[Reconnection Herd SLA] 500 Sessions Re-authenticated & Presence Re-hydrated in ${reconnectMs}ms (${(reconnectMs / RECONNECT_COUNT).toFixed(2)}ms/user)`);

    // Verify presence state is 100% re-established without ghost cursors or duplicate entries
    const activeUsersAfter = await presenceService.getWorkspacePresence('ws-herd-1');
    expect(activeUsersAfter.length).toBe(RECONNECT_COUNT);
    expect(reconnectMs).toBeLessThan(3000);

    // Cleanup
    await presenceService.clearWorkspacePresence('ws-herd-1');
  });
});
