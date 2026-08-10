import { test, expect } from '@playwright/test';
import {
  API_URL,
  loginUser,
  waitForBootComplete,
  waitForSocketConnect,
  createFile,
  extractWorkspaceId,
  waitForTerminalText,
} from '../test-utils.js';

/**
 * Purpose: Live Preview Proxy HTTP Response Latency SLA Spec.
 * Asserts container dev server proxy response latency is under < 150ms.
 */

test.describe('Live Preview Proxy Latency SLA Suite', () => {
  test('live preview proxy HTTP response SLA is under 150ms', async ({ page, request }) => {
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

    // Measure proxy HTTP GET response roundtrip SLA
    const previewUrl = `${API_URL}/workspace/${workspaceId}/preview/`;
    const t0 = Date.now();
    const res = await request.get(previewUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const elapsedMs = Date.now() - t0;

    expect(res.status()).toBe(200);
    console.log(`[Preview Proxy SLA Result] HTTP proxy response SLA: ${elapsedMs}ms`);

    // Assert SLA threshold (< 150ms over remote HTTP connection)
    expect(elapsedMs).toBeLessThan(150);
  });
});
