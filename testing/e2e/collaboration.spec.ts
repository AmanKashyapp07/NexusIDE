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
    await alicePage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    await alicePage.waitForSelector('text=Select a file from the explorer to begin.');

    await createFile(alicePage, 'index.js');
    await alicePage.waitForSelector('.monaco-editor', { timeout: 25000 });
    await inviteUser(alicePage, bobName, 'editor');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await bobPage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
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
    await bobPage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
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
    await alicePage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    await inviteUser(alicePage, `Bob_${timestamp}`, 'editor');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await bobPage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

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
    await alicePage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    await inviteUser(alicePage, `Bob_${timestamp}`, 'editor');

    await createFile(alicePage, 'presence.js');
    await alicePage.waitForSelector('.monaco-editor', { timeout: 25000 });

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await bobPage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
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
    await alicePage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    await inviteUser(alicePage, `Bob_${timestamp}`, 'editor');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await bobPage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

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
    await alicePage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    await createFile(alicePage, 'conflict.js');
    await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });

    await loginUser(bobPage, bobName);
    await inviteUser(alicePage, bobName, 'editor');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await bobPage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    await bobPage.click('text=conflict.js');
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });
    await alicePage.waitForTimeout(2000);

    const aliceInput = 'const a = "ALICE_WAS_HERE";\n'.repeat(5);
    const bobInput = 'const b = "BOB_WAS_HERE";\n'.repeat(5);

    await alicePage.locator('.monaco-editor').first().click();
    await bobPage.locator('.monaco-editor').first().click();
    await alicePage.waitForTimeout(500);

    await Promise.all([
      alicePage.keyboard.type(aliceInput),
      bobPage.keyboard.type(bobInput),
    ]);

    // Use Playwright auto-retry assertions to handle potential CPU/network latency
    // when running the full test suite in resource-constrained environments.
    await expect(async () => {
      const aliceContent = await alicePage.locator('.monaco-editor').innerText();
      const bobContent = await bobPage.locator('.monaco-editor').innerText();
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
    await alicePage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    await createFile(alicePage, 'old-name.js');
    await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });

    await loginUser(bobPage, bobName);
    await inviteUser(alicePage, bobName, 'editor');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await bobPage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
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
    await alicePage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

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
    await bobPage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    await bobPage.locator('.ide-scrollbar').getByText('late.js').click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });
    await bobPage.waitForTimeout(2000);

    // THE CRITICAL ASSERTION: content must appear EXACTLY ONCE
    const bobEditorText = await bobPage.locator('.monaco-editor').innerText();
    expect(bobEditorText).toContain(SENTINEL);
    // The duplication bug causes count = 2
    expect(bobEditorText.split(SENTINEL).length - 1).toBe(1);

    const aliceEditorText = await alicePage.locator('.monaco-editor').innerText();
    expect(aliceEditorText).toContain(SENTINEL);
    expect(aliceEditorText.split(SENTINEL).length - 1).toBe(1);

    // Bob types after joining — must sync without causing further duplication
    await bobPage.locator('.monaco-editor').first().click();
    await bobPage.waitForTimeout(500);
    await bobPage.keyboard.type('\n// Bob appended this', { delay: 20 });
    await expect(alicePage.locator('.monaco-editor')).toContainText('Bob appended this', { timeout: 10000 });

    const aliceFinal = await alicePage.locator('.monaco-editor').innerText();
    const bobFinal = await bobPage.locator('.monaco-editor').innerText();
    expect(aliceFinal.split(SENTINEL).length - 1).toBe(1);
    expect(bobFinal.split(SENTINEL).length - 1).toBe(1);
    expect(aliceFinal).toEqual(bobFinal);
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
    await alicePage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    await inviteUser(alicePage, `Bob_Reconn_${timestamp}`, 'editor');

    await createFile(alicePage, 'reconnect.js');
    await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });
    await alicePage.locator('.monaco-editor').first().click();
    await alicePage.waitForTimeout(500);
    await alicePage.keyboard.type(`const x = "${SENTINEL}";`, { delay: 20 });
    await alicePage.waitForTimeout(3000);

    // Bob joins first time
    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await bobPage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    await bobPage.locator('.ide-scrollbar').getByText('reconnect.js').click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });
    await bobPage.waitForTimeout(2000);

    const firstJoinText = await bobPage.locator('.monaco-editor').innerText();
    expect(firstJoinText.split(SENTINEL).length - 1).toBe(1);

    // Bob navigates away (destroys Yjs provider)
    await bobPage.goto('/dashboard');
    await bobPage.waitForURL(/\/dashboard/);
    await bobPage.waitForTimeout(1000);

    // Bob rejoins
    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await bobPage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    await bobPage.locator('.ide-scrollbar').getByText('reconnect.js').click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });
    await bobPage.waitForTimeout(2000);

    // CRITICAL: After reconnect, sentinel must appear exactly once
    const reconnectText = await bobPage.locator('.monaco-editor').innerText();
    expect(reconnectText).toContain(SENTINEL);
    expect(reconnectText.split(SENTINEL).length - 1).toBe(1);
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

    await alicePage.goto('/dashboard');
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Switch_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await alicePage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
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
    await bobPage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    // Bob rapidly switches: file-a -> file-b -> file-a -> file-b
    for (let i = 0; i < 2; i++) {
      await bobPage.locator('.ide-scrollbar').getByText('file-a.js').click();
      await bobPage.waitForTimeout(300);
      await bobPage.locator('.ide-scrollbar').getByText('file-b.js').click();
      await bobPage.waitForTimeout(300);
    }
    await bobPage.waitForTimeout(2000);

    // Verify file-b.js: correct, no duplication, no leakage from file-a
    await bobPage.locator('.ide-scrollbar').getByText('file-b.js').click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });
    await bobPage.waitForTimeout(1500);

    const bobFileBText = await bobPage.locator('.monaco-editor').innerText();
    expect(bobFileBText).toContain(FILE_B_CONTENT);
    expect(bobFileBText).not.toContain(FILE_A_CONTENT);
    expect(bobFileBText.split(FILE_B_CONTENT).length - 1).toBe(1);

    // Verify file-a.js: correct, no duplication, no leakage from file-b
    await bobPage.locator('.ide-scrollbar').getByText('file-a.js').click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });
    await bobPage.waitForTimeout(1500);

    const bobFileAText = await bobPage.locator('.monaco-editor').innerText();
    expect(bobFileAText).toContain(FILE_A_CONTENT);
    expect(bobFileAText).not.toContain(FILE_B_CONTENT);
    expect(bobFileAText.split(FILE_A_CONTENT).length - 1).toBe(1);
  });

});
