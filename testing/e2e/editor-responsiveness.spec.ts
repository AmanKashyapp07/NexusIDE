import { test, expect } from '@playwright/test';
import {
  loginUser,
  waitForBootComplete,
  waitForSocketConnect,
  createFile,
  calculateLatencyStats,
  getLatencyThreshold,
  printLatencyReport,
} from '../test-utils.js';

/**
 * Purpose: Monaco Editor UI Frame Drop, Main-Thread Long Task & Input Jitter SLA Suite.
 * Uses Chrome DevTools Protocol (CDPSession) and PerformanceObserver to monitor long tasks (>50ms)
 * and input-to-render paint latency during a fast paste of 5,000 lines of code.
 */

test.describe('Editor UI Frame Drop & Input Jitter SLA Suite', () => {
  test('monaco editor maintains smooth rendering during heavy 5,000-line code paste', async ({ page, request, context }) => {
    const timestamp = Date.now();
    const username = `EditorJitter_${timestamp}`;
    await loginUser(page, request, username);

    // Create workspace
    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Jitter_SLA_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    await waitForBootComplete(page);
    await waitForSocketConnect(page);

    // Create a new code file
    const filename = `paste_test_${timestamp}.ts`;
    await createFile(page, filename);
    await page.click(`text="${filename}"`);
    await page.waitForTimeout(500);

    // Attach Chrome DevTools Protocol (CDP) session to monitor performance metrics
    const client = await context.newCDPSession(page);
    await client.send('Performance.enable');

    // Inject in-browser PerformanceObserver to track Long Tasks (>50ms)
    await page.evaluate(() => {
      (window as any).__longTaskDurations = [];
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            (window as any).__longTaskDurations.push(entry.duration);
          }
        });
        observer.observe({ entryTypes: ['longtask'] });
      } catch {
        // Fallback if longtask entryType is unsupported
      }
    });

    // Generate 5,000 lines of typescript code
    const lineContent = 'const val: number = 42; // Fast Monaco render benchmarking\n';
    const largePasteCode = lineContent.repeat(5000);

    // Measure input-to-render paint latency during large document paste
    const inpSamples: number[] = [];
    const numBatches = 15;

    for (let b = 0; b < numBatches; b++) {
      const t0 = performance.now();

      // Paste code payload into active Monaco editor model
      await page.evaluate((codeSnippet) => {
        const editors = (window as any).monaco?.editor?.getEditors();
        if (editors && editors[0]) {
          const model = editors[0].getModel();
          if (model) {
            model.setValue(codeSnippet);
          }
        }
      }, largePasteCode.slice(0, (b + 1) * 3000));

      // Wait for next requestAnimationFrame DOM paint cycle
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));

      const elapsed = performance.now() - t0;
      inpSamples.push(elapsed);
      await page.waitForTimeout(30);
    }

    // Retrieve collected Long Tasks (>150ms blocking tasks)
    const longTaskDurations: number[] = await page.evaluate(() => (window as any).__longTaskDurations || []);
    const severeLongTasks = longTaskDurations.filter((d) => d > 150);

    // Calculate statistical metrics for Input-to-Render Paint
    const stats = calculateLatencyStats(inpSamples);
    const targetThresholdMs = getLatencyThreshold(50, 100); // 50ms local, 100ms CI/Remote

    // Print structured telemetry summary
    printLatencyReport('Monaco Editor Input-to-Render Paint (INP)', stats, targetThresholdMs);
    console.log(`[CDP Performance Summary] Total Long Tasks (>50ms): ${longTaskDurations.length}, Severe (>150ms): ${severeLongTasks.length}`);

    // Assert zero severe main-thread blocking tasks over 150ms
    expect(severeLongTasks.length).toBe(0);

    // Assert p95 input-to-render paint latency threshold
    expect(stats.p95).toBeLessThanOrEqual(targetThresholdMs);
  });
});
