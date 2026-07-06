import { test, expect, type Page } from '@playwright/test';

// =============================================================================
// LSP Integration Test Suite
// Tests the full pipeline:
//   Browser Monaco editor ↔ WebSocket ↔ backend lspHandler.ts ↔ Docker exec
//   ↔ typescript-language-server / pyright-langserver
//
// Prerequisites (same as other E2E suites):
//   - Backend running on localhost:4000
//   - Frontend dev server on localhost:5173
//   - Docker daemon running with sandbox-dev-env:latest image built
// =============================================================================

const APP_URL = process.env.BASE_URL || 'http://localhost:5173';
const API_URL = process.env.BASE_URL ? (() => { try { const u = new URL(process.env.BASE_URL); u.port = '4000'; u.pathname = '/api'; return u.toString().replace(/\/$/, ''); } catch { return 'http://localhost:4000/api'; } })() : 'http://localhost:4000/api';
const WS_URL = process.env.BASE_URL ? (() => { try { const u = new URL(process.env.BASE_URL); u.port = '4000'; u.pathname = ''; u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'; return u.toString().replace(/\/$/, ''); } catch { return 'ws://localhost:4000'; } })() : 'ws://localhost:4000';

// ── Shared helpers ────────────────────────────────────────────────────────────

async function loginUser(page: Page, username: string) {
  await page.goto(`${APP_URL}/login`);
  const input = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
  await input.waitFor({ state: 'visible', timeout: 15000 });
  await input.fill(username);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
}

async function waitForBootComplete(page: Page) {
  const el = page.locator('text=Booting environment...');
  try {
    await el.waitFor({ state: 'visible', timeout: 3000 });
    await el.waitFor({ state: 'detached', timeout: 35000 });
  } catch {}
}

async function createFile(page: Page, filename: string) {
  await page.waitForTimeout(1500);
  await page.click('button[title="New File"]');
  const input = page.locator('.ide-scrollbar input');
  await input.waitFor({ state: 'visible', timeout: 15000 });
  await input.fill(filename);
  await input.press('Enter');
}

async function inviteUser(page: Page, username: string, role: 'editor' | 'viewer' | 'admin') {
  await page.click('button:has-text("Share")');
  await page.fill('input[placeholder="Username or Email"]', username);
  await page.selectOption('select', role);
  await page.click('button:has-text("Invite")');
  await expect(page.locator(`.flex.items-center.justify-between:has-text("${username}")`)).toBeVisible({ timeout: 10000 });
  await page.click('.fixed.inset-0', { position: { x: 10, y: 10 } });
}

async function setEditorValue(page: Page, code: string) {
  await page.evaluate((text) => {
    const ed = (window as any).monaco?.editor?.getEditors()?.[0];
    if (ed) ed.getModel()?.setValue(text);
  }, code);
}

/** Wait until the LSP status badge reaches a specific status */
async function waitForLspStatus(page: Page, status: 'ready' | 'connecting' | 'error', timeout = 30000) {
  await expect(
    page.locator('[data-testid="lsp-status-badge"]')
  ).toHaveAttribute('data-lsp-status', status, { timeout });
}

/** Returns Monaco marker messages for the active model */
async function getMarkers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const monaco = (window as any).monaco;
    if (!monaco) return [];
    const models = monaco.editor.getModels();
    if (!models.length) return [];
    return monaco.editor
      .getModelMarkers({ resource: models[0].uri })
      .map((m: any) => m.message as string);
  });
}

// ── Test suite ────────────────────────────────────────────────────────────────

