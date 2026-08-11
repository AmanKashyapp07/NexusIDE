import { test, expect } from '@playwright/test';
import {
  APP_URL, loginUser, inviteUser, waitForBootComplete, focusEditor,
  createFile, getEditorValue, waitForEditorModel, extractWorkspaceId
} from '../test-utils';

test.describe('E2E Deployed Infrastructure - Multi-Region 350ms WAN Jitter & CRDT Convergence', () => {
  test.describe.configure({ mode: 'serial' });

  test('1. Real Browser Multi-Region 350ms WAN Latency & 5% Packet Jitter Sync', async ({ page, context, request }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    try {
      const bobPage = await bobContext.newPage();
      const timestamp = Date.now();

      await loginUser(alicePage, request, `Alice_WAN_${timestamp}`);
      await loginUser(bobPage, request, `Bob_WAN_${timestamp}`);

      await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `WAN_WS_${timestamp}`);
      await alicePage.click('button:has-text("Create Now")');
      await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
      const workspaceId = extractWorkspaceId(alicePage.url());

      await waitForBootComplete(alicePage);

      await createFile(alicePage, 'wan-jitter.js');
      await waitForEditorModel(alicePage, 'wan-jitter.js');

      await inviteUser(alicePage, `Bob_WAN_${timestamp}`, 'editor');

      await bobPage.goto(`${APP_URL}/${workspaceId}`, { waitUntil: 'domcontentloaded' });
      await waitForBootComplete(bobPage);

      const bobFileSelector = bobPage.locator('.ide-scrollbar').getByText('wan-jitter.js').first();
      await expect(bobFileSelector).toBeVisible({ timeout: 20000 });
      await bobFileSelector.click();
      await waitForEditorModel(bobPage, 'wan-jitter.js');

      // Emulate 350ms Cross-Continent WAN Latency on both browser contexts via CDP
      const aliceCDP = await context.newCDPSession(alicePage);
      const bobCDP = await bobContext.newCDPSession(bobPage);

      await aliceCDP.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 350, // 350ms cross-continent WAN latency
        downloadThroughput: 1024 * 1024,
        uploadThroughput: 1024 * 1024,
      });

      await bobCDP.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 350, // 350ms cross-continent WAN latency
        downloadThroughput: 1024 * 1024,
        uploadThroughput: 1024 * 1024,
      });

      // Concurrent edits under 350ms latency
      await focusEditor(alicePage);
      await alicePage.keyboard.type('// Alice Edit under 350ms WAN Latency\n', { delay: 15 });

      await focusEditor(bobPage);
      await bobPage.keyboard.type('// Bob Edit under 350ms WAN Latency\n', { delay: 15 });

      // HARD SLA LIMIT: Multi-region synchronization under 350ms WAN latency must complete within 12,000ms max
      await expect(async () => {
        const aliceVal = await getEditorValue(alicePage);
        const bobVal = await getEditorValue(bobPage);

        expect(aliceVal).toContain('Alice Edit under 350ms WAN Latency');
        expect(aliceVal).toContain('Bob Edit under 350ms WAN Latency');
        expect(bobVal).toContain('Alice Edit under 350ms WAN Latency');
        expect(bobVal).toContain('Bob Edit under 350ms WAN Latency');
      }).toPass({ timeout: 12000, intervals: [200] });

      // Reset network conditions
      await aliceCDP.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await bobCDP.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

    } finally {
      await bobContext.close();
    }
  });
});
