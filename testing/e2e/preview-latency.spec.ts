import { test, expect } from '@playwright/test';
import {
  API_URL,
  loginUser,
  waitForBootComplete,
  waitForSocketConnect,
  createFile,
  extractWorkspaceId,
  waitForTerminalText,
  calculateLatencyStats,
  getLatencyThreshold,
  printLatencyReport,
} from '../test-utils.js';

/**
 * Purpose: Live Preview Proxy HTTP Response Latency SLA Suite.
 * Measures container dev server proxy response latency over 20 requests (discarding warmup request),
 * isolating backend proxy network response SLA from browser rendering time.
 */

test.describe('Live Preview Proxy Latency SLA Suite', () => {
  test('live preview proxy HTTP response SLA satisfies p95 and average thresholds', async ({ page, request }) => {
    const timestamp = Date.now();
    const username = `PreviewSLAUser_${timestamp}`;
    const token = await loginUser(page, request, username);

    // Create a new workspace
    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Preview_SLA_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const workspaceId = extractWorkspaceId(page.url());
    await waitForBootComplete(page);
    await waitForSocketConnect(page);

    // Create an index.html file in container
    await createFile(page, 'index.html');

    // Launch python server in container
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await terminalTextarea.waitFor({ state: 'attached', timeout: 30000 });
    await terminalTextarea.focus();
    await page.keyboard.press('Enter');
    await waitForTerminalText(page, 'sandbox:~#', 30000);

    await page.keyboard.type(`echo "<h1>SLA Test</h1>" > index.html && python3 -m http.server 3000 &`, { delay: 10 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);

    // Measure proxy HTTP GET response roundtrips over 20 sequential requests
    const previewUrl = `${API_URL}/workspace/${workspaceId}/preview/`;
    const numRequests = 20;
    const rawLatencies: number[] = [];

    for (let i = 0; i < numRequests; i++) {
      const t0 = performance.now();
      const res = await request.get(previewUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const t1 = performance.now();
      expect(res.status()).toBe(200);

      // High-resolution network response roundtrip duration
      const elapsed = t1 - t0;
      rawLatencies.push(elapsed);

      await page.waitForTimeout(30);
    }

    // Discard the first request as "warmup" to eliminate cold start bias
    const samples = rawLatencies.slice(1);

    // Calculate statistical metrics (Min, Median, p95, Max, Average)
    const stats = calculateLatencyStats(samples);
    const targetThresholdMs = getLatencyThreshold(150, 600); // 150ms locally, 600ms WAN/CI target buffer

    // Print clean, structured console summary
    printLatencyReport('Live Preview Proxy HTTP Response', stats, targetThresholdMs);

    // Assert p95 and average SLA thresholds
    expect(stats.p95).toBeLessThanOrEqual(targetThresholdMs);
    expect(stats.avg).toBeLessThanOrEqual(targetThresholdMs);
  });
});
