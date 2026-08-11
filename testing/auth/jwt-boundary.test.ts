import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { requireAuth, type AuthRequest } from '../../backend/src/middleware/auth.js';

function createMockRes() {
  const res: any = {};
  res.statusCode = 200;
  res.body = null;
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data: any) => {
    res.body = data;
    return res;
  };
  return res;
}

describe('OAuth & JWT Security Boundary Suite', () => {
  const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

  it('rejects tokens constructed with "alg: none" header attack', () => {
    // Construct forged token header with alg: none
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ id: 'attacker-id', username: 'attacker' })).toString('base64url');
    const unsignedToken = `${header}.${payload}.`;

    const req = { headers: { authorization: `Bearer ${unsignedToken}` }, query: {} } as any;
    const res = createMockRes();
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    requireAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid or expired token' });
    expect(nextCalled).toBe(false);
  });

  it('rejects tokens signed with an invalid or untrusted secret key', () => {
    const fakeToken = jwt.sign({ id: 'user-999', username: 'imposter' }, 'wrong_secret_key');

    const req = { headers: { authorization: `Bearer ${fakeToken}` }, query: {} } as any;
    const res = createMockRes();
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    requireAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid or expired token' });
    expect(nextCalled).toBe(false);
  });

  it('accepts valid JWT token from Authorization header and attaches user to request', () => {
    const validToken = jwt.sign({ id: 'user-777', username: 'alice' }, JWT_SECRET, { expiresIn: '1h' });

    const req = { headers: { authorization: `Bearer ${validToken}` }, query: {} } as AuthRequest;
    const res = createMockRes();
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    requireAuth(req, res, next);

    expect(nextCalled).toBe(true);
    expect(req.user).toBeDefined();
    expect(req.user?.id).toBe('user-777');
    expect(req.user?.username).toBe('alice');
  });

  it('extracts token from cookie header when Authorization header is absent', () => {
    const validToken = jwt.sign({ id: 'user-888', username: 'bob' }, JWT_SECRET, { expiresIn: '1h' });

    const req = {
      headers: { cookie: `nexus_ide_token=${validToken}; path=/` },
      query: {}
    } as AuthRequest;
    const res = createMockRes();
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    requireAuth(req, res, next);

    expect(nextCalled).toBe(true);
    expect(req.user?.id).toBe('user-888');
    expect(req.user?.username).toBe('bob');
  });
});
