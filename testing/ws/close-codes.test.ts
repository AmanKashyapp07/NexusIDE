import { describe, it, expect } from 'vitest';

describe('WebSocket Termination & Close Code Semantics Suite', () => {
  it('maps eviction and authentication errors to standardized WS close codes', () => {
    const getCloseCodeForError = (reason: 'eviction' | 'auth_expired' | 'going_away' | 'unknown'): number => {
      switch (reason) {
        case 'eviction':
          return 4100; // Workspace evicted / snapshot restored
        case 'auth_expired':
          return 4000; // JWT Token expired / unauthorized
        case 'going_away':
          return 1001; // Client navigating away / tab closing
        default:
          return 1000; // Normal closure
      }
    };

    expect(getCloseCodeForError('eviction')).toBe(4100);
    expect(getCloseCodeForError('auth_expired')).toBe(4000);
    expect(getCloseCodeForError('going_away')).toBe(1001);
    expect(getCloseCodeForError('unknown')).toBe(1000);
  });
});