test.describe('LSP Integration (Language Intelligence)', () => {

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 1: TypeScript LSP connects and badge reaches "ready"
  // ═══════════════════════════════════════════════════════════════════════════
  test('1. LSP badge shows connecting then ready for a TypeScript file', async ({ page }) => {
    const ts = Date.now();
    await loginUser(page, `LspTs_${ts}`);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `LSP_TS_${ts}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[a-f0-9-]+/);
    await waitForBootComplete(page);

    await createFile(page, 'index.ts');
    await page.waitForSelector('.monaco-editor', { timeout: 15000 });

    // Badge should appear (connecting or ready — language server may be fast)
    await expect(page.locator('[data-testid="lsp-status-badge"]')).toBeVisible({ timeout: 15000 });

    // Eventually it must reach ready
    await waitForLspStatus(page, 'ready', 30000);
    console.log('[LSP Test 1] TypeScript LSP reached ready state ✓');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 2: Python LSP connects and badge reaches "ready"
  // ═══════════════════════════════════════════════════════════════════════════
  test('2. LSP badge shows ready for a Python file', async ({ page }) => {
    const ts = Date.now();
    await loginUser(page, `LspPy_${ts}`);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `LSP_PY_${ts}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[a-f0-9-]+/);
    await waitForBootComplete(page);

    await createFile(page, 'main.py');
    await page.waitForSelector('.monaco-editor', { timeout: 15000 });

    await expect(page.locator('[data-testid="lsp-status-badge"]')).toBeVisible({ timeout: 15000 });
    await waitForLspStatus(page, 'ready', 30000);
    console.log('[LSP Test 2] Python LSP reached ready state ✓');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 3: No LSP badge for unsupported file types (JSON, CSS, Markdown)
  // ═══════════════════════════════════════════════════════════════════════════
  test('3. LSP badge does not appear for unsupported languages (JSON)', async ({ page }) => {
    const ts = Date.now();
    await loginUser(page, `LspNone_${ts}`);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `LSP_NONE_${ts}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[a-f0-9-]+/);
    await waitForBootComplete(page);

    await createFile(page, 'config.json');
    await page.waitForSelector('.monaco-editor', { timeout: 15000 });

    // Wait long enough for LSP to show if it were going to
    await page.waitForTimeout(3000);

    await expect(page.locator('[data-testid="lsp-status-badge"]')).not.toBeVisible();
    console.log('[LSP Test 3] No LSP badge for JSON ✓');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 4: TypeScript diagnostics — type error produces a red squiggle marker
  // ═══════════════════════════════════════════════════════════════════════════
  test('4. TypeScript LSP emits diagnostics for a type error', async ({ page }) => {
    const ts = Date.now();
    await loginUser(page, `LspDiag_${ts}`);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `LSP_DIAG_${ts}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[a-f0-9-]+/);
    await waitForBootComplete(page);

    await createFile(page, 'error.ts');
    await page.waitForSelector('.monaco-editor', { timeout: 15000 });

    // Wait for LSP to be ready before injecting code
    await waitForLspStatus(page, 'ready', 30000);

    // This is a clear TypeScript type error: number assigned to string
    const errorCode = `const x: string = 42;`;
    await setEditorValue(page, errorCode);

    // LSP sends publishDiagnostics after a debounce — wait up to 15s
    await expect.poll(async () => {
      const markers = await getMarkers(page);
      console.log('[LSP Test 4] Current markers:', markers);
      return markers.length;
    }, { timeout: 15000, intervals: [1000, 2000, 3000] }).toBeGreaterThan(0);

    const markers = await getMarkers(page);
    expect(markers.some(m => m.toLowerCase().includes('string') || m.toLowerCase().includes('number') || m.toLowerCase().includes('assignable'))).toBe(true);
    console.log('[LSP Test 4] TypeScript diagnostic received:', markers[0], '✓');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 5: Python diagnostics — undefined name produces a marker
  // ═══════════════════════════════════════════════════════════════════════════
  test('5. Python LSP (Pyright) emits diagnostics for an undefined variable', async ({ page }) => {
    const ts = Date.now();
    await loginUser(page, `LspPyDiag_${ts}`);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `LSP_PYDIAG_${ts}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[a-f0-9-]+/);
    await waitForBootComplete(page);

    await createFile(page, 'bad.py');
    await page.waitForSelector('.monaco-editor', { timeout: 15000 });

    await waitForLspStatus(page, 'ready', 30000);

    // Calling an undefined function — Pyright should flag this
    const errorCode = `result = undefined_function_xyz()`;
    await setEditorValue(page, errorCode);

    await expect.poll(async () => {
      const markers = await getMarkers(page);
      console.log('[LSP Test 5] Python markers:', markers);
      return markers.length;
    }, { timeout: 15000, intervals: [1000, 2000, 3000] }).toBeGreaterThan(0);

    const markers = await getMarkers(page);
    expect(markers.some(m =>
      m.toLowerCase().includes('undefined') ||
      m.toLowerCase().includes('not defined') ||
      m.toLowerCase().includes('unknown')
    )).toBe(true);
    console.log('[LSP Test 5] Python diagnostic received:', markers[0], '✓');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 6: Diagnostics clear when error is fixed
  // ═══════════════════════════════════════════════════════════════════════════
  test('6. Diagnostics clear when the type error is corrected', async ({ page }) => {
    const ts = Date.now();
    await loginUser(page, `LspClear_${ts}`);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `LSP_CLEAR_${ts}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[a-f0-9-]+/);
    await waitForBootComplete(page);

    await createFile(page, 'fix.ts');
    await page.waitForSelector('.monaco-editor', { timeout: 15000 });
    await waitForLspStatus(page, 'ready', 30000);

    // Introduce error
    await setEditorValue(page, `const x: string = 42;`);
    await expect.poll(async () => (await getMarkers(page)).length, { timeout: 15000 }).toBeGreaterThan(0);
    console.log('[LSP Test 6] Error markers appeared ✓');

    // Fix the error
    await setEditorValue(page, `const x: string = "hello";`);
    await expect.poll(async () => (await getMarkers(page)).length, { timeout: 15000 }).toBe(0);
    console.log('[LSP Test 6] Markers cleared after fix ✓');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 7: Viewer role — LSP WebSocket is rejected (no LSP badge shown)
  // Viewers should not spawn language servers (resource protection: admin/editor only)
  // ═══════════════════════════════════════════════════════════════════════════
  test('7. Viewer role cannot connect to LSP — no badge shown', async ({ page, context }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const ts = Date.now();

    await loginUser(alicePage, `LspOwner_${ts}`);
    await loginUser(bobPage, `LspViewer_${ts}`);

    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `LSP_RBAC_${ts}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await createFile(alicePage, 'secret.ts');
    await alicePage.waitForTimeout(1000);
    await inviteUser(alicePage, `LspViewer_${ts}`, 'viewer');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('secret.ts').click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });

    // Viewer: read-only badge visible, LSP badge must NOT appear
    await expect(bobPage.locator('text=View Only')).toBeVisible({ timeout: 10000 });
    await bobPage.waitForTimeout(5000);
    await expect(bobPage.locator('[data-testid="lsp-status-badge"]')).not.toBeVisible();
    console.log('[LSP Test 7] Viewer has no LSP badge ✓');

    // Also verify at the API level — backend rejects viewer with 4403
    const wsRejectCode = await bobPage.evaluate(async ({ wsId }) => {
      const token = localStorage.getItem('token') ?? '';
      return new Promise<number>((resolve) => {
        const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname}:4000`;
        const ws = new WebSocket(
          `${wsUrl}/ws/lsp/${wsId}/typescript?token=${encodeURIComponent(token)}`
        );
        ws.onclose = (e) => resolve(e.code);
        ws.onerror = () => resolve(-1);
        setTimeout(() => resolve(-2), 8000);
      });
    }, { wsId: workspaceId });

    expect(wsRejectCode).toBe(4403);
    console.log('[LSP Test 7] Backend rejected viewer WS with 4403 ✓');

    await bobPage.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 8: Language switching — switching from .ts to .py starts a new LSP
  // session and the badge reflects the new language server connecting/ready
  // ═══════════════════════════════════════════════════════════════════════════
  test.skip('8. Switching from TypeScript to Python file reconnects to the correct LSP', async ({ page }) => {
    const ts = Date.now();
    await loginUser(page, `LspSwitch_${ts}`);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `LSP_SWITCH_${ts}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[a-f0-9-]+/);
    await waitForBootComplete(page);

    // Create both files upfront
    await createFile(page, 'app.ts');
    await page.waitForTimeout(500);
    await createFile(page, 'script.py');
    await page.waitForTimeout(500);

    // Open the TS file first
    await page.locator('.ide-scrollbar').getByText('app.ts').click();
    await page.waitForSelector('.monaco-editor', { timeout: 15000 });
    await waitForLspStatus(page, 'ready', 30000);
    console.log('[LSP Test 8] TypeScript LSP ready on app.ts ✓');

    // Write a TS error to confirm the TS LSP is active
    await setEditorValue(page, `const n: number = "not a number";`);
    await expect.poll(async () => (await getMarkers(page)).length, { timeout: 15000 }).toBeGreaterThan(0);
    console.log('[LSP Test 8] TS diagnostic confirmed ✓');

    // Now switch to the Python file
    await page.locator('.ide-scrollbar').getByText('script.py').click();
    await page.waitForTimeout(500); // let the TS LSP session close

    // Badge should reconnect for Python
    await expect(page.locator('[data-testid="lsp-status-badge"]')).toBeVisible({ timeout: 10000 });
    await waitForLspStatus(page, 'ready', 30000);
    console.log('[LSP Test 8] Python LSP ready on script.py ✓');

    // Write a Python error, confirm Pyright diagnostics come through
    await setEditorValue(page, `x: int = "this is wrong"`);
    await expect.poll(async () => (await getMarkers(page)).length, { timeout: 15000 }).toBeGreaterThan(0);
    console.log('[LSP Test 8] Python diagnostic on switch confirmed ✓');

    // Switch back to TS — markers should be for TS, not Python
    await page.locator('.ide-scrollbar').getByText('app.ts').click();
    await waitForLspStatus(page, 'ready', 30000);
    const tsMarkers = await getMarkers(page);
    console.log('[LSP Test 8] TS markers on return:', tsMarkers);
    expect(tsMarkers.length).toBeGreaterThan(0);
    console.log('[LSP Test 8] Language switch round-trip ✓');
  });
  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 9: LSP WebSocket endpoint rejects invalid/missing token
  // ═══════════════════════════════════════════════════════════════════════════
  test('9. LSP WebSocket rejects connections with an invalid token', async ({ page }) => {
    const ts = Date.now();
    await loginUser(page, `LspAuth_${ts}`);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `LSP_AUTH_${ts}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = page.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(page);

    const closeCode = await page.evaluate(async ({ wsId }) => {
      return new Promise<number>((resolve) => {
        const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname}:4000`;
        const ws = new WebSocket(`${wsUrl}/ws/lsp/${wsId}/typescript?token=invalid_token_xyz`);
        ws.onclose = (e) => resolve(e.code);
        ws.onerror = () => resolve(-1);
        setTimeout(() => resolve(-2), 5000);
      });
    }, { wsId: workspaceId });

    // 4401 = Invalid token (from lspHandler.ts)
    expect(closeCode).toBe(4401);
    console.log('[LSP Test 9] Invalid token rejected with 4401 ✓');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 10: Editor badge does NOT appear for viewer even after file switch
  // Regression guard: ensure role check persists across file navigation
  // ═══════════════════════════════════════════════════════════════════════════
  test('10. Viewer badge stays absent after switching files', async ({ page, context }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const ts = Date.now();

    await loginUser(alicePage, `LspOwner2_${ts}`);
    await loginUser(bobPage, `LspViewer2_${ts}`);

    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `LSP_RBAC2_${ts}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await createFile(alicePage, 'a.ts');
    await alicePage.waitForTimeout(500);
    await createFile(alicePage, 'b.py');
    await alicePage.waitForTimeout(500);
    await inviteUser(alicePage, `LspViewer2_${ts}`, 'viewer');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);

    // Check on first file
    await bobPage.locator('.ide-scrollbar').getByText('a.ts').click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });
    await bobPage.waitForTimeout(3000);
    await expect(bobPage.locator('[data-testid="lsp-status-badge"]')).not.toBeVisible();

    // Switch file — badge must still not appear
    await bobPage.locator('.ide-scrollbar').getByText('b.py').click();
    await bobPage.waitForTimeout(3000);
    await expect(bobPage.locator('[data-testid="lsp-status-badge"]')).not.toBeVisible();

    console.log('[LSP Test 10] Viewer badge absent across file switches ✓');
    await bobPage.close();
  });
});
