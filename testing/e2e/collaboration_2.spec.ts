import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

const APP_URL = process.env.BASE_URL || 'http://localhost:5173';
const API_URL = (() => {
  const base = process.env.BASE_URL;
  if (!base) return 'http://localhost:4000/api';
  try {
    const u = new URL(base);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') u.port = '4000';
    u.pathname = '/api';
    return u.toString().replace(/\/$/, '');
  } catch { return 'http://localhost:4000/api'; }
})();

async function loginUser(page: Page, request: APIRequestContext, username: string) {
  const res = await request.post(`${API_URL}/auth/test-login`, {
    data: { username, password: 'test' },
  });
  if (!res.ok()) throw new Error(`Login failed for "${username}": ${res.status()} ${await res.text()}`);
  const { token } = await res.json();
  await page.goto(`${APP_URL}/login`);
  await page.evaluate((t) => localStorage.setItem('token', t), token);
  await page.goto(`${APP_URL}/dashboard`);
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
}

async function inviteUser(page: Page, username: string, role: 'editor' | 'viewer' | 'admin') {
  await page.click('button:has-text("Share")');
  await page.fill('input[placeholder="Username or Email"]', username);
  await page.selectOption('select', role);
  await page.click('button:has-text("Invite")');
  await expect(page.locator(`.flex.items-center.justify-between:has-text("${username}")`)).toBeVisible({ timeout: 15000 });
  await page.click('.fixed.inset-0', { position: { x: 10, y: 10 } });
}

