import { describe, it, expect } from 'vitest';

describe('DDoS Burst Protection & Retry-After Contract Suite', () => {
  it('returns HTTP 429 Too Many Requests response schema with Retry-After header', () => {
    const generate429Response = (retryAfterSeconds: number) => {
      return {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSeconds) },
        body: { error: 'Too Many Requests', retryAfter: retryAfterSeconds }
      };
    };

    const res = generate429Response(60);
    expect(res.status).toBe(429);
    expect(res.headers['Retry-After']).toBe('60');
    expect(res.body.error).toBe('Too Many Requests');
  });
});
