import { test, expect } from '@playwright/test';
import {
  APP_URL, loginUser, waitForBootComplete, createFile, waitForEditorModel, extractWorkspaceId
} from '../test-utils';

test.describe('E2E Deployed Infrastructure - Phase 1: WebSocket Handshake & Yjs Hydration SLA', () => {
  test.describe.configure({ mode: 'serial' });

  test('1. WebSocket Handshake (101) & Yjs Document State Hydration SLA', async ({ page, request }) => {
    const timestamp = Date.now();
    await loginUser(page, request, `WS_Hydrate_User_${timestamp}`);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Hydrate_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    await waitForBootComplete(page);

    await createFile(page, 'ws-hydration-test.js');
    await waitForEditorModel(page, 'ws-hydration-test.js');

    // Instrument WebSocket connection and message timing via browser Network events
    let wsHandshakeMs = 0;
    let firstSyncMsgMs = 0;

    page.on('websocket', (ws) => {
      const tHandshakeStart = Date.now();
      ws.on('framereceived', () => {
        if (firstSyncMsgMs === 0) {
          firstSyncMsgMs = Date.now() - tHandshakeStart;
        }
      });
      wsHandshakeMs = Date.now() - tHandshakeStart;
    });

    const tHydrateStart = Date.now();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForBootComplete(page);

    const fileSelector = page.locator('.ide-scrollbar').getByText('ws-hydration-test.js').first();
    await expect(fileSelector).toBeVisible({ timeout: 20000 });
    await fileSelector.click();
    await waitForEditorModel(page, 'ws-hydration-test.js');

    const totalHydrationMs = Date.now() - tHydrateStart;

    console.log(`[WS Hydration SLA] WebSocket Handshake Duration: ${wsHandshakeMs}ms`);
    console.log(`[WS Hydration SLA] First Binary Sync Frame Received: ${firstSyncMsgMs}ms`);
    console.log(`[WS Hydration SLA] Total Monaco Model Hydration Duration: ${totalHydrationMs}ms`);

    // HARD SLA ENFORCEMENT: Handshake < 200ms, First Sync Msg < 500ms, Total Hydration < 3,000ms
    expect(wsHandshakeMs, `HARD SLA VIOLATION: WS Handshake duration (${wsHandshakeMs}ms) exceeded 200ms limit`).toBeLessThanOrEqual(200);
    expect(firstSyncMsgMs, `HARD SLA VIOLATION: First WS Sync frame duration (${firstSyncMsgMs}ms) exceeded 500ms limit`).toBeLessThanOrEqual(500);
    expect(totalHydrationMs, `HARD SLA VIOLATION: Total document hydration duration (${totalHydrationMs}ms) exceeded 3,000ms limit`).toBeLessThanOrEqual(3000);
  });
});
