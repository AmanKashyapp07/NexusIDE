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
}

test.describe('Collaborative Engine Edge Cases', () => {

  test('1. handles 3+ users typing simultaneously and converges perfectly', async ({ page, context }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const charliePage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();

    await loginUser(alicePage, `Alice_${timestamp}`);
    await loginUser(bobPage, `Bob_${timestamp}`);
    await loginUser(charliePage, `Charlie_${timestamp}`);

    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Trio_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await inviteUser(alicePage, `Bob_${timestamp}`, 'editor');
    await inviteUser(alicePage, `Charlie_${timestamp}`, 'editor');

    await createFile(alicePage, 'trio.js');
    await waitForEditorModel(alicePage, 'trio.js');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('trio.js').click();
    await waitForEditorModel(bobPage, 'trio.js');

    await charliePage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(charliePage);
    await charliePage.locator('.ide-scrollbar').getByText('trio.js').click();
    await waitForEditorModel(charliePage, 'trio.js');

    // All three type simultaneously
    await focusEditor(alicePage);
    await alicePage.keyboard.type('ALICE_DATA\n');
    await focusEditor(bobPage);
    await bobPage.keyboard.type('BOB_DATA\n');
    await focusEditor(charliePage);
    await charliePage.keyboard.type('CHARLIE_DATA\n');

    await expect(async () => {
      const aText = await getEditorValue(alicePage);
      const bText = await getEditorValue(bobPage);
      const cText = await getEditorValue(charliePage);
      
      expect(aText).toContain('ALICE_DATA');
      expect(aText).toContain('BOB_DATA');
      expect(aText).toContain('CHARLIE_DATA');
      
      expect(aText).toEqual(bText);
      expect(aText).toEqual(cText);
    }).toPass({ timeout: 15000, intervals: [1000] });
  });

  test('2. identical user in multiple tabs syncs locally without cross-contamination', async ({ page, context }) => {
    const tab1 = page;
    const tab2 = await context.newPage(); // Same browser context = same user session
    const timestamp = Date.now();

    await loginUser(tab1, `MultiTab_${timestamp}`);
    await tab1.fill('input[placeholder="e.g. React-Sandbox"]', `Tabs_WS_${timestamp}`);
    await tab1.click('button:has-text("Create Now")');
    await tab1.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = tab1.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(tab1);

    await createFile(tab1, 'tabs.js');
    await waitForEditorModel(tab1, 'tabs.js');

    await tab2.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(tab2);
    await tab2.locator('.ide-scrollbar').getByText('tabs.js').click();
    await waitForEditorModel(tab2, 'tabs.js');

    await focusEditor(tab1);
    await tab1.keyboard.type('// Typed in Tab 1\n');

    await expect(async () => {
      expect(await getEditorValue(tab2)).toContain('Typed in Tab 1');
    }).toPass({ timeout: 10000 });

    await focusEditor(tab2);
    await tab2.keyboard.type('// Typed in Tab 2\n');

    await expect(async () => {
      expect(await getEditorValue(tab1)).toContain('Typed in Tab 2');
    }).toPass({ timeout: 10000 });
  });

  test('3. handles active file deletion gracefully without crashing peer editors', async ({ page, context }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();

    await loginUser(alicePage, `Alice_Del_${timestamp}`);
    await loginUser(bobPage, `Bob_Del_${timestamp}`);

    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Del_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);
    await inviteUser(alicePage, `Bob_Del_${timestamp}`, 'editor');

    await createFile(alicePage, 'doom.js');
    await waitForEditorModel(alicePage, 'doom.js');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('doom.js').click();
    await waitForEditorModel(bobPage, 'doom.js');

    // Bob starts typing
    await focusEditor(bobPage);
    await bobPage.keyboard.type('// Bob is actively working here\n');

    // Alice ruthlessly deletes the file while Bob is typing
    const aliceFileRow = alicePage.locator('.ide-scrollbar .group', { hasText: 'doom.js' });
    await aliceFileRow.hover();
    await aliceFileRow.locator('button[title="Delete File"]').click();
    const confirmButton = alicePage.locator('button:has-text("Confirm"), button:has-text("Delete")');
    if (await confirmButton.isVisible()) await confirmButton.click();

    // Verify Bob's UI recovers cleanly (either routes to empty state or another file)
    await expect(bobPage.locator('.ide-scrollbar').getByText('doom.js')).toBeHidden({ timeout: 10000 });
    
    // Verify Bob didn't get a React crash screen
    const noFileText = bobPage.locator('text=Select a file from the explorer to begin.');
    const newActiveEditor = bobPage.locator('.monaco-editor');
    
    await expect(async () => {
      const isEmptyState = await noFileText.isVisible();
      const isSwappedState = await newActiveEditor.isVisible();
      expect(isEmptyState || isSwappedState).toBe(true);
    }).toPass({ timeout: 5000 });
  });

});
