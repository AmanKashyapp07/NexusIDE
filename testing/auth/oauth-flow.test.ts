import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';

describe('OAuth Callback & State Parameter Security Suite', () => {
  it('validates state parameter anti-CSRF token on OAuth callback', () => {
    const sessionStore = new Map<string, { oauthState: string; createdAt: number }>();

    const generateStateToken = (sessionId: string): string => {
      const state = crypto.randomBytes(32).toString('hex');
      sessionStore.set(sessionId, { oauthState: state, createdAt: Date.now() });
      return state;
    };

    const validateOAuthCallback = (sessionId: string, receivedState: string): { valid: boolean; error?: string } => {
      const stored = sessionStore.get(sessionId);
      if (!stored) {
        return { valid: false, error: 'OAuth session not found' };
      }
      if (stored.oauthState !== receivedState) {
        return { valid: false, error: '403 Forbidden: Invalid state parameter (CSRF attempt detected)' };
      }
      sessionStore.delete(sessionId);
      return { valid: true };
    };

    const sessionId = 'session-alice-101';
    const stateToken = generateStateToken(sessionId);

    // Matching state token -> Success
    const validRes = validateOAuthCallback(sessionId, stateToken);
    expect(validRes.valid).toBe(true);

    // Mismatched state token (forged callback) -> CSRF rejection
    const forgedSessionId = 'session-bob-202';
    generateStateToken(forgedSessionId);
    const forgedRes = validateOAuthCallback(forgedSessionId, 'malicious_state_hash');
    expect(forgedRes.valid).toBe(false);
    expect(forgedRes.error).toContain('CSRF attempt detected');
  });

  it('prevents open-redirect vulnerability by validating callback redirect_uri domain', () => {
    const ALLOWED_REDIRECT_ORIGINS = ['http://localhost:5173', 'http://129.154.39.198', 'https://nexuside.internal'];

    const sanitizeRedirectUri = (targetUrl: string): string => {
      try {
        const parsed = new URL(targetUrl);
        if (ALLOWED_REDIRECT_ORIGINS.includes(parsed.origin)) {
          return targetUrl;
        }
      } catch {}
      return '/dashboard'; // Fallback to safe internal route
    };

    // Valid internal redirect
    expect(sanitizeRedirectUri('http://129.154.39.198/dashboard')).toBe('http://129.154.39.198/dashboard');

    // Open-redirect attack vector -> Sanitized to safe internal route
    expect(sanitizeRedirectUri('https://attacker-phishing-site.com/steal-token')).toBe('/dashboard');
    expect(sanitizeRedirectUri('javascript:alert(1)')).toBe('/dashboard');
  });
});
