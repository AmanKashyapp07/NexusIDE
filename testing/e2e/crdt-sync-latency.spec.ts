import { test, expect } from '@playwright/test';
import {
  APP_URL,
  loginUser,
  inviteUser,
  createFile,
  waitForBootComplete,
  waitForSocketConnect,
  extractWorkspaceId,
  calculateLatencyStats,
  getLatencyThreshold,
  printLatencyReport,
} from '../test-utils.js';

/**
 * Purpose: 3-Peer Collaborative CRDT Sync & Document Convergence SLA Suite.
 * Spawns 3 browser contexts (Alice, Bob, Charlie) and measures real-time edit propagation latency
 * and convergence times across Monaco editor instances.
 */

test.describe('3-Peer Collaborative CRDT Sync SLA Suite', () => {
  test('multi-peer CRDT edit propagation SLA satisfies p95 convergence threshold', async ({ browser, request }) => {
    const timestamp = Date.now();
    const aliceUser = `Alice_CRDT_${timestamp}`;
    const bobUser = `Bob_CRDT_${timestamp}`;
    const charlieUser = `Charlie_CRDT_${timestamp}`;

    // 1. Setup Alice's session & create workspace
    const aliceContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    await loginUser(alicePage, request, aliceUser);

    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `CRDT_3Peer_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const workspaceId = extractWorkspaceId(alicePage.url());
    await waitForBootComplete(alicePage);
    await waitForSocketConnect(alicePage);

    // 2. Setup Bob & Charlie's sessions (registers user accounts in DB)
    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();
    await loginUser(bobPage, request, bobUser);

    const charlieContext = await browser.newContext();
    const charliePage = await charlieContext.newPage();
    await loginUser(charliePage, request, charlieUser);

    // Invite Bob & Charlie into workspace
    await inviteUser(alicePage, bobUser, 'editor');
    await inviteUser(alicePage, charlieUser, 'editor');

    // Create shared test file
    const filename = `sync_${timestamp}.ts`;
    await createFile(alicePage, filename);

    // Open workspace for Bob and Charlie
    await bobPage.goto(`${APP_URL}/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await waitForSocketConnect(bobPage);

    await charliePage.goto(`${APP_URL}/${workspaceId}`);
    await waitForBootComplete(charliePage);
    await waitForSocketConnect(charliePage);

    // Open the shared file on all 3 clients
    await alicePage.click(`text="${filename}"`);
    await bobPage.click(`text="${filename}"`);
    await charliePage.click(`text="${filename}"`);
    await alicePage.waitForTimeout(500);

    // Focus Alice's editor
    await alicePage.locator('.monaco-editor').first().click();
    await alicePage.waitForTimeout(300);

    // Warmup cycle: Ensure Yjs connection and Monaco model bindings are fully active on all peers
    await alicePage.keyboard.type('warmup', { delay: 10 });
    await bobPage.waitForFunction(() => {
      const editors = (window as any).monaco?.editor?.getEditors();
      return editors && editors[0] && editors[0].getModel()?.getValue().includes('warmup');
    }, { timeout: 15000 });
    await charliePage.waitForFunction(() => {
      const editors = (window as any).monaco?.editor?.getEditors();
      return editors && editors[0] && editors[0].getModel()?.getValue().includes('warmup');
    }, { timeout: 15000 });

    // Clear warmup content before starting latency benchmark
    await alicePage.evaluate(() => {
      const editors = (window as any).monaco?.editor?.getEditors();
      if (editors && editors[0]) editors[0].getModel()?.setValue('');
    });
    await alicePage.waitForTimeout(500);

    // 4. Measure character stream convergence across Bob and Charlie over 15 edit cycles
    const samples: number[] = [];
    const editChars = 'ABCDEFGHIJKLMNO'.split('');

    for (const char of editChars) {
      const t0 = performance.now();
      await alicePage.keyboard.type(char, { delay: 10 });

      // Wait until Bob's Monaco editor model receives the character
      await bobPage.waitForFunction((c) => {
        const editors = (window as any).monaco?.editor?.getEditors();
        return editors && editors[0] && editors[0].getModel()?.getValue().includes(c);
      }, char, { timeout: 10000 });

      // Wait until Charlie's Monaco editor model receives the character
      await charliePage.waitForFunction((c) => {
        const editors = (window as any).monaco?.editor?.getEditors();
        return editors && editors[0] && editors[0].getModel()?.getValue().includes(c);
      }, char, { timeout: 10000 });

      const elapsed = performance.now() - t0;
      samples.push(elapsed);
      await alicePage.waitForTimeout(50);
    }

    // Calculate statistical metrics
    const stats = calculateLatencyStats(samples);
    const targetThresholdMs = getLatencyThreshold(100, 500); // 100ms local, 500ms CI/Remote

    // Print structured telemetry summary
    printLatencyReport('3-Peer CRDT Document Convergence', stats, targetThresholdMs);

    // Assert p95 convergence SLA threshold
    expect(stats.p95).toBeLessThanOrEqual(targetThresholdMs);

    // Cleanup contexts
    await charlieContext.close();
    await bobContext.close();
    await aliceContext.close();
  });
});
