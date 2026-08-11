import { test, expect } from '@playwright/test';
import {
  loginUser, waitForBootComplete, createFile, waitForEditorModel, waitForTerminalText
} from '../test-utils';

test.describe('E2E Deployed Infrastructure - Container Pool Allocation Stress Benchmark', () => {
  test.describe.configure({ mode: 'serial' });

  test('1. Concurrent Workspace Container Boot & Terminal PTY Allocation SLA', async ({ page, context, request }) => {
    const timestamp = Date.now();
    const userCount = 2; // 2 concurrent workspace container launches for single-node VM SLA
    const contexts: any[] = [];
    const pages: any[] = [];

    try {
      // Launch parallel user sessions creating containers concurrently
      for (let i = 1; i <= userCount; i++) {
        const userContext = await context.browser()!.newContext();
        const userPage = await userContext.newPage();
        contexts.push(userContext);
        pages.push(userPage);

        await loginUser(userPage, request, `Pool_User_${i}_${timestamp}`);
      }

      // Concurrently create workspaces and boot containers
      const bootPromises = pages.map(async (userPage, i) => {
        const wsName = `Pool_WS_${i + 1}_${timestamp}`;
        await userPage.fill('input[placeholder="e.g. React-Sandbox"]', wsName);
        await userPage.click('button:has-text("Create Now")');
        await userPage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
        await waitForBootComplete(userPage);

        // Verify container PTY terminal prompt responds within SLA limit
        const terminalTextarea = userPage.locator('.xterm-helper-textarea');
        await expect(terminalTextarea).toBeAttached({ timeout: 20000 });
        await waitForTerminalText(userPage, /sandbox:~#|#|\$/, 25000);

        // Verify container file system & Monaco editor binding
        await createFile(userPage, `pool-check-${i + 1}.js`);
        await waitForEditorModel(userPage, `pool-check-${i + 1}.js`);
        await expect(userPage.locator('.monaco-editor')).toBeVisible({ timeout: 10000 });
      });

      // HARD SLA LIMIT: All concurrent container boots & PTY allocations must finish within 60s
      const tStart = Date.now();
      await Promise.all(bootPromises);
      const elapsed = Date.now() - tStart;

      console.log(`[Container Pool SLA] Concurrent Container Allocations completed in ${elapsed}ms`);
      expect(elapsed, `HARD SLA VIOLATION: Container pool allocation duration (${elapsed}ms) exceeded 60s threshold`).toBeLessThanOrEqual(60000);
    } finally {
      for (const userContext of contexts) {
        try { await userContext.close(); } catch {}
      }
    }
  });
});
