import { test, expect, type Page } from '@playwright/test';

const APP_URL = 'http://localhost:5173';

// Helper to invite a user to the workspace to avoid 403 Forbidden redirects
async function inviteUser(page: Page, username: string, role: 'editor' | 'viewer' | 'admin') {
  await page.click('button:has-text("Share")');
  await page.fill('input[placeholder="Username or Email"]', username);
  await page.selectOption('select', role);
  await page.click('button:has-text("Invite")');
  const collaboratorRow = page.locator(`.flex.items-center.justify-between:has-text("${username}")`);
  await expect(collaboratorRow).toBeVisible({ timeout: 10000 });
  await page.click('.fixed.inset-0', { position: { x: 10, y: 10 } });
}

// Helper that waits for the IDE to finish booting.
// "Booting environment..." only renders when !user || !workspaceId.
// On a fast second-visit the state is already initialised and the element
// may never appear, so we CANNOT rely on waitForSelector(state:'detached').
// Instead: wait up to 3s for it to appear; if it never does, we're already
// past the loading screen and can proceed immediately.
async function waitForBootComplete(page: Page) {
  const loadingEl = page.locator('text=Booting environment...');
  try {
    // Short poll: did the spinner even show up?
    await loadingEl.waitFor({ state: 'visible', timeout: 3000 });
    // It appeared — now wait for it to go away
    await loadingEl.waitFor({ state: 'detached', timeout: 35000 });
  } catch {
    // Never appeared (fast load / cached state) — that's fine, just continue
  }
}

// Helper to perform hydration-safe login
async function loginUser(page: Page, username: string) {
  await page.goto(`${APP_URL}/login`);
  const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
  await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
  await usernameInput.click();
  await usernameInput.fill(username);
  const submitBtn = page.locator('button[type="submit"]');
  await expect(submitBtn).toBeEnabled({ timeout: 10000 });
  await submitBtn.click();
  await expect(page).toHaveURL(/\/dashboard/);
}

// Helper to create a file safely after React render settles
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
    if (editors && editors[0]) {
      editors[0].focus();
    }
  });
}

async function waitForEditorModel(page: Page, filename: string) {
  await page.waitForFunction((expectedName) => {
    const editors = (window as any).monaco?.editor?.getEditors();
    if (!editors || editors.length === 0) return false;
    const model = editors[0].getModel();
    if (!model) return false;
    return model.uri.path.endsWith(expectedName);
  }, filename, { timeout: 25000 });
}

