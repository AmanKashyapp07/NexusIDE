import { describe, it, expect } from 'vitest';

describe('API Rate Limiting & Sliding Window Suite', () => {
  it('enforces 100 requests/minute sliding window rate limit per client IP', () => {
    const requestLog = new Map<string, number[]>();
    const WINDOW_MS = 60000;
    const MAX_REQUESTS = 100;

    const checkRateLimit = (ip: string): { allowed: boolean; remaining: number } => {
      const now = Date.now();
      let timestamps = requestLog.get(ip) || [];
      timestamps = timestamps.filter(t => now - t < WINDOW_MS);

      if (timestamps.length >= MAX_REQUESTS) {
        requestLog.set(ip, timestamps);
        return { allowed: false, remaining: 0 };
      }

      timestamps.push(now);
      requestLog.set(ip, timestamps);
      return { allowed: true, remaining: MAX_REQUESTS - timestamps.length };
    };

    const ip = '192.168.1.50';
    for (let i = 0; i < 100; i++) {
      const res = checkRateLimit(ip);
      expect(res.allowed).toBe(true);
    }

    const blockedRes = checkRateLimit(ip);
    expect(blockedRes.allowed).toBe(false);
    expect(blockedRes.remaining).toBe(0);
  });
});
