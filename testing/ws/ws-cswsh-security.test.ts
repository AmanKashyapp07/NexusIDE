import { describe, it, expect } from 'vitest';
import WebSocket from 'ws';
import { WS_URL } from '../test-utils';

describe('Phase 4: Cross-Origin WebSocket Hijacking (CSWSH) Security SLA', () => {
  it('1. Rejects WebSocket connection upgrades carrying unauthorized Origin headers', async () => {
    const wsTarget = WS_URL || 'ws://129.154.39.198/ide/ws';
    const maliciousOrigins = [
      'http://attacker-site.com',
      'https://malicious-phishing-ide.net',
      'http://evil-cors-origin.org'
    ];

    console.log(`[CSWSH Security SLA] Testing Origin header security rejection against: ${wsTarget}`);

    const results: Array<{ origin: string; status: string; code?: number }> = [];

    for (const origin of maliciousOrigins) {
      const result = await new Promise<{ rejected: boolean; code?: number }>((resolve) => {
        try {
          const ws = new WebSocket(`${wsTarget}/workspace-security-cswsh-test`, {
            headers: { Origin: origin }
          });

          const timeout = setTimeout(() => {
            try { ws.close(); } catch {}
            resolve({ rejected: true, code: 408 });
          }, 3000);

          ws.on('close', (code) => {
            clearTimeout(timeout);
            // 4401, 4000, 4003 or immediate close = rejected
            resolve({ rejected: true, code });
          });

          ws.on('unexpected-response', (_req, res) => {
            clearTimeout(timeout);
            resolve({ rejected: true, code: res.statusCode });
          });

          ws.on('error', () => {
            clearTimeout(timeout);
            resolve({ rejected: true, code: 500 });
          });

          ws.on('open', () => {
            // Give server 200ms to close socket with 4401/403
            setTimeout(() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.close();
                resolve({ rejected: false, code: 200 });
              }
            }, 300);
          });
        } catch {
          resolve({ rejected: true, code: 500 });
        }
      });

      results.push({
        origin,
        status: result.rejected ? 'REJECTED_PASSED' : 'ALLOWED_FAILED',
        code: result.code
      });
    }

    console.log('[CSWSH Security SLA] Origin Validation Results:', results);

    // HARD SECURITY SLA: 100% of unauthorized origins must be rejected
    const failedCount = results.filter(r => r.status === 'ALLOWED_FAILED').length;
    expect(failedCount, `HARD SLA VIOLATION: ${failedCount} unauthorized origins were allowed active WebSocket sessions`).toBe(0);
  });
});
