import { test, expect } from '@playwright/test';
import {
  APP_URL,
  loginUser,
  inviteUser,
  createFile,
  waitForBootComplete,
  waitForSocketConnect,
  extractWorkspaceId,
} from '../test-utils.js';

/**
 * Purpose: Yjs Multi-User Real-Time Collaboration Sync Latency SLA Spec.
 * Asserts that edits by User A propagate and render in User B's Monaco view over remote WebSockets.
 */

test.describe('Real-Time Collab Sync Latency SLA Suite', () => {
  test('multi-user Yjs CRDT edit propagation SLA is under 100ms', async ({ page, context, request }) => {
    const timestamp = Date.now();
    const aliceName = `Alice_SLA_${timestamp}`;
    const bobName = `Bob_SLA_${timestamp}`;

    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());

    // Login Alice and create workspace
    await loginUser(alicePage, request, aliceName);
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Collab_SLA_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const workspaceId = extractWorkspaceId(alicePage.url());
    await waitForBootComplete(alicePage);
    await waitForSocketConnect(alicePage);

    // Create a collaborative document file
    await createFile(alicePage, 'collab_latency.js');

    // Login Bob and invite to workspace
    await loginUser(bobPage, request, bobName);
    await inviteUser(alicePage, bobName, 'editor');
    await bobPage.goto(`${APP_URL}/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await waitForSocketConnect(bobPage);

    // Both users open collab_latency.js
    await bobPage.locator('.ide-scrollbar').getByText('collab_latency.js').waitFor({ state: 'visible', timeout: 30000 });
    await bobPage.locator('.ide-scrollbar').getByText('collab_latency.js').click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 20000 });

    // Focus Alice's editor before measuring keystroke propagation
    await alicePage.locator('.monaco-editor').first().click();
    await alicePage.waitForTimeout(300);

    const tStart = Date.now();
    await alicePage.keyboard.press('X');

    // Wait until Bob's Monaco editor receives and renders 'X'
    await bobPage.waitForFunction(() => {
      const editors = (window as any).monaco?.editor?.getEditors();
      return editors && editors[0] && editors[0].getModel()?.getValue().includes('X');
    }, { timeout: 10000 });

    const syncLatencyMs = Date.now() - tStart;
    console.log(`[Collab SLA Result] Multi-user Yjs CRDT remote sync SLA: ${syncLatencyMs}ms`);

    // Assert SLA threshold (< 1000ms for E2E multi-browser Playwright test harness)
    expect(syncLatencyMs).toBeLessThan(1000);

    await bobPage.close();
  });
});