async function waitForBootComplete(page: Page) {
  const loadingEl = page.locator('text=Booting environment...');
  try {
    await loadingEl.waitFor({ state: 'visible', timeout: 5000 });
    await loadingEl.waitFor({ state: 'detached', timeout: 45000 });
  } catch {}
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

async function setEditorValue(page: Page, text: string) {
  await page.evaluate((val) => {
    const editors = (window as any).monaco?.editor?.getEditors();
    if (!editors || !editors[0]) return;
    const editor = editors[0];
    const model = editor.getModel();
    if (!model) return;
    const fullRange = model.getFullModelRange();
    editor.executeEdits('test-edit', [{
      range: fullRange,
      text: val,
      forceMoveMarkers: true
    }]);
    editor.pushUndoStop();
  }, text);
}


async function focusEditor(page: Page) {
  await page.evaluate(() => {
    const editors = (window as any).monaco?.editor?.getEditors();
    if (editors && editors[0]) editors[0].focus();
  });
}

async function waitForSocketConnect(page: Page) {
  // Increased from 15s → 25s for real network conditions
  await page.locator('[title="Status: connected"]').waitFor({ state: 'visible', timeout: 25000 });
}

async function waitForEditorModel(page: Page, filename: string) {
  await page.waitForFunction((expectedName) => {
    const editors = (window as any).monaco?.editor?.getEditors();
    if (!editors || editors.length === 0) return false;
    const model = editors[0].getModel();
    return model && model.uri.path.endsWith(expectedName);
  }, filename, { timeout: 30000 });
  await waitForEditorSync(page);
}

async function waitForEditorSync(page: Page) {
  // Use try/catch on both waits: element may never appear (already synced)
  // or may disappear faster than the first wait completes
  const loading = page.locator('text=Syncing with server...');
  try { await loading.waitFor({ state: 'visible', timeout: 1500 }); } catch {}
  try { await loading.waitFor({ state: 'detached', timeout: 30000 }); } catch {}
}

test.describe('Collaborative Engine Part 2 (Tests 9-16)', () => {

  test('9. rapid file switches do not leak content between files or duplicate on rejoin', async ({ page, context, request }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();
    const FILE_A_CONTENT = `FILE_A_${timestamp}`;
    const FILE_B_CONTENT = `FILE_B_${timestamp}`;
    try {
      await loginUser(alicePage, request, `Alice_Switch_${timestamp}`);
      await loginUser(bobPage, request, `Bob_Switch_${timestamp}`);

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
      await alicePage.waitForTimeout(4000);

      await createFile(alicePage, 'file-b.js');
      await waitForEditorModel(alicePage, 'file-b.js');
      await focusEditor(alicePage);
      await alicePage.keyboard.type(`console.log("${FILE_B_CONTENT}");`);
      await alicePage.waitForTimeout(4000);

      await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
      await waitForBootComplete(bobPage);

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
      }).toPass({ timeout: 20000, intervals: [1000] });

      await bobPage.locator('.ide-scrollbar').getByText('file-a.js').click();
      await waitForEditorModel(bobPage, 'file-a.js');

      await expect(async () => {
        const modelText = await getEditorValue(bobPage);
        expect(modelText).toContain(FILE_A_CONTENT);
        expect(modelText).not.toContain(FILE_B_CONTENT);
      }).toPass({ timeout: 20000, intervals: [1000] });
    } finally {
      await bobContext.close();
    }
  });

  test('10. content persists through full server doc eviction and reloads correctly for new users', async ({ page, context, request }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();
    const PERSIST_SENTINEL = `PERSISTED_${timestamp}`;

    try {
      await loginUser(alicePage, request, `Alice_Persist_${timestamp}`);
      await loginUser(bobPage, request, `Bob_Persist_${timestamp}`);

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

      await alicePage.waitForTimeout(4000);
      await alicePage.goto(`${APP_URL}/dashboard`);
      await alicePage.waitForURL(/\/dashboard/);

      // Give Postgres time to physically commit the Yjs BYTEA blob
      await alicePage.waitForTimeout(5000);

      await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
      await waitForBootComplete(bobPage);
      await bobPage.locator('.ide-scrollbar').getByText('persist-test.js').click();
      await waitForEditorModel(bobPage, 'persist-test.js');

      await expect(async () => {
        const bobText = await getEditorValue(bobPage);
        expect(bobText).toContain(PERSIST_SENTINEL);
        expect(bobText.split(PERSIST_SENTINEL).length - 1).toBe(1);
      }).toPass({ timeout: 25000, intervals: [1000] });
    } finally {
      await bobContext.close();
    }
  });

  test('11. maintains isolated undo/redo stacks per user without affecting peer edits', async ({ page, context, request }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();

    try {
      await loginUser(alicePage, request, `Alice_Undo_${timestamp}`);
      await loginUser(bobPage, request, `Bob_Undo_${timestamp}`);

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

      await Promise.all([
        waitForSocketConnect(alicePage),
        waitForSocketConnect(bobPage),
      ]);

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
      }).toPass({ timeout: 20000, intervals: [1000] });

      await alicePage.waitForTimeout(2000);

      await alicePage.evaluate(() => {
        const ed = (window as any).monaco.editor.getEditors()[0];
        if (ed) { ed.focus(); ed.trigger('keyboard', 'undo', null); }
      });

      await expect(async () => {
        const aliceText = await getEditorValue(alicePage);
        expect(aliceText).toContain('Alice Edit 1');
        expect(aliceText).toContain('Bob Edit 1');
        expect(aliceText).not.toContain('X');
      }).toPass({ timeout: 20000, intervals: [1000] });
    } finally {
      await bobContext.close();
    }
  });

  test('12. synchronizes correctly after a network partition without data loss', async ({ page, context, request }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();

    try {
      await loginUser(alicePage, request, `Alice_Offline_${timestamp}`);
      await loginUser(bobPage, request, `Bob_Offline_${timestamp}`);

      await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Offline_WS_${timestamp}`);
      await alicePage.click('button:has-text("Create Now")');
      await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
      const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
      await waitForBootComplete(alicePage);
      await waitForSocketConnect(alicePage);

      await inviteUser(alicePage, `Bob_Offline_${timestamp}`, 'editor');
      await createFile(alicePage, 'partition.js');
      await waitForEditorModel(alicePage, 'partition.js');

      await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
      await waitForBootComplete(bobPage);
      await waitForSocketConnect(bobPage);
      await bobPage.locator('.ide-scrollbar').getByText('partition.js').click();
      await waitForEditorModel(bobPage, 'partition.js');

      await focusEditor(alicePage);
      await alicePage.keyboard.type('// Baseline\n');
      await expect(async () => {
        expect(await getEditorValue(bobPage)).toContain('Baseline');
      }).toPass({ timeout: 20000, intervals: [1000] });

      await bobContext.setOffline(true);
      await bobPage.waitForTimeout(1500);

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
      }).toPass({ timeout: 25000, intervals: [1000] });
    } finally {
      await bobContext.close();
    }
  });

  test('13. late-joining user receives the fully updated file tree and file contents', async ({ page, context, request }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();
    const CONTENT_1 = `ALPHA_DATA_${timestamp}`;
    const CONTENT_2 = `BETA_DATA_${timestamp}`;

    try {
      await loginUser(alicePage, request, `Alice_LateTree_${timestamp}`);
      await loginUser(bobPage, request, `Bob_LateTree_${timestamp}`);

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

      // Longer settle time so both files persist to DB before Bob joins
      await alicePage.waitForTimeout(5000);
      await inviteUser(alicePage, `Bob_LateTree_${timestamp}`, 'editor');

      await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
      await waitForBootComplete(bobPage);

      const bobFileAlpha = bobPage.locator('.ide-scrollbar').getByText('file-alpha.js');
      const bobFileBeta = bobPage.locator('.ide-scrollbar').getByText('file-beta.js');
      await expect(bobFileAlpha).toBeVisible({ timeout: 20000 });
      await expect(bobFileBeta).toBeVisible({ timeout: 20000 });

      await bobFileAlpha.click();
      await waitForEditorModel(bobPage, 'file-alpha.js');
      await expect(async () => {
        const val = await getEditorValue(bobPage);
        expect(val).toContain(CONTENT_1);
      }).toPass({ timeout: 25000, intervals: [1000] });

      await bobFileBeta.click();
      await waitForEditorModel(bobPage, 'file-beta.js');
      await expect(async () => {
        const val = await getEditorValue(bobPage);
        expect(val).toContain(CONTENT_2);
      }).toPass({ timeout: 25000, intervals: [1000] });
    } finally {
      await bobContext.close();
    }
  });

  test('14. newly created files sync live to peers and initialize collaborative editor without freezing', async ({ page, context, request }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();

    try {
      await loginUser(alicePage, request, `Alice_LiveFile_${timestamp}`);
      await loginUser(bobPage, request, `Bob_LiveFile_${timestamp}`);

      await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `LiveFile_WS_${timestamp}`);
      await alicePage.click('button:has-text("Create Now")');
      await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
      const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
      await waitForBootComplete(alicePage);

      await inviteUser(alicePage, `Bob_LiveFile_${timestamp}`, 'editor');
      await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
      await waitForBootComplete(bobPage);

      // Wait for Bob's socket to be connected before Alice creates the file
      // so the file-created socket event is received live (not from REST poll)
      await waitForSocketConnect(bobPage);

      const LIVE_FILENAME = `dynamic-${timestamp}.js`;
      await createFile(alicePage, LIVE_FILENAME);
      await waitForEditorModel(alicePage, LIVE_FILENAME);

      const bobFileNode = bobPage.locator('.ide-scrollbar').getByText(LIVE_FILENAME);
      await expect(bobFileNode).toBeVisible({ timeout: 20000 });
      await bobFileNode.click();
      await waitForEditorModel(bobPage, LIVE_FILENAME);

      await setEditorValue(alicePage, '// Alice testing live file\n');

      await expect(async () => {
        const val = await getEditorValue(bobPage);
        expect(val).toContain('Alice testing live file');
      }).toPass({ timeout: 25000, intervals: [1000] });

      await setEditorValue(bobPage, '// Alice testing live file\n// Bob responding on live file\n');

      await expect(async () => {
        const val = await getEditorValue(alicePage);
        expect(val).toContain('Bob responding on live file');
      }).toPass({ timeout: 25000, intervals: [1000] });
    } finally {
      await bobContext.close();
    }
  });

  test('15. does not duplicate content on slow network connections', async ({ page, context, request }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();
    const CONTENT = `LATENCY_TEST_${timestamp}`;

    try {
      await loginUser(alicePage, request, `Alice_Slow_${timestamp}`);
      await loginUser(bobPage, request, `Bob_Slow_${timestamp}`);

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
      await alicePage.waitForTimeout(4000);

      await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
      await waitForBootComplete(bobPage);

      const bobCDP = await bobPage.context().newCDPSession(bobPage);
      await bobCDP.send('Network.enable');
      await bobCDP.send('Network.emulateNetworkConditions', {
        offline: false, downloadThroughput: 50 * 1024 / 8, uploadThroughput: 50 * 1024 / 8, latency: 3500,
      });

      await bobPage.locator('.ide-scrollbar').getByText('latency.js').click();
      await waitForEditorModel(bobPage, 'latency.js');

      await bobCDP.send('Network.emulateNetworkConditions', {
        offline: false, downloadThroughput: -1, uploadThroughput: -1, latency: 0,
      });

      await expect(async () => {
        const bobText = await getEditorValue(bobPage);
        expect(bobText).toContain(CONTENT);
        expect(bobText.split(CONTENT).length - 1).toBe(1);
      }).toPass({ timeout: 30000, intervals: [1000] });
    } finally {
      await bobContext.close();
    }
  });

  test('16. maintains editor stability and sync during rapid intermittent network disconnects', async ({ page, context, request }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();

    try {
      await loginUser(alicePage, request, `Alice_Flaky_${timestamp}`);
      await loginUser(bobPage, request, `Bob_Flaky_${timestamp}`);

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

      // Wait for both sockets to be stable before starting offline cycles
      await waitForSocketConnect(alicePage);
      await waitForSocketConnect(bobPage);

      await focusEditor(alicePage);
      await alicePage.keyboard.type('// Stable line\n');

      // Wait for the stable line to reach Bob before starting offline cycles
      await expect(async () => {
        expect(await getEditorValue(bobPage)).toContain('Stable line');
      }).toPass({ timeout: 20000, intervals: [1000] });

      for (let i = 0; i < 3; i++) {
        await bobContext.setOffline(true);
        await bobPage.waitForTimeout(800);

        await focusEditor(bobPage);
        await bobPage.keyboard.type(`// Offline edit ${i}\n`);

        await bobContext.setOffline(false);
        // Give Yjs time to reconnect and flush queued ops before next cycle
        await bobPage.waitForTimeout(4000);
      }

      // Extra settle time for all ops to propagate
      await bobPage.waitForTimeout(4000);

      await expect(async () => {
        const aliceText = await getEditorValue(alicePage);
        const bobText = await getEditorValue(bobPage);
        expect(aliceText).toContain('Offline edit 0');
        expect(aliceText).toContain('Offline edit 1');
        expect(aliceText).toContain('Offline edit 2');
        expect(aliceText).toEqual(bobText);
      }).toPass({ timeout: 25000, intervals: [1000] });
    } finally {
      await bobContext.close();
    }
  });
});