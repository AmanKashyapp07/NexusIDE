import { test, expect } from '@playwright/test';
import {
  APP_URL,
  loginUser,
  inviteUser,
  createFile,
  waitForBootComplete,
  waitForSocketConnect,
  extractWorkspaceId,
  getLatencyThreshold,
  calculateLatencyStats,
  printLatencyReport,
} from '../test-utils.js';

/**
 * Purpose: Yjs Multi-User Real-Time Collaboration Sync Latency SLA Spec.
 * Measures real-time edit propagation latency across Alice and Bob,
 * calculating p95 convergence stats over a batch of 15 character edits.
 */

test.describe('Real-Time Collab Sync Latency SLA Suite', () => {
  test('multi-user Yjs CRDT edit propagation SLA is under 100ms', async ({ page, context, request }) => {
    const timestamp = Date.now();
    const aliceName = `Alice_SLA_${timestamp}`;
    const bobName = `Bob_SLA_${timestamp}`;

    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());

    // Login users first to ensure database records are committed
    await loginUser(alicePage, request, aliceName);
    await loginUser(bobPage, request, bobName);
    await page.waitForTimeout(500);

    // Create workspace using Alice's context
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Collab_SLA_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const workspaceId = extractWorkspaceId(alicePage.url());
    await waitForBootComplete(alicePage);
    await waitForSocketConnect(alicePage);

    // Create a collaborative document file
    await createFile(alicePage, 'collab_latency.js');

    // Invite Bob to the workspace
    await inviteUser(alicePage, bobName, 'editor');

    // Bob opens workspace
    await bobPage.goto(`${APP_URL}/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await waitForSocketConnect(bobPage);

    // Both users open collab_latency.js
    await bobPage.locator('.ide-scrollbar').getByText('collab_latency.js').waitFor({ state: 'visible', timeout: 30000 });
    await bobPage.locator('.ide-scrollbar').getByText('collab_latency.js').click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 20000 });

    // Focus Alice's editor
    await alicePage.locator('.monaco-editor').first().click();
    await alicePage.waitForTimeout(300);

    // Warmup cycle: Ensure Yjs awareness & doc channel are fully active
    await alicePage.keyboard.type('warmup', { delay: 10 });
    await bobPage.waitForFunction(() => {
      const editors = (window as any).monaco?.editor?.getEditors();
      return editors && editors[0] && editors[0].getModel()?.getValue().includes('warmup');
    }, { timeout: 15000 });

    // Clear warmup content
    await alicePage.evaluate(() => {
      const editors = (window as any).monaco?.editor?.getEditors();
      if (editors && editors[0]) editors[0].getModel()?.setValue('');
    });
    await alicePage.waitForTimeout(500);

    // Measure character stream convergence over 15 edit cycles
    const samples: number[] = [];
    const editChars = '1234567890ABCDE'.split('');

    for (const char of editChars) {
      const t0 = performance.now();
      await alicePage.keyboard.type(char, { delay: 10 });

      // Wait until Bob's Monaco editor model receives the character
      await bobPage.waitForFunction((c) => {
        const editors = (window as any).monaco?.editor?.getEditors();
        return editors && editors[0] && editors[0].getModel()?.getValue().includes(c);
      }, char, { timeout: 10000 });

      const elapsed = performance.now() - t0;
      samples.push(elapsed);
      await alicePage.waitForTimeout(50);
    }

    // Calculate statistical metrics
    const stats = calculateLatencyStats(samples);
    const targetThreshold = getLatencyThreshold(100, 500); // 100ms local, 500ms CI/Remote WAN

    // Print clean, structured telemetry summary
    printLatencyReport('Multi-User Yjs CRDT edit propagation', stats, targetThreshold);

    // Assert p95 convergence SLA threshold
    expect(stats.p95).toBeLessThanOrEqual(targetThreshold);

    await bobPage.close();
  });
});
