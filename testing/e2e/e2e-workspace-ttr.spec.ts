import { test, expect } from '@playwright/test';
import {
  APP_URL, loginUser, waitForBootComplete, createFile, waitForEditorModel, waitForTerminalText
} from '../test-utils';

test.describe('E2E Deployed Infrastructure - Phase 1: Workspace Cold Boot Time-to-Ready (TTR) SLA', () => {
  test.describe.configure({ mode: 'serial' });

  test('1. Workspace Cold Boot Time-to-Ready (TTR) & Terminal PTY Hydration SLA', async ({ page, request }) => {
    const timestamp = Date.now();
    await loginUser(page, request, `TTR_User_${timestamp}`);

    const tBootStart = Date.now();

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `TTR_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    await waitForBootComplete(page);

    const tContainerReady = Date.now();
    const containerBootMs = tContainerReady - tBootStart;

    // Measure xterm PTY terminal prompt readiness
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(terminalTextarea).toBeAttached({ timeout: 15000 });
    await waitForTerminalText(page, /sandbox:~#|#|\$/, 20000);

    const tTerminalReady = Date.now();
    const terminalHydrateMs = tTerminalReady - tContainerReady;

    // Measure Monaco editor readiness
    await createFile(page, 'ttr-test.js');
    await waitForEditorModel(page, 'ttr-test.js');
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 5000 });

    const tTotalReady = Date.now();
    const totalTtrMs = tTotalReady - tBootStart;

    console.log(`[Workspace TTR SLA] Container Boot Time: ${containerBootMs}ms`);
    console.log(`[Workspace TTR SLA] PTY Terminal Ready Time: ${terminalHydrateMs}ms`);
    console.log(`[Workspace TTR SLA] Total Workspace Time-to-Ready (TTR): ${totalTtrMs}ms`);

    // HARD SLA ENFORCEMENT: Container boot < 5,000ms, Total Workspace TTR < 8,000ms
    expect(containerBootMs, `HARD SLA VIOLATION: Container boot duration (${containerBootMs}ms) exceeded 5,000ms limit`).toBeLessThanOrEqual(5000);
    expect(totalTtrMs, `HARD SLA VIOLATION: Total Workspace TTR (${totalTtrMs}ms) exceeded 8,000ms limit`).toBeLessThanOrEqual(8000);
  });
});
