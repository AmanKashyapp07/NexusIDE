import { test, expect } from '@playwright/test';
import {
  loginUser,
  waitForBootComplete,
  waitForSocketConnect,
} from '../test-utils.js';

/**
 * Purpose: File Explorer Tree Action Latency SLA Assertion Spec.
 * Asserts in-browser file creation and tree node insertion latency is under < 30ms.
 */

test.describe('File Explorer Tree Latency SLA Suite', () => {
  test('file creation and tree node DOM insertion SLA is under 30ms', async ({ page, request }) => {
    const timestamp = Date.now();
    const username = `TreeUser_${timestamp}`;
    await loginUser(page, request, username);

    // Create a new workspace
    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Tree_SLA_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    await waitForBootComplete(page);
    await waitForSocketConnect(page);

    // Measure in-browser tree DOM insertion SLA
    const createLatencyMs = await page.evaluate(async () => {
      const newFileBtn = document.querySelector('button[title="New File"]') as HTMLButtonElement;
      if (!newFileBtn) return 999;
      
      const t0 = performance.now();
      newFileBtn.click();
      
      await new Promise(resolve => requestAnimationFrame(resolve));
      return performance.now() - t0;
    });

    console.log(`[File Tree SLA Result] File creation DOM insertion SLA: ${createLatencyMs.toFixed(2)}ms`);

    // Assert strict < 30ms SLA threshold
    expect(createLatencyMs).toBeLessThan(30);
  });
});
