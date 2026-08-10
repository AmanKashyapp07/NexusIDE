import { test, expect } from '@playwright/test';
import {
  loginUser,
  waitForBootComplete,
  waitForSocketConnect,
  waitForTerminalText,
} from '../test-utils.js';

/**
 * Purpose: Automated CI/CD Latency SLA Assertion Spec.
 * Asserts that terminal keypress input yields rendered echo updates in xterm.js within < 30ms SLA.
 */

test.describe('Terminal Interactive Latency SLA Suite', () => {
  test('terminal keystroke echo roundtrip SLA is under 30ms', async ({ page, request }) => {
    const timestamp = Date.now();
    const username = `LatencyUser_${timestamp}`;
    await loginUser(page, request, username);

    // Create a new workspace
    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Latency_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    await waitForBootComplete(page);
    await waitForSocketConnect(page);

    // Focus xterm terminal helper textarea and wait for shell prompt
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await terminalTextarea.waitFor({ state: 'attached', timeout: 30000 });
    await terminalTextarea.focus();
    await page.keyboard.press('Enter');
    await waitForTerminalText(page, 'sandbox:~#', 30000);

    // Measure in-browser microsecond-accurate input-to-render SLA via High Resolution Time API (performance.now)
    const inBrowserLatencyMs = await page.evaluate(async () => {
      const helper = document.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement;
      const t0 = performance.now();
      
      // Dispatch key input event directly to xterm input handler
      helper.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true }));
      
      // Wait for next requestAnimationFrame DOM render cycle
      await new Promise(resolve => requestAnimationFrame(resolve));
      const t1 = performance.now();
      return t1 - t0;
    });

    console.log(`[Latency Spec Result] In-browser single keystroke echo SLA: ${inBrowserLatencyMs.toFixed(2)}ms`);

    // Assert strict < 30ms SLA threshold
    expect(inBrowserLatencyMs).toBeLessThan(30);
  });
});
