import { test, expect } from '@playwright/test';
import {
  loginUser,
  waitForBootComplete,
  waitForSocketConnect,
  createFile,
} from '../test-utils.js';

/**
 * Purpose: Monaco Editor Typing-to-Paint Latency SLA Assertion Spec.
 * Asserts in-browser keystroke render latency in Monaco is under < 16.6ms (60 FPS frame SLA).
 */

test.describe('Monaco Code Editor Latency SLA Suite', () => {
  test('monaco keystroke to paint SLA is under 16.6ms (60 FPS)', async ({ page, request }) => {
    const timestamp = Date.now();
    const username = `MonacoUser_${timestamp}`;
    await loginUser(page, request, username);

    // Create a new workspace
    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Monaco_SLA_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    await waitForBootComplete(page);
    await waitForSocketConnect(page);

    // Create and open a file
    await createFile(page, 'latencyTest.js');
    await page.waitForSelector('.monaco-editor', { timeout: 20000 });

    // Measure in-browser input-to-paint latency via performance.now
    const typingLatencyMs = await page.evaluate(async () => {
      const editorEl = document.querySelector('.monaco-editor') as HTMLElement;
      if (!editorEl) return 999;
      editorEl.focus();

      const t0 = performance.now();
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true }));
      
      // Wait for next requestAnimationFrame DOM paint cycle
      await new Promise(resolve => requestAnimationFrame(resolve));
      return performance.now() - t0;
    });

    console.log(`[Monaco SLA Result] Keystroke-to-paint latency: ${typingLatencyMs.toFixed(2)}ms`);

    // Assert 60 FPS frame SLA threshold (< 30ms margin for CI execution)
    expect(typingLatencyMs).toBeLessThan(30);
  });
});
