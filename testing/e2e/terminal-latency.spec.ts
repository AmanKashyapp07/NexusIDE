import { test, expect } from '@playwright/test';
import {
  WS_URL,
  loginUser,
  waitForBootComplete,
  waitForSocketConnect,
  extractWorkspaceId,
  calculateLatencyStats,
  getLatencyThreshold,
  printLatencyReport,
} from '../test-utils.js';

/**
 * Purpose: Robust Interactive Terminal Keystroke Echo & WebSocket Roundtrip SLA Suite.
 * Measures in-browser WebSocket message roundtrips (WebSocket.send to message event)
 * across a batch of at least 30 keystrokes/frames, computing p95 and median (p50) latency.
 */

test.describe('Terminal Interactive Latency SLA Suite', () => {
  test('terminal keystroke echo roundtrip SLA satisfies p95 and p50 thresholds', async ({ page, request }) => {
    const timestamp = Date.now();
    const username = `TerminalSLAUser_${timestamp}`;
    const token = await loginUser(page, request, username);

    // Create a new workspace
    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Terminal_SLA_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const workspaceId = extractWorkspaceId(page.url());
    await waitForBootComplete(page);
    await waitForSocketConnect(page);

    // Construct direct WebSocket URL for terminal streaming
    const terminalWsUrl = `${WS_URL}/terminal/${workspaceId}?token=${token}`;

    // Execute in-browser microsecond-accurate WebSocket frame roundtrip measurement batch (35 samples)
    const numSamples = 35;
    const samples = await page.evaluate(async ({ wsEndpoint, count }) => {
      return new Promise<number[]>((resolve, reject) => {
        const latencies: number[] = [];
        const ws = new WebSocket(wsEndpoint);
        ws.binaryType = 'arraybuffer';

        let currentT0 = 0;
        let sampleCount = 0;
        let pending = false;

        ws.onopen = () => {
          sendNext();
        };

        const sendNext = () => {
          if (sampleCount >= count + 1) {
            ws.close();
            // Discard 1st warmup sample to eliminate cold-start WebSocket handshake spike
            resolve(latencies.slice(1));
            return;
          }
          pending = true;
          currentT0 = performance.now();
          ws.send('a');
        };

        ws.onmessage = () => {
          if (pending) {
            const elapsed = performance.now() - currentT0;
            pending = false;
            latencies.push(elapsed);
            sampleCount++;
            setTimeout(sendNext, 15);
          }
        };

        ws.onerror = () => {
          reject(new Error('Terminal WebSocket connection error during latency benchmark'));
        };

        setTimeout(() => {
          if (latencies.length > 0) {
            ws.close();
            resolve(latencies);
          } else {
            reject(new Error('Terminal WebSocket latency test timed out without receiving frames'));
          }
        }, 20000);
      });
    }, { wsEndpoint: terminalWsUrl, count: numSamples });

    // Calculate statistical metrics (Min, Median, p95, Max, Average)
    const stats = calculateLatencyStats(samples);
    const targetThresholdMs = getLatencyThreshold(30, 500); // 30ms locally, 500ms WAN/CI target buffer

    // Print clean, structured console summary
    printLatencyReport('Terminal Interactive WebSocket Echo', stats, targetThresholdMs);

    // Assert p95 and median (p50) SLA thresholds
    expect(stats.p95).toBeLessThanOrEqual(targetThresholdMs);
    expect(stats.median).toBeLessThanOrEqual(targetThresholdMs);
  });
});