test.describe('Collaborative Engine E2E Integration Suite', () => {

  // TEST 1: Bidirectional typing sync & role enforcement
  test('synchronizes typing between users and enforces roles', async ({ page, context }) => {
    const alicePage = page;
    const browser = context.browser();
    if (!browser) throw new Error('Browser is not initialized');
    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();
    const aliceName = `Alice_${timestamp}`;
    const bobName = `Bob_${timestamp}`;

    await loginUser(alicePage, aliceName);
    await loginUser(bobPage, bobName);

    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `E2E_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await expect(alicePage).toHaveURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);
    await alicePage.waitForSelector('text=Select a file from the explorer to begin.');

    await createFile(alicePage, 'index.js');
    await alicePage.waitForSelector('.monaco-editor', { timeout: 25000 });
    await inviteUser(alicePage, bobName, 'editor');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    const fileSelector = bobPage.locator('.ide-scrollbar').getByText('index.js');
    await expect(fileSelector).toBeVisible();
    await fileSelector.click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 25000 });

    await alicePage.locator('.monaco-editor').first().click();
    await alicePage.waitForTimeout(500);
    await alicePage.keyboard.type('// Alice writes first\n', { delay: 20 });
    await alicePage.keyboard.type('const a = 12;\n', { delay: 20 });

    const bobEditor = bobPage.locator('.monaco-editor');
    await expect(bobEditor).toContainText('Alice writes first');
    await expect(bobEditor).toContainText('const a = 12;');

    await bobPage.locator('.monaco-editor').first().click();
    await bobPage.waitForTimeout(500);
    await bobPage.keyboard.type('// Bob responds here\n', { delay: 20 });
    await bobPage.keyboard.type('const b = 24;\n', { delay: 20 });

    const aliceEditor = alicePage.locator('.monaco-editor');
    await expect(aliceEditor).toContainText('Bob responds here');
    await expect(aliceEditor).toContainText('const b = 24;');

    // Role transition: Editor -> Viewer
    await alicePage.click('button:has-text("Share")');
    const bobRoleRow = alicePage.locator(`.flex.items-center.justify-between:has-text("${bobName}")`);
    await bobRoleRow.locator('select').selectOption('viewer');
    await alicePage.click('.fixed.inset-0', { position: { x: 10, y: 10 } });

    await bobPage.reload();
    await waitForBootComplete(bobPage);
    await bobPage.click('text=index.js');
    await bobPage.waitForSelector('.monaco-editor', { timeout: 25000 });
    await expect(bobPage.locator('text=View Only')).toBeVisible();

    await bobPage.locator('.monaco-editor').first().click();
    await bobPage.keyboard.type('// Bob trying to edit as viewer');
    await expect(aliceEditor).not.toContainText('viewer');
  });

  // TEST 2: Real-time File Tree Sync & Deletion "Rug Pull"
  test('synchronizes file tree live and handles active file deletion gracefully', async ({ page, context }) => {
    const alicePage = page;
    const browser = context.browser();
    if (!browser) throw new Error('Browser not initialized');
    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();

    await loginUser(alicePage, `Alice_${timestamp}`);
    await loginUser(bobPage, `Bob_${timestamp}`);

    await alicePage.goto('/dashboard');
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Sync_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);
    await inviteUser(alicePage, `Bob_${timestamp}`, 'editor');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);

    await createFile(alicePage, 'shared-data.json');

    const bobFileSelector = bobPage.locator('.ide-scrollbar').getByText('shared-data.json');
    await expect(bobFileSelector).toBeVisible({ timeout: 10000 });
    await bobFileSelector.click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 25000 });

    const aliceFileRow = alicePage.locator('.ide-scrollbar .group', { hasText: 'shared-data.json' });
    await aliceFileRow.hover();
    await aliceFileRow.locator('button[title="Delete File"]').click();
    const confirmButton = alicePage.locator('button:has-text("Confirm"), button:has-text("Delete")');
    if (await confirmButton.isVisible()) await confirmButton.click();

    await expect(bobFileSelector).toBeHidden({ timeout: 5000 });
    await expect(bobPage.locator('.monaco-editor')).toBeHidden();
    await expect(bobPage.locator('text=Select a file from the explorer to begin.')).toBeVisible();
  });

  // TEST 3: IDE Presence, Avatars & Ghost Cursor Cleanup
  test('tracks user presence and cleans up cursors when users leave', async ({ page, context }) => {
    const alicePage = page;
    const browser = context.browser();
    if (!browser) throw new Error('Browser not initialized');
    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();

    await loginUser(alicePage, `Alice_${timestamp}`);
    await loginUser(bobPage, `Bob_${timestamp}`);

    await alicePage.goto('/dashboard');
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Presence_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);
    await inviteUser(alicePage, `Bob_${timestamp}`, 'editor');

    await createFile(alicePage, 'presence.js');
    await alicePage.waitForSelector('.monaco-editor', { timeout: 25000 });

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('presence.js').click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 25000 });

    const bobAvatar = alicePage.locator(`header [title="Bob_${timestamp}"]`);
    await expect(bobAvatar).toBeVisible({ timeout: 10000 });

    await bobPage.locator('.monaco-editor').first().click();
    await bobPage.waitForTimeout(500);
    await bobPage.keyboard.type('// Bob is here');
    const remoteCursor = alicePage.locator('[class*="yRemoteSelectionHead-"]').first();
    await expect(remoteCursor).toBeVisible({ timeout: 10000 });

    await bobPage.close();
    await expect(bobAvatar).toBeHidden({ timeout: 10000 });
    await expect(remoteCursor).toBeHidden({ timeout: 10000 });
  });

  // TEST 4: Interactive Shared Terminal Execution & Output Streaming
  test('streams interactive terminal input and execution output to all peers live', async ({ page, context }) => {
    const alicePage = page;
    const browser = context.browser();
    if (!browser) throw new Error('Browser not initialized');
    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();

    await loginUser(alicePage, `Alice_${timestamp}`);
    await loginUser(bobPage, `Bob_${timestamp}`);

    await alicePage.goto('/dashboard');
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Terminal_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);
    await inviteUser(alicePage, `Bob_${timestamp}`, 'editor');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);

    await createFile(alicePage, 'script.js');
    await alicePage.waitForSelector('.monaco-editor', { timeout: 25000 });
    await bobPage.locator('.ide-scrollbar').getByText('script.js').click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 25000 });

    await alicePage.locator('.monaco-editor').first().click();
    await alicePage.waitForTimeout(500);
    await alicePage.keyboard.type('console.log("EXECUTION_START");\n', { delay: 20 });
    await alicePage.keyboard.type('setTimeout(() => console.log("ASYNC_DONE"), 500);\n', { delay: 20 });

    await expect(bobPage.locator('.monaco-editor')).toContainText('ASYNC_DONE', { timeout: 15000 });
    await alicePage.waitForTimeout(2000);

    const aliceTerminalTextarea = alicePage.locator('.xterm-helper-textarea');
    const aliceTerminalBody = alicePage.locator('.xterm');
    const bobTerminalTextarea = bobPage.locator('.xterm-helper-textarea');
    const bobTerminalBody = bobPage.locator('.xterm');

    await expect(aliceTerminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await expect(bobTerminalBody).toContainText('sandbox:~#', { timeout: 25000 });

    await aliceTerminalTextarea.focus();
    await alicePage.keyboard.type('node script.js', { delay: 20 });
    await alicePage.keyboard.press('Enter');
    await expect(aliceTerminalBody).toContainText('EXECUTION_START', { timeout: 5000 });
    await expect(aliceTerminalBody).toContainText('ASYNC_DONE', { timeout: 5000 });

    await bobTerminalTextarea.focus();
    await bobPage.keyboard.type('node script.js', { delay: 20 });
    await bobPage.keyboard.press('Enter');
    await expect(bobTerminalBody).toContainText('EXECUTION_START', { timeout: 5000 });
    await expect(bobTerminalBody).toContainText('ASYNC_DONE', { timeout: 5000 });
  });

  // TEST 5: Simultaneous Conflicting Edits (CRDT Stress Test)
  test('resolves simultaneous conflicting edits without data corruption', async ({ page, context }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();
    const bobName = `Bob_Simul_${timestamp}`;

    await loginUser(alicePage, `Alice_Simul_${timestamp}`);
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Simul_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await createFile(alicePage, 'conflict.js');
    await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });

    await loginUser(bobPage, bobName);
    await inviteUser(alicePage, bobName, 'editor');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.click('text=conflict.js');
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });
    await alicePage.waitForTimeout(2000);

    const aliceInput = 'const a = "ALICE_WAS_HERE";\n'.repeat(5);
    const bobInput = 'const b = "BOB_WAS_HERE";\n'.repeat(5);

    await waitForEditorReady(alicePage);
    await focusEditor(alicePage);
    await alicePage.keyboard.type(aliceInput);
    await alicePage.waitForTimeout(500);

    await waitForEditorReady(bobPage);
    await focusEditor(bobPage);
    await bobPage.keyboard.type(bobInput);

    // Use Playwright auto-retry assertions to handle potential CPU/network latency
    // when running the full test suite in resource-constrained environments.
    await expect(async () => {
      const aliceContent = await getEditorValue(alicePage);
      const bobContent = await getEditorValue(bobPage);
      expect(aliceContent.length).toBeGreaterThan(0);
      expect(aliceContent).toContain('ALICE_WAS_HERE');
      expect(aliceContent).toContain('BOB_WAS_HERE');
      expect(aliceContent).toEqual(bobContent);
    }).toPass({ timeout: 12000, intervals: [1000] });
  });

  // TEST 6: Collaborative File Renaming & Connection Stability
  test('syncs file renames live while other users are actively editing without breaking the socket', async ({ page, context }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();
    const bobName = `Bob_Rename_${timestamp}`;

    await loginUser(alicePage, `Alice_Rename_${timestamp}`);
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Rename_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await createFile(alicePage, 'old-name.js');
    await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });

    await loginUser(bobPage, bobName);
    await inviteUser(alicePage, bobName, 'editor');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.click('text=old-name.js');
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });

    await bobPage.locator('.monaco-editor').first().click();
    await bobPage.waitForTimeout(500);
    await bobPage.keyboard.type('// Bob is typing before rename\n');
    await expect(alicePage.locator('.monaco-editor')).toContainText('before rename', { timeout: 5000 });

    const aliceTerminalTextarea = alicePage.locator('.xterm-helper-textarea');
    const aliceTerminalBody = alicePage.locator('.xterm');
    await expect(aliceTerminalBody).toContainText('sandbox:~#', { timeout: 25000 });

    await aliceTerminalTextarea.focus();
    await alicePage.keyboard.type('mv old-name.js new-name.js', { delay: 10 });
    await alicePage.keyboard.press('Enter');

    await expect(bobPage.locator('.ide-scrollbar').getByText('new-name.js')).toBeVisible({ timeout: 10000 });

    await alicePage.locator('.ide-scrollbar').getByText('new-name.js').click();
    await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });
    await bobPage.locator('.ide-scrollbar').getByText('new-name.js').click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });

    await bobPage.locator('.monaco-editor').first().click();
    await bobPage.waitForTimeout(500);
    await bobPage.keyboard.type('// Bob typing AFTER rename');
    await expect(alicePage.locator('.monaco-editor')).toContainText('AFTER rename', { timeout: 10000 });
  });

  // =============================================================================
  // TEST 7: Late-Joiner Content Integrity (catches Yjs + REST double-init bug)
  //
  // THE BUG THIS CATCHES:
  //   User A writes "console.log('iiita')" and the content is persisted to DB.
  //   User B joins later. CodeEditor does TWO things on mount:
  //     1. Fetches saved content via REST and seeds the Monaco model directly.
  //     2. Yjs WebsocketProvider syncs server doc which ALSO has that content.
  //   MonacoBinding sees content in both → doubles it.
  //
  //   This was NOT caught by earlier tests because every prior test had BOTH users
  //   start simultaneously on an EMPTY file. The bug only triggers when content
  //   already exists in the file at the time the second user joins.
  // =============================================================================
  test('late-joining user sees exact content once — no duplication or data loss', async ({ page, context }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();
    const aliceName = `Alice_Late_${timestamp}`;
    const bobName = `Bob_Late_${timestamp}`;
    const SENTINEL = `UNIQUE_SENTINEL_${timestamp}`;

    await loginUser(alicePage, aliceName);
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Late_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await createFile(alicePage, 'late.js');
    await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });
    await alicePage.locator('.monaco-editor').first().click();
    await alicePage.waitForTimeout(500);
    await alicePage.keyboard.type(`console.log("${SENTINEL}");`, { delay: 20 });

    // CRITICAL: Wait for the 800ms debounce to flush content to Postgres + Docker.
    // Simulates real workflow: type → save → walk away → peer joins later.
    await alicePage.waitForTimeout(3000);

    await loginUser(bobPage, bobName);
    await inviteUser(alicePage, bobName, 'editor');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('late.js').click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });
    await bobPage.waitForTimeout(2000);

    // THE CRITICAL ASSERTION: content must appear EXACTLY ONCE
    await expect(async () => {
      const bobEditorText = await getEditorValue(bobPage);
      expect(bobEditorText).toContain(SENTINEL);
      // The duplication bug causes count = 2
      expect(bobEditorText.split(SENTINEL).length - 1).toBe(1);
    }).toPass({ timeout: 15000, intervals: [1000] });

    await expect(async () => {
      const aliceEditorText = await getEditorValue(alicePage);
      expect(aliceEditorText).toContain(SENTINEL);
      expect(aliceEditorText.split(SENTINEL).length - 1).toBe(1);
    }).toPass({ timeout: 15000, intervals: [1000] });

    // Bob types after joining — must sync without causing further duplication
    await bobPage.locator('.monaco-editor').first().click();
    await bobPage.waitForTimeout(500);
    await bobPage.keyboard.type('\n// Bob appended this', { delay: 20 });
    
    // Auto-retry checking updated content since UI updates are async
    await expect(async () => {
      const aliceFinal = await getEditorValue(alicePage);
      const bobFinal = await getEditorValue(bobPage);
      expect(aliceFinal).toContain('Bob appended this');
      expect(aliceFinal.split(SENTINEL).length - 1).toBe(1);
      expect(bobFinal.split(SENTINEL).length - 1).toBe(1);
      expect(aliceFinal).toEqual(bobFinal);
    }).toPass({ timeout: 10000, intervals: [1000] });
  });

  // =============================================================================
  // TEST 8: Reconnect After Disconnect — Content Integrity & No Duplication
  //
  // User B joins, leaves (navigates away, destroying the Yjs provider), then
  // rejoins the same file. A fresh provider creates a new Yjs doc and syncs
  // from the server — content must appear exactly once, not doubled.
  // =============================================================================
  test('reconnecting user sees correct content once without duplication', async ({ page, context }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();
    const SENTINEL = `RECONNECT_${timestamp}`;

    await loginUser(alicePage, `Alice_Reconn_${timestamp}`);
    await loginUser(bobPage, `Bob_Reconn_${timestamp}`);

    await alicePage.goto('/dashboard');
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Reconn_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await inviteUser(alicePage, `Bob_Reconn_${timestamp}`, 'editor');

    await createFile(alicePage, 'reconnect.js');
    await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });
    await alicePage.locator('.monaco-editor').first().click();
    await alicePage.waitForTimeout(500);
    await alicePage.keyboard.type(`const x = "${SENTINEL}";`, { delay: 20 });
    await alicePage.waitForTimeout(3000);

    // Bob joins first time
    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('reconnect.js').click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });
    await bobPage.waitForTimeout(2000);

    await expect(async () => {
      const firstJoinText = await getEditorValue(bobPage);
      expect(firstJoinText).toContain(SENTINEL);
      expect(firstJoinText.split(SENTINEL).length - 1).toBe(1);
    }).toPass({ timeout: 15000, intervals: [1000] });

    // Bob navigates away (destroys Yjs provider)
    await bobPage.goto('/dashboard');
    await bobPage.waitForURL(/\/dashboard/);
    await bobPage.waitForTimeout(1000);

    // Bob rejoins
    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('reconnect.js').click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });
    // Give Yjs time to reconnect and sync from the server before asserting
    await bobPage.waitForTimeout(2000);

    // Auto-retry assertion after reconnect to handle load sync latency
    await expect(async () => {
      const reconnectText = await getEditorValue(bobPage);
      expect(reconnectText).toContain(SENTINEL);
      expect(reconnectText.split(SENTINEL).length - 1).toBe(1);
    }).toPass({ timeout: 15000, intervals: [1000] });
  });

  // =============================================================================
  // TEST 9: Rapid File Switching — Provider Cleanup & No Content Leakage
  //
  // Switching files rapidly must cleanly destroy the old Yjs provider before
  // mounting the new one. Failure modes:
  //   - Old file content bleeds into new file (provider not torn down)
  //   - New file content doubled (two providers attach to same Monaco model)
  // =============================================================================
  test('rapid file switches do not leak content between files or duplicate on rejoin', async ({ page, context }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();
    const FILE_A_CONTENT = `FILE_A_${timestamp}`;
    const FILE_B_CONTENT = `FILE_B_${timestamp}`;

    await loginUser(alicePage, `Alice_Switch_${timestamp}`);
    await loginUser(bobPage, `Bob_Switch_${timestamp}`);
    
    alicePage.on('console', msg => console.log(`[Alice] ${msg.text()}`));
    bobPage.on('console', msg => console.log(`[Bob] ${msg.text()}`));

    await alicePage.goto('/dashboard');
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Switch_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);
    await inviteUser(alicePage, `Bob_Switch_${timestamp}`, 'editor');

    // Alice creates file-a.js with unique content
    await createFile(alicePage, 'file-a.js');
    await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });
    await alicePage.locator('.monaco-editor').first().click();
    await alicePage.waitForTimeout(300);
    await alicePage.keyboard.type(`console.log("${FILE_A_CONTENT}");`, { delay: 20 });
    await alicePage.waitForTimeout(3000);

    // Alice creates file-b.js with different unique content
    await createFile(alicePage, 'file-b.js');
    await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });
    await alicePage.locator('.monaco-editor').first().click();
    await alicePage.waitForTimeout(300);
    await alicePage.keyboard.type(`console.log("${FILE_B_CONTENT}");`, { delay: 20 });
    await alicePage.waitForTimeout(3000);

    // Bob joins
    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);

    // Bob rapidly switches: file-a -> file-b -> file-a -> file-b
    for (let i = 0; i < 2; i++) {
      await bobPage.locator('.ide-scrollbar').getByText('file-a.js').click();
      await bobPage.waitForTimeout(300);
      await bobPage.locator('.ide-scrollbar').getByText('file-b.js').click();
      await bobPage.waitForTimeout(300);
    }
    // Wait for the Monaco model URI + Yjs provider to fully settle after rapid switching
    await bobPage.waitForTimeout(4000);

    // Verify file-b.js: correct, no duplication, no leakage from file-a
    await bobPage.locator('.ide-scrollbar').getByText('file-b.js').click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });
    // Wait for Monaco to finish switching to file-b's model after the rapid switches
    await waitForEditorModel(bobPage, 'file-b.js');
    await bobPage.waitForTimeout(2000);

    await expect(async () => {
      const bobFileBText = await getEditorValue(bobPage);
      expect(bobFileBText).toContain(FILE_B_CONTENT);
      expect(bobFileBText).not.toContain(FILE_A_CONTENT);
      expect(bobFileBText.split(FILE_B_CONTENT).length - 1).toBe(1);
    }).toPass({ timeout: 15000, intervals: [1000] });

    // Verify file-a.js: correct, no duplication, no leakage from file-b
    await bobPage.locator('.ide-scrollbar').getByText('file-a.js').click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });
    // Wait for Monaco to finish switching to file-a's model
    await waitForEditorModel(bobPage, 'file-a.js');
    // Give Yjs time to sync after a fresh file switch
    await bobPage.waitForTimeout(1500);

    await expect(async () => {
      const { modelText, ydocText, synced } = await bobPage.evaluate(() => {
        const editors = (window as any).monaco?.editor?.getEditors();
        const modelText = editors && editors[0] ? editors[0].getModel()?.getValue() || '' : '';
        const ydoc = (window as any).debugYdoc;
        const ydocText = ydoc ? ydoc.getText('monaco').toString() : 'NO_YDOC';
        return { modelText, ydocText, synced: !!ydoc };
      });
      
      console.log(`[Test 9 Debug] modelText: "${modelText}", ydocText: "${ydocText}"`);
      
      expect(modelText).toContain(FILE_A_CONTENT);
      expect(modelText).not.toContain(FILE_B_CONTENT);
      expect(modelText.split(FILE_A_CONTENT).length - 1).toBe(1);
    }).toPass({ timeout: 8000, intervals: [1000] });
  });

});
// =============================================================================
  // TEST 10: CRDT Undo/Redo Stack Isolation
  //
  // THE BUG THIS CATCHES:
  //   In standard text editors, Ctrl+Z undoes the last local change. In a
  //   collaborative editor without a configured Yjs UndoManager, Ctrl+Z will
  //   undo the last change in the document globally (wiping out a peer's work),
  //   or cause document corruption/desync between the local model and Yjs.
  // =============================================================================
  test('maintains isolated undo/redo stacks per user without affecting peer edits', async ({ page, context }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();

    await loginUser(alicePage, `Alice_Undo_${timestamp}`);
    await loginUser(bobPage, `Bob_Undo_${timestamp}`);

    await alicePage.goto('/dashboard');
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Undo_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await inviteUser(alicePage, `Bob_Undo_${timestamp}`, 'editor');
    await createFile(alicePage, 'undo-test.js');
    await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('undo-test.js').click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });

    // 1. Alice types first edit
    await waitForEditorReady(alicePage);
    await focusEditor(alicePage);
    await alicePage.keyboard.type('// Alice Edit 1\n', { delay: 10 });
    await alicePage.waitForTimeout(500);

    // 2. Bob types his edit
    await waitForEditorReady(bobPage);
    await focusEditor(bobPage);
    await bobPage.keyboard.type('// Bob Edit 1\n', { delay: 10 });
    await bobPage.waitForTimeout(500);

    // 3. Alice types second edit (single character to bypass Monaco word-grouping in undo)
    await focusEditor(alicePage);
    await alicePage.keyboard.type('X');
    
    // Ensure both editors see all edits including X
    await expect(async () => {
      const bobText = await getEditorValue(bobPage);
      expect(bobText).toContain('Alice Edit 1');
      expect(bobText).toContain('Bob Edit 1');
      expect(bobText).toContain('X');
    }).toPass({ timeout: 5000, intervals: [500] });

    // 4. Alice triggers Undo via programmatic Monaco command
    await alicePage.evaluate(() => {
      const ed = (window as any).monaco.editor.getEditors()[0];
      if (ed) {
        ed.focus();
        ed.trigger('keyboard', 'undo', null);
      }
    });

    // 5. Verification: Alice's Edit 2 (X) should be gone. Bob's Edit 1 MUST remain.
    await expect(async () => {
      const aliceText = await getEditorValue(alicePage);
      const bobText = await getEditorValue(bobPage);
      
      expect(aliceText).toContain('Alice Edit 1');
      expect(aliceText).toContain('Bob Edit 1');
      expect(aliceText).not.toContain('X'); // Alice's last edit (X) undone
      
      expect(aliceText).toEqual(bobText); // Both peers still perfectly synced
    }).toPass({ timeout: 5000, intervals: [500] });
  });

  // =============================================================================
  // TEST 11: Network Partition & Offline Editing Recovery
  //
  // THE BUG THIS CATCHES:
  //   User loses internet, continues typing, while peers continue typing.
  //   When internet returns, the WebSocket reconnects. The CRDT must merge 
  //   the divergent histories without overwriting either party's work.
  // =============================================================================
  test('synchronizes correctly after a network partition without data loss', async ({ page, context }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();

    await loginUser(alicePage, `Alice_Offline_${timestamp}`);
    await loginUser(bobPage, `Bob_Offline_${timestamp}`);

    await alicePage.goto('/dashboard');
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Offline_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await inviteUser(alicePage, `Bob_Offline_${timestamp}`, 'editor');
    await createFile(alicePage, 'partition.js');
    await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('partition.js').click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });

    // Establish baseline text
    await focusEditor(alicePage);
    await alicePage.keyboard.type('// Baseline\n');
    await expect(bobPage.locator('.monaco-editor')).toContainText('Baseline', { timeout: 5000 });

    // Simulate Bob losing internet connection
    await bobContext.setOffline(true);
    await bobPage.waitForTimeout(1000);

    // Bob types offline
    await focusEditor(bobPage);
    await bobPage.keyboard.type('// Bob offline edit\n');

    // Alice types online simultaneously
    await focusEditor(alicePage);
    await alicePage.keyboard.type('// Alice online edit\n');

    // Verify divergence (Alice doesn't see Bob's edit, Bob doesn't see Alice's)
    let aliceCurrent = await getEditorValue(alicePage);
    let bobCurrent = await getEditorValue(bobPage);
    expect(aliceCurrent).not.toContain('Bob offline edit');
    expect(bobCurrent).not.toContain('Alice online edit');

    // Simulate internet restoration
    await bobContext.setOffline(false);

    // Both edits must merge cleanly without wiping each other out
    await expect(async () => {
      const aliceFinal = await getEditorValue(alicePage);
      const bobFinal = await getEditorValue(bobPage);
      
      expect(aliceFinal).toContain('Bob offline edit');
      expect(aliceFinal).toContain('Alice online edit');
      expect(aliceFinal).toEqual(bobFinal);
    }).toPass({ timeout: 15000, intervals: [1000] });
  });



  // =============================================================================
  // TEST 13: Late Joiner Full Workspace State Sync
  //
  // THE BUG THIS CATCHES:
  //   A user joins a workspace that already has multiple files created and 
  //   modified by the host. The new user's file tree is empty, missing some 
  //   files, or clicking the files shows stale/empty content because the initial 
  //   REST fetch or WebSocket state sync failed to hydrate the current state.
  // =============================================================================
  test('late-joining user receives the fully updated file tree and file contents', async ({ page, context }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();
    const CONTENT_1 = `ALPHA_DATA_${timestamp}`;
    const CONTENT_2 = `BETA_DATA_${timestamp}`;

    await loginUser(alicePage, `Alice_LateTree_${timestamp}`);
    await loginUser(bobPage, `Bob_LateTree_${timestamp}`);

    await alicePage.goto('/dashboard');
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `LateTree_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    // 1. Alice creates File 1 and adds content
    await createFile(alicePage, 'file-alpha.js');
    await waitForEditorModel(alicePage, 'file-alpha.js');
    await focusEditor(alicePage);
    await alicePage.keyboard.type(`const a = "${CONTENT_1}";`, { delay: 10 });
    
    // 2. Alice creates File 2 and adds content
    await createFile(alicePage, 'file-beta.js');
    await waitForEditorModel(alicePage, 'file-beta.js');
    await focusEditor(alicePage);
    await alicePage.keyboard.type(`const b = "${CONTENT_2}";`, { delay: 10 });

    // CRITICAL: Wait for the autosave debounce to flush to DB/Server
    await alicePage.waitForTimeout(3000);

    // 3. Invite Bob *after* files are established
    await inviteUser(alicePage, `Bob_LateTree_${timestamp}`, 'editor');

    // 4. Bob joins the workspace
    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);

    // 5. Verify Bob's file tree populated correctly
    const bobFileAlpha = bobPage.locator('.ide-scrollbar').getByText('file-alpha.js');
    const bobFileBeta = bobPage.locator('.ide-scrollbar').getByText('file-beta.js');
    
    await expect(bobFileAlpha).toBeVisible({ timeout: 15000 });
    await expect(bobFileBeta).toBeVisible({ timeout: 15000 });

    // 6. Verify Bob sees the correct content in File 1
    await bobFileAlpha.click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });
    await expect(async () => {
      const textAlpha = await getEditorValue(bobPage);
      expect(textAlpha).toContain(CONTENT_1);
    }).toPass({ timeout: 10000, intervals: [1000] });

    // 7. Verify Bob sees the correct content in File 2
    await bobFileBeta.click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });
    await expect(async () => {
      const textBeta = await getEditorValue(bobPage);
      expect(textBeta).toContain(CONTENT_2);
    }).toPass({ timeout: 10000, intervals: [1000] });
  });

  // =============================================================================
  // TEST 14: Live File Creation and CRDT Initialization Freeze
  //
  // THE BUG THIS CATCHES:
  //   Two users are actively in the workspace. User A creates a new file.
  //   User B sees the file in the sidebar, but when they click it, the editor
  //   fails to mount, gets stuck loading, or the CRDT Websocket fails to bind 
  //   to the new file, preventing live typing synchronization.
  // =============================================================================
  test('newly created files sync live to peers and initialize collaborative editor without freezing', async ({ page, context }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();

    await loginUser(alicePage, `Alice_LiveFile_${timestamp}`);
    await loginUser(bobPage, `Bob_LiveFile_${timestamp}`);

    await alicePage.goto('/dashboard');
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `LiveFile_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    // Setup: Both Alice and Bob are in the workspace
    await inviteUser(alicePage, `Bob_LiveFile_${timestamp}`, 'editor');
    
    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);

    // 1. Alice creates a file WHILE Bob is already connected
    const LIVE_FILENAME = `dynamic-${timestamp}.js`;
    await createFile(alicePage, LIVE_FILENAME);
    
    // Ensure Alice's editor initializes
    await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });

    // 2. File should appear instantly in Bob's file tree via socket
    const bobFileNode = bobPage.locator('.ide-scrollbar').getByText(LIVE_FILENAME);
    await expect(bobFileNode).toBeVisible({ timeout: 15000 });

    // 3. Bob clicks the newly created file (this is where the "freeze" usually happens)
    await bobFileNode.click();
    
    // If the app gets stuck here, this selector will timeout and fail the test
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });

    // 4. Verify bidirectional typing works immediately on the newly created file
    await focusEditor(alicePage);
    await alicePage.keyboard.type('// Alice testing live file\n', { delay: 10 });

    await expect(async () => {
      const bobText = await getEditorValue(bobPage);
      expect(bobText).toContain('Alice testing live file');
    }).toPass({ timeout: 10000, intervals: [500] });

    await focusEditor(bobPage);
    await bobPage.keyboard.type('// Bob responding on live file\n', { delay: 10 });

    await expect(async () => {
      const aliceText = await getEditorValue(alicePage);
      expect(aliceText).toContain('Bob responding on live file');
    }).toPass({ timeout: 10000, intervals: [500] });
  });

  // =============================================================================
  // TEST 15: High Latency Initialization (Exposing the 2-Second REST Hack)
  //
  // THE BUG THIS CATCHES:
  //   CodeEditor.tsx implements a 2000ms fallback timer to fetch REST data.
  //   If the WebSocket is artificially delayed beyond 2 seconds, the client 
  //   inserts the REST text, and then the WS syncs the identical text on top,
  //   resulting in duplicated code.
  // =============================================================================
  test('does not duplicate content on slow network connections (exposing fallback race condition)', async ({ page, context }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();
    const CONTENT = `LATENCY_TEST_${timestamp}`;

    await loginUser(alicePage, `Alice_Slow_${timestamp}`);
    await loginUser(bobPage, `Bob_Slow_${timestamp}`);

    await alicePage.goto('/dashboard');
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Slow_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await alicePage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    await inviteUser(alicePage, `Bob_Slow_${timestamp}`, 'editor');
    
    // Alice writes the baseline content
    await createFile(alicePage, 'latency.js');
    await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });
    await focusEditor(alicePage);
    await alicePage.keyboard.type(`const data = "${CONTENT}";`, { delay: 10 });
    
    // Wait for server flush
    await alicePage.waitForTimeout(3000);

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await bobPage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    // CRITICAL: Throttle Bob's WebSocket connection to simulate high latency (e.g., 3.5 seconds)
    // Playwright route interception allows us to delay WS upgrades or mock offline states.
    // We use CDP (Chrome DevTools Protocol) to throttle network for Bob after page load.
    const bobCDP = await bobPage.context().newCDPSession(bobPage);
    await bobCDP.send('Network.enable');
    await bobCDP.send('Network.emulateNetworkConditions', {
      offline: false,
      downloadThroughput: 50 * 1024 / 8, // 50 kbps
      uploadThroughput: 50 * 1024 / 8, 
      latency: 3500 // 3.5 seconds latency - forces the 2s REST fallback to trigger first
    });

    await bobPage.locator('.ide-scrollbar').getByText('latency.js').click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 25000 });

    // Remove throttling so assertions run at normal speed
    await bobCDP.send('Network.emulateNetworkConditions', {
      offline: false, downloadThroughput: -1, uploadThroughput: -1, latency: 0
    });

    // Wait for the throttled WebSocket to finally sync
    await bobPage.waitForTimeout(5000);

    // ASSERTION: The content must only appear exactly once. 
    // If the 2s timer fired AND the WS synced, this will fail because count === 2.
    await expect(async () => {
      const bobText = await getEditorValue(bobPage);
      expect(bobText).toContain(CONTENT);
      expect(bobText.split(CONTENT).length - 1).toBe(1);
    }).toPass({ timeout: 10000, intervals: [1000] });
  });

  // =============================================================================
  // TEST 16: Flaky Network / Rapid Intermittent Drops
  //
  // THE BUG THIS CATCHES:
  //   A user whose Wi-Fi drops and reconnects rapidly (e.g., walking between 
  //   routers). The frontend must gracefully destroy the old WebSocket provider 
  //   and bind a new one without leaking event listeners or causing awareness 
  //   cursor crashes.
  // =============================================================================
  test('maintains editor stability and sync during rapid intermittent network disconnects', async ({ page, context }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();

    await loginUser(alicePage, `Alice_Flaky_${timestamp}`);
    await loginUser(bobPage, `Bob_Flaky_${timestamp}`);

    await alicePage.goto('/dashboard');
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Flaky_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await alicePage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    await inviteUser(alicePage, `Bob_Flaky_${timestamp}`, 'editor');
    
    await createFile(alicePage, 'flaky.js');
    await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await bobPage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    await bobPage.locator('.ide-scrollbar').getByText('flaky.js').click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });

    // Establish baseline
    await focusEditor(alicePage);
    await alicePage.keyboard.type('// Stable line\n');
    await expect(bobPage.locator('.monaco-editor')).toContainText('Stable line');

    // Rapidly toggle Bob's network state 3 times
    for (let i = 0; i < 3; i++) {
      await bobContext.setOffline(true);
      await bobPage.waitForTimeout(500); // Offline for 500ms
      
      // Bob types while offline
      await focusEditor(bobPage);
      await bobPage.keyboard.type(`// Offline edit ${i}\n`);
      
      await bobContext.setOffline(false);
      await bobPage.waitForTimeout(1500); // Online for 1.5s to reconnect
    }

    // Wait for the final reconnections to settle
    await bobPage.waitForTimeout(3000);

    // Verify all offline edits were merged correctly back to Alice
    await expect(async () => {
      const aliceText = await getEditorValue(alicePage);
      const bobText = await getEditorValue(bobPage);
      
      expect(aliceText).toContain('Offline edit 0');
      expect(aliceText).toContain('Offline edit 1');
      expect(aliceText).toContain('Offline edit 2');
      expect(aliceText).toEqual(bobText); // Both must be perfectly synced
    }).toPass({ timeout: 15000, intervals: [1000] });
  });