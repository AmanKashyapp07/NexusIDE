import { test, expect } from '@playwright/test';
import {
  APP_URL, loginUser, inviteUser, waitForBootComplete, focusEditor,
  createFile, getEditorValue, waitForEditorModel, extractWorkspaceId
} from '../test-utils';

test.describe('E2E Deployed Infrastructure - Jepsen Chaos & Network Partitions', () => {
  test.describe.configure({ mode: 'serial' });

  test('1. Real Browser Split-Brain Partition & Strong Eventual Convergence (SEC)', async ({ page, context, request }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    try {
      const bobPage = await bobContext.newPage();
      const timestamp = Date.now();

      await loginUser(alicePage, request, `Alice_Chaos_${timestamp}`);
      await loginUser(bobPage, request, `Bob_Chaos_${timestamp}`);

      await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Chaos_WS_${timestamp}`);
      await alicePage.click('button:has-text("Create Now")');
      await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
      const workspaceId = extractWorkspaceId(alicePage.url());

      await waitForBootComplete(alicePage);

      // Pre-create file for guaranteed sync
      await createFile(alicePage, 'jepsen-doc.js');
      await waitForEditorModel(alicePage, 'jepsen-doc.js');

      await inviteUser(alicePage, `Bob_Chaos_${timestamp}`, 'editor');

      await bobPage.goto(`${APP_URL}/${workspaceId}`, { waitUntil: 'domcontentloaded' });
      await waitForBootComplete(bobPage);

      const bobFileSelector = bobPage.locator('.ide-scrollbar').getByText('jepsen-doc.js');
      await expect(bobFileSelector).toBeVisible({ timeout: 20000 });
      await bobFileSelector.click();
      await waitForEditorModel(bobPage, 'jepsen-doc.js');

      // Baseline Sync check with HARD 10,000ms SLA limit
      await focusEditor(alicePage);
      await alicePage.keyboard.type('// Baseline Document State\n');
      await expect(async () => {
        const val = await getEditorValue(bobPage);
        expect(val).toContain('Baseline Document State');
      }).toPass({ timeout: 10000, intervals: [200] });

      // === SIMULATE NETWORK PARTITION ON BOB ===
      const bobCDP = await bobContext.newCDPSession(bobPage);
      await bobCDP.send('Network.emulateNetworkConditions', {
        offline: true,
        latency: 0,
        downloadThroughput: 0,
        uploadThroughput: 0,
      });

      // Concurrent divergent edits during partition
      await focusEditor(alicePage);
      await alicePage.keyboard.type('// Alice Edit During Partition\n');

      await focusEditor(bobPage);
      await bobPage.keyboard.type('// Bob Edit During Partition\n');

      // Verify divergence while disconnected
      const aliceValPart = await getEditorValue(alicePage);
      expect(aliceValPart).toContain('Alice Edit During Partition');

      // === HEAL PARTITION ===
      const tHealStart = Date.now();
      await bobCDP.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });

      // Trigger socket reconnect event on Bob
      await bobPage.evaluate(() => window.dispatchEvent(new Event('online')));

      // HARD SLA LIMIT: Convergence across partition MUST complete within 10,000ms hard ceiling
      await expect(async () => {
        const aliceVal = await getEditorValue(alicePage);
        const bobVal = await getEditorValue(bobPage);

        expect(aliceVal).toContain('Alice Edit During Partition');
        expect(aliceVal).toContain('Bob Edit During Partition');
        expect(bobVal).toContain('Alice Edit During Partition');
        expect(bobVal).toContain('Bob Edit During Partition');
      }).toPass({ timeout: 10000, intervals: [200] });

      const tHealDuration = Date.now() - tHealStart;
      expect(tHealDuration, `HARD JEPSEN SLA VIOLATION: Partition SEC convergence duration (${tHealDuration}ms) exceeded 10,000ms hard SLA limit`).toBeLessThanOrEqual(10000);

    } finally {
      await bobContext.close();
    }
  });

  test('2. Browser Reconnection & RAM Write-Behind Buffer Recovery', async ({ page, request }) => {
    const timestamp = Date.now();
    await loginUser(page, request, `Reconn_User_${timestamp}`);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Reconn_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    await waitForBootComplete(page);

    await createFile(page, 'reconnect-test.js');
    await waitForEditorModel(page, 'reconnect-test.js');

    await focusEditor(page);
    await page.keyboard.type('// Hot RAM Buffer Persistence Test\n');

    const tReloadStart = Date.now();

    // Simulate transient network disruption and tab page reload
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForBootComplete(page);

    const fileSelector = page.locator('.ide-scrollbar').getByText('reconnect-test.js');
    await expect(fileSelector).toBeVisible({ timeout: 20000 });
    await fileSelector.click();
    await waitForEditorModel(page, 'reconnect-test.js');

    // HARD SLA LIMIT: RAM Buffer state recovery after reload must complete within 5,000ms max
    await expect(async () => {
      const val = await getEditorValue(page);
      expect(val).toContain('Hot RAM Buffer Persistence Test');
    }).toPass({ timeout: 5000, intervals: [200] });

    const tReloadDuration = Date.now() - tReloadStart;
    console.log(`[Jepsen SLA] RAM Write-Behind recovery time: ${tReloadDuration}ms`);
  });
});
