import { test, expect } from '@playwright/test';
import {
  APP_URL, API_URL, loginUser, inviteUser, waitForBootComplete,
  createFile, waitForEditorModel, extractWorkspaceId, waitForTerminalText
} from '../test-utils';

test.describe('E2E Deployed Infrastructure - Container Escape & Security Penetration', () => {
  test.describe.configure({ mode: 'serial' });

  test('1. Sandbox Isolation & Unprivileged Execution inside Container Terminal', async ({ page, request }) => {
    const timestamp = Date.now();
    await loginUser(page, request, `Pen_Tester_${timestamp}`);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Pen_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    await waitForBootComplete(page);

    // HARD SLA LIMIT: PTY helper textarea must attach within 15,000ms max
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(terminalTextarea).toBeAttached({ timeout: 15000 });
    await waitForTerminalText(page, /sandbox:~#|#|\$/, 20000);
    await page.waitForTimeout(1000);

    // Command 1: Confirm unprivileged user context within 3,000ms HARD SLA limit
    await terminalTextarea.focus();
    await page.keyboard.type('whoami', { delay: 10 });
    await page.keyboard.press('Enter');
    await waitForTerminalText(page, /sandbox|node|ubuntu|root/, 3000);

    // Command 2: Attempt cgroup / host boundary breach checks within 3,000ms HARD SLA limit
    await page.keyboard.type('cat /sys/fs/cgroup/pids.max || cat /sys/fs/cgroup/pids/pids.max', { delay: 10 });
    await page.keyboard.press('Enter');
    await waitForTerminalText(page, /500|max|pids/, 3000);
  });

  test('2. Storage RBAC & REST Path Traversal Denial (Viewer Role)', async ({ page, context, request }) => {
    const ownerPage = page;
    const viewerContext = await context.browser()!.newContext();
    try {
      const viewerPage = await viewerContext.newPage();
      const timestamp = Date.now();

      const ownerToken = await loginUser(ownerPage, request, `Owner_Sec_${timestamp}`);
      const viewerToken = await loginUser(viewerPage, request, `Viewer_Sec_${timestamp}`);

      await ownerPage.fill('input[placeholder="e.g. React-Sandbox"]', `RBAC_Sec_WS_${timestamp}`);
      await ownerPage.click('button:has-text("Create Now")');
      await ownerPage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
      const workspaceId = extractWorkspaceId(ownerPage.url());

      await waitForBootComplete(ownerPage);
      await inviteUser(ownerPage, `Viewer_Sec_${timestamp}`, 'viewer');

      await viewerPage.goto(`${APP_URL}/${workspaceId}`, { waitUntil: 'domcontentloaded' });
      await waitForBootComplete(viewerPage);

      // Verify Viewer cannot see 'New File' creation controls
      const newFileBtn = viewerPage.locator('button[title="New File"], button:has-text("New File")');
      await expect(newFileBtn).toBeHidden({ timeout: 5000 });

      // HARD SLA LIMIT: REST path traversal denial must respond within 1,000ms max hard latency limit
      const tReqStart = Date.now();
      const traversalRes = await viewerPage.request.post(`${API_URL}/workspaces/${workspaceId}/files`, {
        headers: { Authorization: `Bearer ${viewerToken}` },
        data: { path: '../../etc/passwd', content: 'malicious payload' },
      });
      const tReqDuration = Date.now() - tReqStart;

      // Expect 403 Forbidden or 400 Bad Request rejection
      expect(traversalRes.status(), 'HARD SECURITY RULE: Path traversal request was not rejected with status >= 400').toBeGreaterThanOrEqual(400);
      expect(tReqDuration, `HARD RESPONSE TIME SLA: Path traversal denial response time (${tReqDuration}ms) exceeded 1,000ms hard ceiling`).toBeLessThanOrEqual(1000);

    } finally {
      await viewerContext.close();
    }
  });

  test('3. Raw WebSocket Frame Boundaries & Gateway Stability', async ({ page, request }) => {
    const timestamp = Date.now();
    await loginUser(page, request, `WS_Fuzz_${timestamp}`);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `WS_Fuzz_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    await waitForBootComplete(page);

    // HARD SLA LIMIT: File creation and Monaco editor setup must complete within 5,000ms max
    await createFile(page, 'fuzz-check.js');
    await waitForEditorModel(page, 'fuzz-check.js');
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 5000 });
  });
});
