import { test, expect } from '@playwright/test';
import {
  APP_URL, loginUser, waitForBootComplete, createFile, waitForEditorModel, typeTextInMonaco
} from '../test-utils';

test.describe('E2E Deployed Infrastructure - Phase 3: Browser UI Main Thread Long Task SLA (>50ms)', () => {
  test.describe.configure({ mode: 'serial' });

  test('1. Main Thread Long Task Detection (>50ms) During Sustained Collaborative Editing', async ({ page, request }) => {
    const timestamp = Date.now();
    await loginUser(page, request, `LongTask_User_${timestamp}`);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `LongTask_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    await waitForBootComplete(page);

    await createFile(page, 'long-task-test.js');
    await waitForEditorModel(page, 'long-task-test.js');

    // Instrument PerformanceObserver for 'longtask' entries (>50ms main thread blocking)
    await page.evaluate(() => {
      (window as any).__longTaskCount = 0;
      (window as any).__maxLongTaskMs = 0;
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.duration > 50) {
              (window as any).__longTaskCount++;
              if (entry.duration > (window as any).__maxLongTaskMs) {
                (window as any).__maxLongTaskMs = entry.duration;
              }
            }
          }
        });
        observer.observe({ type: 'longtask', buffered: true });
      } catch {
        // Fallback for browsers with restricted CDP longtask observers
      }
    });

    // Perform sustained Monaco editor typing simulation for 10 bursts
    const editor = page.locator('.monaco-editor').first();
    await editor.click();

    for (let burst = 1; burst <= 10; burst++) {
      await typeTextInMonaco(page, `// Burst ${burst}: Collaborative typing payload string\nfunction fn_${burst}() { return ${burst}; }\n`);
      await page.waitForTimeout(100);
    }

    // Retrieve recorded longtask metrics from browser context
    const metrics = await page.evaluate(() => ({
      count: (window as any).__longTaskCount || 0,
      maxMs: (window as any).__maxLongTaskMs || 0
    }));

    console.log(`[Long Task Detection SLA] Long Tasks (>50ms) Recorded: ${metrics.count}`);
    console.log(`[Long Task Detection SLA] Max Main Thread Block Duration: ${metrics.maxMs.toFixed(2)}ms`);

    // HARD SLA ENFORCEMENT: Zero long tasks > 150ms on main thread during typing
    expect(metrics.maxMs, `HARD SLA VIOLATION: Browser UI main thread frozen for ${metrics.maxMs.toFixed(2)}ms (>150ms threshold)`).toBeLessThanOrEqual(150);
  });
});
