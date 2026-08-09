import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

describe('Session Fixation & Token Rotation Suite', () => {
  it('rotates session token upon role escalation or privilege change', () => {
    const activeSessions = new Map<string, { userId: string; role: string }>();

    const createSession = (userId: string, role: string): string => {
      const token = crypto.randomBytes(32).toString('hex');
      activeSessions.set(token, { userId, role });
      return token;
    };

    const rotateSession = (oldToken: string, newRole: string): string => {
      const existing = activeSessions.get(oldToken);
      if (!existing) throw new Error('Invalid session token');
      activeSessions.delete(oldToken); // Invalidate old session token
      const newToken = crypto.randomBytes(32).toString('hex');
      activeSessions.set(newToken, { userId: existing.userId, role: newRole });
      return newToken;
    };

    const initialToken = createSession('user-101', 'editor');
    expect(activeSessions.has(initialToken)).toBe(true);

    const rotatedToken = rotateSession(initialToken, 'admin');

    // Verify old token is invalidated and new token is active with elevated role
    expect(activeSessions.has(initialToken)).toBe(false);
    expect(activeSessions.has(rotatedToken)).toBe(true);
    expect(activeSessions.get(rotatedToken)?.role).toBe('admin');
  });

  it('invalidates all active user session tokens upon password reset event', () => {
    const userTokensMap = new Map<string, Set<string>>();

    const registerToken = (userId: string, token: string) => {
      if (!userTokensMap.has(userId)) userTokensMap.set(userId, new Set());
      userTokensMap.get(userId)!.add(token);
    };

    const revokeAllUserSessions = (userId: string) => {
      userTokensMap.delete(userId);
    };

    registerToken('user-alice', 'token-device-mobile');
    registerToken('user-alice', 'token-device-laptop');
    expect(userTokensMap.get('user-alice')?.size).toBe(2);

    revokeAllUserSessions('user-alice');
    expect(userTokensMap.has('user-alice')).toBe(false);
  });
});
