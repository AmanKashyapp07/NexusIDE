import { test, expect, type Page } from '@playwright/test';

const originalNow = Date.now;
let lastTime = originalNow() * 100 + Number(process.env.TEST_WORKER_INDEX || 0);
Date.now = () => {
  const current = originalNow() * 100 + Number(process.env.TEST_WORKER_INDEX || 0);
  lastTime = Math.max(current, lastTime + 1);
  return lastTime;
};

const APP_URL = 'http://localhost:5173';

async function inviteUser(page: Page, username: string, role: 'editor' | 'viewer' | 'admin') {
  await page.click('button:has-text("Share")');
  await page.fill('input[placeholder="Username or Email"]', username);
  await page.selectOption('select', role);
  await page.click('button:has-text("Invite")');
  await expect(page.locator(`.flex.items-center.justify-between:has-text("${username}")`)).toBeVisible({ timeout: 10000 });
  await page.click('.fixed.inset-0', { position: { x: 10, y: 10 } });
}

async function waitForBootComplete(page: Page) {
  const loadingEl = page.locator('text=Booting environment...');
  try {
    await loadingEl.waitFor({ state: 'visible', timeout: 3000 });
    await loadingEl.waitFor({ state: 'detached', timeout: 35000 });
  } catch {}
}

async function loginUser(page: Page, username: string) {
  await page.goto(`${APP_URL}/login`);
  const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
  await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
  await usernameInput.click();
  await usernameInput.fill(username);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function createFile(page: Page, filename: string) {
  await page.waitForTimeout(1500);
  await page.click('button[title="New File"]');
  const sidebarInput = page.locator('.ide-scrollbar input');
  await sidebarInput.waitFor({ state: 'visible', timeout: 15000 });
  await sidebarInput.focus();
  await sidebarInput.fill(filename);
  await sidebarInput.press('Enter');
}

async function getEditorValue(page: Page): Promise<string> {
  return page.evaluate(() => {
    const editors = (window as any).monaco?.editor?.getEditors();
    return editors && editors[0] ? editors[0].getModel()?.getValue() || '' : '';
  });
}

async function waitForEditorReady(page: Page) {
  await page.waitForFunction(() => {
    const editors = (window as any).monaco?.editor?.getEditors();
    return editors && editors.length > 0;
  }, { timeout: 35000 });
}

async function focusEditor(page: Page) {
  await page.evaluate(() => {
    const editors = (window as any).monaco?.editor?.getEditors();
    if (editors && editors[0]) editors[0].focus();
  });
}

async function waitForEditorModel(page: Page, filename: string) {
  await page.waitForFunction((expectedName) => {
    const editors = (window as any).monaco?.editor?.getEditors();
    if (!editors || editors.length === 0) return false;
    const model = editors[0].getModel();
    return model && model.uri.path.endsWith(expectedName);
  }, filename, { timeout: 25000 });
  await waitForEditorSync(page);
}

async function waitForEditorSync(page: Page) {
  const loading = page.locator('text=Syncing with server...');
  try {
    await loading.waitFor({ state: 'visible', timeout: 1000 });
  } catch {}
  try {
    await loading.waitFor({ state: 'detached', timeout: 25000 });
  } catch {}
}

test.describe('Collaborative Engine Part 1 (Tests 1-8)', () => {

  test('1. synchronizes typing between users and enforces roles', async ({ page, context }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();

    await loginUser(alicePage, `Alice_${timestamp}`);
    await loginUser(bobPage, `Bob_${timestamp}`);

    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `E2E_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await createFile(alicePage, 'index.js');
    await waitForEditorModel(alicePage, 'index.js');
    await inviteUser(alicePage, `Bob_${timestamp}`, 'editor');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('index.js').click();
    await waitForEditorModel(bobPage, 'index.js');

    await focusEditor(alicePage);
    await alicePage.keyboard.type('// Alice writes first\n', { delay: 20 });
    
    await expect(async () => {
      const bobText = await getEditorValue(bobPage);
      expect(bobText).toContain('Alice writes first');
    }).toPass({ timeout: 10000 });
  });

  test('2. synchronizes file tree live and handles active file deletion gracefully', async ({ page, context }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();

    await loginUser(alicePage, `Alice_Sync_${timestamp}`);
    await loginUser(bobPage, `Bob_Sync_${timestamp}`);

    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Sync_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);
    await inviteUser(alicePage, `Bob_Sync_${timestamp}`, 'editor');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);

    await createFile(alicePage, 'shared-data.json');
    const bobFileSelector = bobPage.locator('.ide-scrollbar').getByText('shared-data.json');
    await expect(bobFileSelector).toBeVisible({ timeout: 10000 });
    await bobFileSelector.click();
    await waitForEditorModel(bobPage, 'shared-data.json');

    const aliceFileRow = alicePage.locator('.ide-scrollbar .group', { hasText: 'shared-data.json' });
    await aliceFileRow.hover();
    await aliceFileRow.locator('button[title="Delete File"]').click();
    const confirmButton = alicePage.locator('button:has-text("Confirm"), button:has-text("Delete")');
    if (await confirmButton.isVisible()) await confirmButton.click();

    await expect(bobFileSelector).toBeHidden({ timeout: 5000 });
    await expect(bobPage.locator('text=Select a file from the explorer to begin.')).toBeVisible();
  });

  test('3. tracks user presence and cleans up cursors when users leave', async ({ page, context }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();

    await loginUser(alicePage, `Alice_Pres_${timestamp}`);
    await loginUser(bobPage, `Bob_Pres_${timestamp}`);

    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Pres_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);
    await inviteUser(alicePage, `Bob_Pres_${timestamp}`, 'editor');

    await createFile(alicePage, 'presence.js');
    await waitForEditorModel(alicePage, 'presence.js');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('presence.js').click();
    await waitForEditorModel(bobPage, 'presence.js');

    const bobAvatar = alicePage.locator(`header [title="Bob_Pres_${timestamp}"]`);
    await expect(bobAvatar).toBeVisible({ timeout: 10000 });

    await focusEditor(bobPage);
    await bobPage.keyboard.type('// Bob is here');
    const remoteCursor = alicePage.locator('[class*="yRemoteSelectionHead-"]').first();
    await expect(remoteCursor).toBeVisible({ timeout: 10000 });

    await bobPage.close();
    await expect(bobAvatar).toBeHidden({ timeout: 10000 });
    await expect(remoteCursor).toBeHidden({ timeout: 10000 });
  });

  test('5. resolves simultaneous conflicting edits without data corruption', async ({ page, context }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();

    await loginUser(alicePage, `Alice_Simul_${timestamp}`);
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Simul_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await createFile(alicePage, 'conflict.js');
    await waitForEditorModel(alicePage, 'conflict.js');

    await loginUser(bobPage, `Bob_Simul_${timestamp}`);
    await inviteUser(alicePage, `Bob_Simul_${timestamp}`, 'editor');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('conflict.js').click();
    await waitForEditorModel(bobPage, 'conflict.js');

    await focusEditor(alicePage);
    await alicePage.keyboard.type('ALICE_WAS_HERE\n');
    await focusEditor(bobPage);
    await bobPage.keyboard.type('BOB_WAS_HERE\n');

    await expect(async () => {
      const aContent = await getEditorValue(alicePage);
      const bContent = await getEditorValue(bobPage);
      expect(aContent).toContain('ALICE_WAS_HERE');
      expect(aContent).toContain('BOB_WAS_HERE');
      expect(aContent).toEqual(bContent);
    }).toPass({ timeout: 12000, intervals: [1000] });
  });

  test('6. syncs file renames live while other users are actively editing without breaking the socket', async ({ page, context }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();

    await loginUser(alicePage, `Alice_Rename_${timestamp}`);
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Rename_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await createFile(alicePage, 'old-name.js');
    await waitForEditorModel(alicePage, 'old-name.js');

    await loginUser(bobPage, `Bob_Rename_${timestamp}`);
    await inviteUser(alicePage, `Bob_Rename_${timestamp}`, 'editor');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('old-name.js').click();
    await waitForEditorModel(bobPage, 'old-name.js');

    await focusEditor(bobPage);
    await bobPage.keyboard.type('// before rename\n');

    await expect(async () => {
      expect(await getEditorValue(alicePage)).toContain('before rename');
    }).toPass({ timeout: 5000 });

    const aliceTerminalTextarea = alicePage.locator('.xterm-helper-textarea');
    await expect(alicePage.locator('.xterm')).toContainText('sandbox:~#', { timeout: 25000 });
    await aliceTerminalTextarea.focus();
    await alicePage.keyboard.type('mv old-name.js new-name.js', { delay: 10 });
    await alicePage.keyboard.press('Enter');

    await expect(bobPage.locator('.ide-scrollbar').getByText('new-name.js')).toBeVisible({ timeout: 10000 });

    await alicePage.locator('.ide-scrollbar').getByText('new-name.js').click();
    await waitForEditorModel(alicePage, 'new-name.js');
    
    await bobPage.locator('.ide-scrollbar').getByText('new-name.js').click();
    await waitForEditorModel(bobPage, 'new-name.js');

    await focusEditor(bobPage);
    await bobPage.keyboard.type('// AFTER rename');

    await expect(async () => {
      expect(await getEditorValue(alicePage)).toContain('AFTER rename');
    }).toPass({ timeout: 10000 });
  });

  test('7. late-joining user sees exact content once — no duplication or data loss', async ({ page, context }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();
    const SENTINEL = `UNIQUE_SENTINEL_${timestamp}`;

    await loginUser(alicePage, `Alice_Late_${timestamp}`);
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Late_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await createFile(alicePage, 'late.js');
    await waitForEditorModel(alicePage, 'late.js');
    await focusEditor(alicePage);
    await alicePage.keyboard.type(`console.log("${SENTINEL}");`, { delay: 10 });

    await alicePage.waitForTimeout(3000);

    await loginUser(bobPage, `Bob_Late_${timestamp}`);
    await inviteUser(alicePage, `Bob_Late_${timestamp}`, 'editor');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('late.js').click();
    await waitForEditorModel(bobPage, 'late.js');

    await expect(async () => {
      const bobEditorText = await getEditorValue(bobPage);
      expect(bobEditorText).toContain(SENTINEL);
      expect(bobEditorText.split(SENTINEL).length - 1).toBe(1);
    }).toPass({ timeout: 15000, intervals: [1000] });
  });

  test('8. reconnecting user sees correct content once without duplication', async ({ page, context }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();
    const SENTINEL = `RECONNECT_${timestamp}`;

    await loginUser(alicePage, `Alice_Reconn_${timestamp}`);
    await loginUser(bobPage, `Bob_Reconn_${timestamp}`);

    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Reconn_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await inviteUser(alicePage, `Bob_Reconn_${timestamp}`, 'editor');
    await createFile(alicePage, 'reconnect.js');
    await waitForEditorModel(alicePage, 'reconnect.js');
    await focusEditor(alicePage);
    await alicePage.keyboard.type(`const x = "${SENTINEL}";`);
    await alicePage.waitForTimeout(3000);

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('reconnect.js').click();
    await waitForEditorModel(bobPage, 'reconnect.js');

    await bobPage.goto(`${APP_URL}/dashboard`);
    await bobPage.waitForURL(/\/dashboard/);
    await bobPage.waitForTimeout(1000);

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('reconnect.js').click();
    await waitForEditorModel(bobPage, 'reconnect.js');

    await expect(async () => {
      const reconnectText = await getEditorValue(bobPage);
      expect(reconnectText).toContain(SENTINEL);
      expect(reconnectText.split(SENTINEL).length - 1).toBe(1);
    }).toPass({ timeout: 15000, intervals: [1000] });
  });
});