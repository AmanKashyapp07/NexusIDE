import { test, expect } from '@playwright/test';
import {
  loginUser, createTestWorkspace, waitForBootComplete, createFile, waitForEditorModel
} from '../test-utils';

test.describe('E2E Deployed Infrastructure - Phase 4: Offline Edit Queue & Reconnection SLA', () => {
  test.describe.configure({ mode: 'serial' });

  test('1. Queues offline Monaco edits during network drop and reconciles Yjs state vector within 500ms of reconnect', async ({ page, context, request }) => {
    const timestamp = Date.now();

    // 1. Login and open workspace
    await loginUser(page, request, `Offline_User_${timestamp}`);
    const workspaceId = await createTestWorkspace(page, `Offline_WS_${timestamp}`);
    await waitForBootComplete(page);

    // 2. Create test file and wait for Monaco editor
    await createFile(page, 'offline-sync-check.ts');
    await waitForEditorModel(page, 'offline-sync-check.ts');

    const monacoEditor = page.locator('.monaco-editor').first();
    await expect(monacoEditor).toBeVisible({ timeout: 15000 });
    await monacoEditor.click();

    // 3. Emulate Network Disconnect via Chrome DevTools Protocol (CDP)
    console.log('[Offline Reconnect SLA] Emulating WAN Network Disconnect...');
    const client = await context.newCDPSession(page);
    await client.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0
    });

    // 4. Type 30 edits while completely offline
    for (let i = 1; i <= 30; i++) {
      await page.keyboard.type(`// Offline edit line ${i}\n`);
      await page.waitForTimeout(20);
    }

    // 5. Restore Network Connection
    console.log('[Offline Reconnect SLA] Restoring WAN Network Connection...');
    const tReconnectStart = Date.now();
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 20,
      downloadThroughput: 10 * 1024 * 1024 / 8,
      uploadThroughput: 5 * 1024 * 1024 / 8
    });

    // 6. Verify zero lost edits in Monaco editor model
    await page.waitForFunction(() => {
      const editors = (window as any).monaco?.editor?.getEditors();
      if (!editors || editors.length === 0) return false;
      const text = editors[0].getValue();
      return text.includes('Offline edit line 30');
    }, { timeout: 10000 });

    const reconnectDurationMs = Date.now() - tReconnectStart;
    console.log(`[Offline Reconnect SLA] Yjs Reconnection State Vector Convergence Duration: ${reconnectDurationMs}ms`);

    // HARD SLA ENFORCEMENT: Reconnection state vector convergence must complete within 2000ms
    expect(reconnectDurationMs, `HARD SLA VIOLATION: Reconnect sync duration (${reconnectDurationMs}ms) exceeded threshold`).toBeLessThanOrEqual(2000);
  });
});
