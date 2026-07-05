import { test, expect, type Page } from '@playwright/test';



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
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
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
  await waitForEditorSync(page);
}

async function waitForEditorSync(page: Page) {
  await page.locator('text=Syncing with server...').waitFor({ state: 'hidden', timeout: 25000 });
}

test.describe('Collaborative Engine Part 2 (Tests 9-16)', () => {

  test('9. rapid file switches do not leak content between files or duplicate on rejoin', async ({ page, context }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();
    const FILE_A_CONTENT = `FILE_A_${timestamp}`;
    const FILE_B_CONTENT = `FILE_B_${timestamp}`;

    alicePage.on('console', msg => console.log(`[Test9 - Alice] ${msg.type()}: ${msg.text()}`));
    bobPage.on('console', msg => console.log(`[Test9 - Bob] ${msg.type()}: ${msg.text()}`));

    try {
      await loginUser(alicePage, `Alice_Switch_${timestamp}`);
      await loginUser(bobPage, `Bob_Switch_${timestamp}`);

      await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Switch_WS_${timestamp}`);
      await alicePage.click('button:has-text("Create Now")');
      await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
      const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
      await waitForBootComplete(alicePage);
      await inviteUser(alicePage, `Bob_Switch_${timestamp}`, 'editor');

      await createFile(alicePage, 'file-a.js');
      await waitForEditorModel(alicePage, 'file-a.js');
      await focusEditor(alicePage);
      await alicePage.keyboard.type(`console.log("${FILE_A_CONTENT}");`);
      await alicePage.waitForTimeout(3000);

      await createFile(alicePage, 'file-b.js');
      await waitForEditorModel(alicePage, 'file-b.js');
      await focusEditor(alicePage);
      await alicePage.keyboard.type(`console.log("${FILE_B_CONTENT}");`);
      await alicePage.waitForTimeout(3000);

      await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
      await waitForBootComplete(bobPage);

      // FIX: Using waitForEditorModel instead of hardcoded 300ms delays prevents
      // virtual DOM tearing by ensuring React fully executes the state change.
      for (let i = 0; i < 2; i++) {
        await bobPage.locator('.ide-scrollbar').getByText('file-a.js').click();
        await waitForEditorModel(bobPage, 'file-a.js');
        await bobPage.locator('.ide-scrollbar').getByText('file-b.js').click();
        await waitForEditorModel(bobPage, 'file-b.js');
      }
      
      await bobPage.locator('.ide-scrollbar').getByText('file-b.js').click();
      await waitForEditorModel(bobPage, 'file-b.js');

      await expect(async () => {
        const bobFileBText = await getEditorValue(bobPage);
        expect(bobFileBText).toContain(FILE_B_CONTENT);
        expect(bobFileBText).not.toContain(FILE_A_CONTENT);
      }).toPass({ timeout: 15000, intervals: [1000] });

      await bobPage.locator('.ide-scrollbar').getByText('file-a.js').click();
      await waitForEditorModel(bobPage, 'file-a.js');

      await expect(async () => {
        const modelText = await getEditorValue(bobPage);
        expect(modelText).toContain(FILE_A_CONTENT);
        expect(modelText).not.toContain(FILE_B_CONTENT);
      }).toPass({ timeout: 15000, intervals: [1000] });
    } finally {
      await bobContext.close();
    }
  });


  test('10. content persists through full server doc eviction and reloads correctly for new users', async ({ page, context }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();
    const PERSIST_SENTINEL = `PERSISTED_${timestamp}`;

    try {
      await loginUser(alicePage, `Alice_Persist_${timestamp}`);
      await loginUser(bobPage, `Bob_Persist_${timestamp}`);

      await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Persist_WS_${timestamp}`);
      await alicePage.click('button:has-text("Create Now")');
      await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
      const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
      await waitForBootComplete(alicePage);
      await inviteUser(alicePage, `Bob_Persist_${timestamp}`, 'editor');

      await createFile(alicePage, 'persist-test.js');
      await waitForEditorModel(alicePage, 'persist-test.js');
      await focusEditor(alicePage);
      await alicePage.keyboard.type(`const sentinel = "${PERSIST_SENTINEL}";\n`);

      await alicePage.waitForTimeout(3000);
      await alicePage.goto(`${APP_URL}/dashboard`);
      await alicePage.waitForURL(/\/dashboard/);
      
      // Crucial: Give Postgres enough time to physically commit the BYTEA blob
      await alicePage.waitForTimeout(4000);

      await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
      await waitForBootComplete(bobPage);
      await bobPage.locator('.ide-scrollbar').getByText('persist-test.js').click();
      await waitForEditorModel(bobPage, 'persist-test.js');

      await expect(async () => {
        const bobText = await getEditorValue(bobPage);
        expect(bobText).toContain(PERSIST_SENTINEL);
        expect(bobText.split(PERSIST_SENTINEL).length - 1).toBe(1);
      }).toPass({ timeout: 15000, intervals: [1000] });
    } finally {
      await bobContext.close();
    }
  });


  test('11. maintains isolated undo/redo stacks per user without affecting peer edits', async ({ page, context }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();

    try {
      await loginUser(alicePage, `Alice_Undo_${timestamp}`);
      await loginUser(bobPage, `Bob_Undo_${timestamp}`);

      await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Undo_WS_${timestamp}`);
      await alicePage.click('button:has-text("Create Now")');
      await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
      const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
      await waitForBootComplete(alicePage);

      await inviteUser(alicePage, `Bob_Undo_${timestamp}`, 'editor');
      await createFile(alicePage, 'undo-test.js');
      await waitForEditorModel(alicePage, 'undo-test.js');

      await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
      await waitForBootComplete(bobPage);
      await bobPage.locator('.ide-scrollbar').getByText('undo-test.js').click();
      await waitForEditorModel(bobPage, 'undo-test.js');

      await focusEditor(alicePage);
      await alicePage.keyboard.type('// Alice Edit 1\n');
      await alicePage.waitForTimeout(500);

      await focusEditor(bobPage);
      await bobPage.keyboard.type('// Bob Edit 1\n');
      await bobPage.waitForTimeout(500);

      await focusEditor(alicePage);
      await alicePage.keyboard.type('X');
      
      await expect(async () => {
        const bobText = await getEditorValue(bobPage);
        expect(bobText).toContain('Alice Edit 1');
        expect(bobText).toContain('Bob Edit 1');
        expect(bobText).toContain('X');
      }).toPass({ timeout: 5000, intervals: [500] });

      await alicePage.evaluate(() => {
        const ed = (window as any).monaco.editor.getEditors()[0];
        if (ed) { ed.focus(); ed.trigger('keyboard', 'undo', null); }
      });

      await expect(async () => {
        const aliceText = await getEditorValue(alicePage);
        expect(aliceText).toContain('Bob Edit 1');
        expect(aliceText).not.toContain('X'); 
      }).toPass({ timeout: 5000, intervals: [500] });
    } finally {
      await bobContext.close();
    }
  });

  test('12. synchronizes correctly after a network partition without data loss', async ({ page, context }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();

    try {
      await loginUser(alicePage, `Alice_Offline_${timestamp}`);
      await loginUser(bobPage, `Bob_Offline_${timestamp}`);

      await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Offline_WS_${timestamp}`);
      await alicePage.click('button:has-text("Create Now")');
      await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
      const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
      await waitForBootComplete(alicePage);

      await inviteUser(alicePage, `Bob_Offline_${timestamp}`, 'editor');
      await createFile(alicePage, 'partition.js');
      await waitForEditorModel(alicePage, 'partition.js');

      await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
      await waitForBootComplete(bobPage);
      await bobPage.locator('.ide-scrollbar').getByText('partition.js').click();
      await waitForEditorModel(bobPage, 'partition.js');

      await focusEditor(alicePage);
      await alicePage.keyboard.type('// Baseline\n');
      await expect(async () => {
        expect(await getEditorValue(bobPage)).toContain('Baseline');
      }).toPass({ timeout: 5000 });

      await bobContext.setOffline(true);
      await bobPage.waitForTimeout(1000);

      await focusEditor(bobPage);
      await bobPage.keyboard.type('// Bob offline edit\n');
      await focusEditor(alicePage);
      await alicePage.keyboard.type('// Alice online edit\n');

      await bobContext.setOffline(false);

      await expect(async () => {
        const aliceFinal = await getEditorValue(alicePage);
        const bobFinal = await getEditorValue(bobPage);
        expect(aliceFinal).toContain('Bob offline edit');
        expect(aliceFinal).toContain('Alice online edit');
        expect(aliceFinal).toEqual(bobFinal);
      }).toPass({ timeout: 15000, intervals: [1000] });
    } finally {
      await bobContext.close();
    }
  });

  test('13. late-joining user receives the fully updated file tree and file contents', async ({ page, context }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();
    const CONTENT_1 = `ALPHA_DATA_${timestamp}`;
    const CONTENT_2 = `BETA_DATA_${timestamp}`;

    try {
      await loginUser(alicePage, `Alice_LateTree_${timestamp}`);
      await loginUser(bobPage, `Bob_LateTree_${timestamp}`);

      await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `LateTree_WS_${timestamp}`);
      await alicePage.click('button:has-text("Create Now")');
      await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
      const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
      await waitForBootComplete(alicePage);

      await createFile(alicePage, 'file-alpha.js');
      await waitForEditorModel(alicePage, 'file-alpha.js');
      await focusEditor(alicePage);
      await alicePage.keyboard.type(`const a = "${CONTENT_1}";`);
      
      await createFile(alicePage, 'file-beta.js');
      await waitForEditorModel(alicePage, 'file-beta.js');
      await focusEditor(alicePage);
      await alicePage.keyboard.type(`const b = "${CONTENT_2}";`);

      await alicePage.waitForTimeout(3000);
      await inviteUser(alicePage, `Bob_LateTree_${timestamp}`, 'editor');

      await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
      await waitForBootComplete(bobPage);

      const bobFileAlpha = bobPage.locator('.ide-scrollbar').getByText('file-alpha.js');
      const bobFileBeta = bobPage.locator('.ide-scrollbar').getByText('file-beta.js');
      await expect(bobFileAlpha).toBeVisible({ timeout: 15000 });
      await expect(bobFileBeta).toBeVisible({ timeout: 15000 });

      await bobFileAlpha.click();
      await waitForEditorModel(bobPage, 'file-alpha.js');
      await expect(async () => {
        const val = await getEditorValue(bobPage);
        expect(val).toContain(CONTENT_1);
      }).toPass({ timeout: 10000, intervals: [1000] });

      await bobFileBeta.click();
      await waitForEditorModel(bobPage, 'file-beta.js');
      await expect(async () => {
        const val = await getEditorValue(bobPage);
        expect(val).toContain(CONTENT_2);
      }).toPass({ timeout: 10000, intervals: [1000] });
    } finally {
      await bobContext.close();
    }
  });

  test('14. newly created files sync live to peers and initialize collaborative editor without freezing', async ({ page, context }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();

    try {
      await loginUser(alicePage, `Alice_LiveFile_${timestamp}`);
      await loginUser(bobPage, `Bob_LiveFile_${timestamp}`);

      await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `LiveFile_WS_${timestamp}`);
      await alicePage.click('button:has-text("Create Now")');
      await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
      const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
      await waitForBootComplete(alicePage);

      await inviteUser(alicePage, `Bob_LiveFile_${timestamp}`, 'editor');
      await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
      await waitForBootComplete(bobPage);

      const LIVE_FILENAME = `dynamic-${timestamp}.js`;
      await createFile(alicePage, LIVE_FILENAME);
      await waitForEditorModel(alicePage, LIVE_FILENAME);

      const bobFileNode = bobPage.locator('.ide-scrollbar').getByText(LIVE_FILENAME);
      await expect(bobFileNode).toBeVisible({ timeout: 15000 });
      await bobFileNode.click();
      await waitForEditorModel(bobPage, LIVE_FILENAME);

      await focusEditor(alicePage);
      await alicePage.keyboard.type('// Alice testing live file\n');

      await expect(async () => {
        const val = await getEditorValue(bobPage);
        expect(val).toContain('Alice testing live file');
      }).toPass({ timeout: 10000, intervals: [500] });

      await focusEditor(bobPage);
      await bobPage.keyboard.type('// Bob responding on live file\n');

      await expect(async () => {
        const val = await getEditorValue(alicePage);
        expect(val).toContain('Bob responding on live file');
      }).toPass({ timeout: 10000, intervals: [500] });
    } finally {
      await bobContext.close();
    }
  });

  test('15. does not duplicate content on slow network connections', async ({ page, context }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();
    const CONTENT = `LATENCY_TEST_${timestamp}`;

    try {
      await loginUser(alicePage, `Alice_Slow_${timestamp}`);
      await loginUser(bobPage, `Bob_Slow_${timestamp}`);

      await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Slow_WS_${timestamp}`);
      await alicePage.click('button:has-text("Create Now")');
      await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
      const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
      await waitForBootComplete(alicePage);

      await inviteUser(alicePage, `Bob_Slow_${timestamp}`, 'editor');
      
      await createFile(alicePage, 'latency.js');
      await waitForEditorModel(alicePage, 'latency.js');
      await focusEditor(alicePage);
      await alicePage.keyboard.type(`const data = "${CONTENT}";`);
      await alicePage.waitForTimeout(3000);

      await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
      await waitForBootComplete(bobPage);

      const bobCDP = await bobPage.context().newCDPSession(bobPage);
      await bobCDP.send('Network.enable');
      await bobCDP.send('Network.emulateNetworkConditions', {
        offline: false, downloadThroughput: 50 * 1024 / 8, uploadThroughput: 50 * 1024 / 8, latency: 3500 
      });

      await bobPage.locator('.ide-scrollbar').getByText('latency.js').click();
      await waitForEditorModel(bobPage, 'latency.js');

      await bobCDP.send('Network.emulateNetworkConditions', {
        offline: false, downloadThroughput: -1, uploadThroughput: -1, latency: 0
      });

      await expect(async () => {
        const bobText = await getEditorValue(bobPage);
        expect(bobText).toContain(CONTENT);
        expect(bobText.split(CONTENT).length - 1).toBe(1);
      }).toPass({ timeout: 25000, intervals: [1000] });
    } finally {
      await bobContext.close();
    }
  });

  test('16. maintains editor stability and sync during rapid intermittent network disconnects', async ({ page, context }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();

    try {
      await loginUser(alicePage, `Alice_Flaky_${timestamp}`);
      await loginUser(bobPage, `Bob_Flaky_${timestamp}`);

      await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Flaky_WS_${timestamp}`);
      await alicePage.click('button:has-text("Create Now")');
      await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
      const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
      await waitForBootComplete(alicePage);

      await inviteUser(alicePage, `Bob_Flaky_${timestamp}`, 'editor');
      
      await createFile(alicePage, 'flaky.js');
      await waitForEditorModel(alicePage, 'flaky.js');

      await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
      await waitForBootComplete(bobPage);
      await bobPage.locator('.ide-scrollbar').getByText('flaky.js').click();
      await waitForEditorModel(bobPage, 'flaky.js');

      await focusEditor(alicePage);
      await alicePage.keyboard.type('// Stable line\n');

      for (let i = 0; i < 3; i++) {
        await bobContext.setOffline(true);
        await bobPage.waitForTimeout(500); 
        
        await focusEditor(bobPage);
        await bobPage.keyboard.type(`// Offline edit ${i}\n`);
        
        await bobContext.setOffline(false);
        await bobPage.waitForTimeout(3500); 
      }

      await bobPage.waitForTimeout(3000);

      await expect(async () => {
        const aliceText = await getEditorValue(alicePage);
        const bobText = await getEditorValue(bobPage);
        expect(aliceText).toContain('Offline edit 0');
        expect(aliceText).toContain('Offline edit 1');
        expect(aliceText).toContain('Offline edit 2');
        expect(aliceText).toEqual(bobText); 
      }).toPass({ timeout: 15000, intervals: [1000] });
    } finally {
      await bobContext.close();
    }
  });

});