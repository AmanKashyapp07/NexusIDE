import { describe, it, expect } from 'vitest';

describe('Tenant Isolation Redis Key Scoping Suite', () => {
  it('prevents cross-workspace Redis key access by enforcing workspaceId key prefix scoping', () => {
    const redisStore = new Map<string, string>();

    const setScopedKey = (workspaceId: string, key: string, value: string) => {
      redisStore.set(`ws:${workspaceId}:${key}`, value);
    };

    const getScopedKey = (workspaceId: string, key: string) => {
      return redisStore.get(`ws:${workspaceId}:${key}`) || null;
    };

    setScopedKey('ws-101', 'presence:user-alice', 'online');
    setScopedKey('ws-202', 'presence:user-alice', 'offline');

    expect(getScopedKey('ws-101', 'presence:user-alice')).toBe('online');
    expect(getScopedKey('ws-202', 'presence:user-alice')).toBe('offline');
    expect(getScopedKey('ws-303', 'presence:user-alice')).toBeNull();
  });
});
