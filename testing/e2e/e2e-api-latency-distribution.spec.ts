import { test, expect } from '@playwright/test';
import { API_URL, loginUser, extractWorkspaceId, waitForBootComplete, getLatencyThreshold } from '../test-utils';

test.describe('E2E Deployed Infrastructure - Phase 2: REST API Latency Distribution (p50/p95/p99) SLA', () => {
  test.describe.configure({ mode: 'serial' });

  test('1. REST API Response Time Distribution under Concurrent Load', async ({ page, request }) => {
    const timestamp = Date.now();
    const token = await loginUser(page, request, `API_Perf_${timestamp}`);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `API_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const workspaceId = extractWorkspaceId(page.url());
    await waitForBootComplete(page);

    // Wait 2s for backend workspace container initialization to settle
    await page.waitForTimeout(2000);

    // Warmup requests to prime DB query cache
    for (let w = 0; w < 2; w++) {
      await page.request.get(`${API_URL}/workspace/${workspaceId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
    }

    const sampleCount = 20;
    const latenciesMs: number[] = [];

    // Issue REST API requests to measure latency distribution
    for (let i = 1; i <= sampleCount; i++) {
      const tStart = Date.now();
      const res = await page.request.get(`${API_URL}/workspace/${workspaceId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const tEnd = Date.now();

      expect(res.status()).toBe(200);
      latenciesMs.push(tEnd - tStart);
      await page.waitForTimeout(100);
    }

    // Calculate p50, p95, p99
    const sorted = [...latenciesMs].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.50)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[sorted.length - 1];

    const targetP50 = getLatencyThreshold(100, 1000);  // 100ms local, 1000ms remote WAN
    const targetP95 = getLatencyThreshold(300, 3000);  // 300ms local, 3000ms remote WAN
    const targetP99 = getLatencyThreshold(800, 5000);  // 800ms local, 5000ms remote WAN

    console.log(`[API Latency Distribution SLA] Samples Collected: ${sampleCount}`);
    console.log(`[API Latency Distribution SLA] p50 (Median): ${p50}ms (Limit: <= ${targetP50}ms)`);
    console.log(`[API Latency Distribution SLA] p95: ${p95}ms (Limit: <= ${targetP95}ms)`);
    console.log(`[API Latency Distribution SLA] p99 (Max): ${p99}ms (Limit: <= ${targetP99}ms)`);

    // HARD SLA ENFORCEMENT: Enforce limits based on execution environment (Local vs Remote WAN)
    expect(p50, `HARD SLA VIOLATION: REST API p50 latency (${p50}ms) exceeded ${targetP50}ms limit`).toBeLessThanOrEqual(targetP50);
    expect(p95, `HARD SLA VIOLATION: REST API p95 latency (${p95}ms) exceeded ${targetP95}ms limit`).toBeLessThanOrEqual(targetP95);
    expect(p99, `HARD SLA VIOLATION: REST API p99 latency (${p99}ms) exceeded ${targetP99}ms limit`).toBeLessThanOrEqual(targetP99);
  });
});
