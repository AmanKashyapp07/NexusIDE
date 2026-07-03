import { test, expect, type Page } from '@playwright/test';

// Helper to invite a user to the workspace to avoid 403 Forbidden redirects
async function inviteUser(page: Page, username: string, role: 'editor' | 'viewer' | 'admin') {
  await page.click('button:has-text("Share")');
  await page.fill('input[placeholder="Username or Email"]', username);
  await page.selectOption('select', role);
  await page.click('button:has-text("Invite")');

  // Confirm the user appears in the collaborator list
  const collaboratorRow = page.locator(`.flex.items-center.justify-between:has-text("${username}")`);
  await expect(collaboratorRow).toBeVisible({ timeout: 10000 });

  // Close the invite modal by clicking the backdrop overlay
  await page.click('.fixed.inset-0', { position: { x: 10, y: 10 } });
}

// Helper to perform hydration-safe login
async function loginUser(page: Page, username: string) {
  await page.goto('/login');
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
  await page.waitForTimeout(1500); // Wait for React tree and WebSocket status to settle
  await page.click('button[title="New File"]');
  const sidebarInput = page.locator('.ide-scrollbar input');
  await sidebarInput.waitFor({ state: 'visible', timeout: 15000 });
  await sidebarInput.focus();
  await sidebarInput.fill(filename);
  await sidebarInput.press('Enter');
}

test.describe('Collaborative Engine E2E Integration Suite', () => {
  
  test('synchronizes typing between users and enforces roles', async ({ page, context }) => {
    // ─── SETUP TWO INDEPENDENT USERS ───
    const alicePage = page;
    
    const browser = context.browser();
    if (!browser) throw new Error('Browser is not initialized');
    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();

    const timestamp = Date.now();
    const aliceName = `Alice_${timestamp}`;
    const bobName = `Bob_${timestamp}`;

    // 1. Alice logs in (Registers User)
    await loginUser(alicePage, aliceName);

    // 2. Bob logs in (Registers User)
    await loginUser(bobPage, bobName);

    // 3. Alice creates a workspace
    const workspaceTitle = `E2E_WS_${timestamp}`;
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', workspaceTitle);
    await alicePage.click('button:has-text("Create Now")');

    // Wait for redirect to IDE
    await expect(alicePage).toHaveURL(/\/ide\/[a-f0-9-]+/);
    const ideUrl = alicePage.url();
    const workspaceId = ideUrl.split('/ide/')[1].split('/')[0];

    // Wait for environment bootstrap overlay to disappear
    await alicePage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    await alicePage.waitForSelector('text=Select a file from the explorer to begin.');

    // 4. Alice creates a file
    await createFile(alicePage, 'index.js');

    // Wait for the Monaco Editor to render
    await alicePage.waitForSelector('.monaco-editor', { timeout: 25000 });

    // 5. Alice invites Bob as an Editor
    await inviteUser(alicePage, bobName, 'editor');

    // 6. Bob navigates to Alice's workspace
    await bobPage.goto(`/ide/${workspaceId}`);
    await bobPage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    // Bob selects the file Alice created
    const fileSelector = bobPage.locator('.ide-scrollbar').getByText('index.js');
    await expect(fileSelector).toBeVisible();
    await fileSelector.click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 25000 });

    // 7. Collaborative typing verification
    await alicePage.locator('.monaco-editor').first().click();
    await alicePage.waitForTimeout(500);
    await alicePage.keyboard.type('// Alice writes first\n', { delay: 20 });
    await alicePage.keyboard.type('const a = 12;\n', { delay: 20 });

    // Verify Bob's screen updates with Alice's typing
    const bobEditor = bobPage.locator('.monaco-editor');
    await expect(bobEditor).toContainText('Alice writes first');
    await expect(bobEditor).toContainText('const a = 12;');

    // Bob focuses editor by clicking it
    await bobPage.locator('.monaco-editor').first().click();
    await bobPage.waitForTimeout(500);
    await bobPage.keyboard.type('// Bob responds here\n', { delay: 20 });
    await bobPage.keyboard.type('const b = 24;\n', { delay: 20 });

    // Verify Alice's screen updates with Bob's typing
    const aliceEditor = alicePage.locator('.monaco-editor');
    await expect(aliceEditor).toContainText('Bob responds here');
    await expect(aliceEditor).toContainText('const b = 24;');

    // 8. Role Transition & Enforcement (Editor -> Viewer)
    await alicePage.click('button:has-text("Share")');
    const bobRoleRow = alicePage.locator(`.flex.items-center.justify-between:has-text("${bobName}")`);
    await bobRoleRow.locator('select').selectOption('viewer');
    await alicePage.click('.fixed.inset-0', { position: { x: 10, y: 10 } });

    // Bob reloads to refresh permissions
    await bobPage.reload();
    await bobPage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    
    // Bob opens index.js again
    await bobPage.click('text=index.js');
    await bobPage.waitForSelector('.monaco-editor', { timeout: 25000 });

    // Bob should see the View Only Lock Badge
    await expect(bobPage.locator('text=View Only')).toBeVisible();

    // Bob tries to type but it should block typing
    await bobPage.locator('.monaco-editor').first().click();
    await bobPage.keyboard.type('// Bob trying to edit as viewer');

    // Verify Bob's typing was NOT appended to Alice's screen
    await expect(aliceEditor).not.toContainText('viewer');
  });

  // ─── TEST 2: Real-time File Tree Sync & Deletion "Rug Pull" ───
  test('synchronizes file tree live and handles active file deletion gracefully', async ({ page, context }) => {
    const alicePage = page;
    const browser = context.browser();
    if (!browser) throw new Error('Browser not initialized');
    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();
    const aliceName = `Alice_${timestamp}`;
    const bobName = `Bob_${timestamp}`;

    // Setup: Login both users first to register them in DB
    await loginUser(alicePage, aliceName);
    await loginUser(bobPage, bobName);

    // Alice creates workspace
    await alicePage.goto('/dashboard');
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Sync_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await alicePage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    // Alice invites Bob
    await inviteUser(alicePage, bobName, 'editor');

    // Bob navigates to workspace
    await bobPage.goto(`/ide/${workspaceId}`);
    await bobPage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    // 1. Alice creates a file
    await createFile(alicePage, 'shared-data.json');

    // 2. Bob should see the file appear in his sidebar WITHOUT reloading
    const bobFileSelector = bobPage.locator('.ide-scrollbar').getByText('shared-data.json');
    await expect(bobFileSelector).toBeVisible({ timeout: 10000 });
    
    // Bob opens the file
    await bobFileSelector.click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 25000 });

    // 3. The Rug Pull: Alice deletes the file while Bob is actively looking at it
    const aliceFileRow = alicePage.locator('.ide-scrollbar .group', { hasText: 'shared-data.json' });
    await aliceFileRow.hover();
    await aliceFileRow.locator('button[title="Delete File"]').click(); 
    
    // Accept delete confirmation
    const confirmButton = alicePage.locator('button:has-text("Confirm"), button:has-text("Delete")');
    if (await confirmButton.isVisible()) {
      await confirmButton.click();
    }

    // 4. Verification: Bob's UI should react safely
    await expect(bobFileSelector).toBeHidden({ timeout: 5000 });
    await expect(bobPage.locator('.monaco-editor')).toBeHidden();
    await expect(bobPage.locator('text=Select a file from the explorer to begin.')).toBeVisible();
  });

  // ─── TEST 3: IDE Presence, Avatars & Ghost Cursor Cleanup ───
  test('tracks user presence and cleans up cursors when users leave', async ({ page, context }) => {
    const alicePage = page;
    const browser = context.browser();
    if (!browser) throw new Error('Browser not initialized');
    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();
    const aliceName = `Alice_${timestamp}`;
    const bobName = `Bob_${timestamp}`;

    // Setup: Login both users first to register them in DB
    await loginUser(alicePage, aliceName);
    await loginUser(bobPage, bobName);

    // Alice creates workspace
    await alicePage.goto('/dashboard');
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Presence_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await alicePage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    // Alice invites Bob
    await inviteUser(alicePage, bobName, 'editor');

    // Alice creates file
    await createFile(alicePage, 'presence.js');
    await alicePage.waitForSelector('.monaco-editor', { timeout: 25000 });

    // Bob navigates to workspace
    await bobPage.goto(`/ide/${workspaceId}`);
    await bobPage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    await bobPage.locator('.ide-scrollbar').getByText('presence.js').click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 25000 });

    // 1. Check Avatar Presence in Navbar
    const bobAvatar = alicePage.locator(`header [title="${bobName}"]`);
    await expect(bobAvatar).toBeVisible({ timeout: 10000 });

    // 2. Check Editor Cursor Awareness
    await bobPage.locator('.monaco-editor').first().click();
    await bobPage.waitForTimeout(500);
    await bobPage.keyboard.type('// Bob is here');

    // Alice's editor should render a remote cursor widget
    const remoteCursor = alicePage.locator('[class*="yRemoteSelectionHead-"]').first();
    await expect(remoteCursor).toBeVisible({ timeout: 10000 });

    // 3. Ghost Cursor Cleanup
    await bobPage.close();

    // Bob's avatar should disappear
    await expect(bobAvatar).toBeHidden({ timeout: 10000 });

    // Bob's cursor MUST be removed
    await expect(remoteCursor).toBeHidden({ timeout: 10000 });
  });

  // ─── TEST 4: Interactive Shared Terminal Execution & Output Streaming ───
  test('streams interactive terminal input and execution output to all peers live', async ({ page, context }) => {
    const alicePage = page;
    const browser = context.browser();
    if (!browser) throw new Error('Browser not initialized');
    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();
    const aliceName = `Alice_${timestamp}`;
    const bobName = `Bob_${timestamp}`;

    // Setup: Login both users first to register them in DB
    await loginUser(alicePage, aliceName);
    await loginUser(bobPage, bobName);

    // Alice creates workspace
    await alicePage.goto('/dashboard');
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Terminal_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await alicePage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    // Alice invites Bob
    await inviteUser(alicePage, bobName, 'editor');

    // Bob navigates to workspace
    await bobPage.goto(`/ide/${workspaceId}`);
    await bobPage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    // Alice creates a script file to execute
    await createFile(alicePage, 'script.js');
    await alicePage.waitForSelector('.monaco-editor', { timeout: 25000 });

    // Bob opens script.js immediately so he is listening to document synchronization live
    await bobPage.locator('.ide-scrollbar').getByText('script.js').click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 25000 });

    // Alice types a standard script
    await alicePage.locator('.monaco-editor').first().click();
    await alicePage.waitForTimeout(500);
    await alicePage.keyboard.type('console.log("EXECUTION_START");\n', { delay: 20 });
    await alicePage.keyboard.type('setTimeout(() => console.log("ASYNC_DONE"), 500);\n', { delay: 20 });

    // Wait for Bob's editor view to show the text live in-memory via WebSocket
    await expect(bobPage.locator('.monaco-editor')).toContainText('ASYNC_DONE', { timeout: 15000 });

    // Crucial: Wait for the 800ms server debounce file-write to commit script.js to the container disk
    await alicePage.waitForTimeout(2000);

    // Locate terminal components
    const aliceTerminalTextarea = alicePage.locator('.xterm-helper-textarea');
    const aliceTerminalBody = alicePage.locator('.xterm');
    
    const bobTerminalTextarea = bobPage.locator('.xterm-helper-textarea');
    const bobTerminalBody = bobPage.locator('.xterm');

    // Ensure both independent terminal shells are ready and interactive
    await expect(aliceTerminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await expect(bobTerminalBody).toContainText('sandbox:~#', { timeout: 25000 });

    // Alice triggers execution inside her terminal
    await aliceTerminalTextarea.focus();
    await alicePage.keyboard.type('node script.js', { delay: 20 });
    await alicePage.keyboard.press('Enter');

    // Verification: Alice's terminal outputs correctly
    await expect(aliceTerminalBody).toContainText('EXECUTION_START', { timeout: 5000 });
    await expect(aliceTerminalBody).toContainText('ASYNC_DONE', { timeout: 5000 });

    // Bob triggers execution inside his terminal
    await bobTerminalTextarea.focus();
    await bobPage.keyboard.type('node script.js', { delay: 20 });
    await bobPage.keyboard.press('Enter');

    // Verification: Bob's terminal outputs correctly
    await expect(bobTerminalBody).toContainText('EXECUTION_START', { timeout: 5000 });
    await expect(bobTerminalBody).toContainText('ASYNC_DONE', { timeout: 5000 });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 5: Simultaneous Conflicting Edits (CRDT Stress Test)
  // ═══════════════════════════════════════════════════════════════════════════════
  test('resolves simultaneous conflicting edits without data corruption', async ({ page, context }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();
    const bobName = `Bob_Simul_${timestamp}`;

    // 1. Setup & Auth for Alice
    await loginUser(alicePage, `Alice_Simul_${timestamp}`);

    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Simul_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await alicePage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    await createFile(alicePage, 'conflict.js');
    await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });

    // 2. Setup & Auth for Bob
    await loginUser(bobPage, bobName);

    // 3. Invite Bob using the helper function defined in collaboration.spec.ts
    await inviteUser(alicePage, bobName, 'editor');

    // 4. Bob joins the workspace and opens the file
    await bobPage.goto(`/ide/${workspaceId}`);
    await bobPage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    await bobPage.click('text=conflict.js');
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });

    // Ensure Yjs bindings are fully initialized
    await alicePage.waitForTimeout(2000);

    // 5. THE CLASH: Both users fire massive inputs at the exact same millisecond
    const aliceInput = 'const a = "ALICE_WAS_HERE";\n'.repeat(5);
    const bobInput = 'const b = "BOB_WAS_HERE";\n'.repeat(5);

    // Focus/Click the editors first to activate Monaco's text listeners
    await alicePage.locator('.monaco-editor').first().click();
    await bobPage.locator('.monaco-editor').first().click();
    await alicePage.waitForTimeout(500);

    await Promise.all([
      alicePage.keyboard.type(aliceInput),
      bobPage.keyboard.type(bobInput)
    ]);

    // 6. Verify Convergence
    // Wait for the Yjs State Vectors to cross the wire and settle the CRDT math
    await alicePage.waitForTimeout(4000);

    const aliceContent = await alicePage.locator('.monaco-editor').innerText();
    const bobContent = await bobPage.locator('.monaco-editor').innerText();

    // Both editors MUST process all keystrokes without overriding the other entirely,
    // and both strings must converge to be exactly identical.
    expect(aliceContent.length).toBeGreaterThan(0);
    expect(aliceContent).toContain('ALICE_WAS_HERE');
    expect(aliceContent).toContain('BOB_WAS_HERE');
    expect(aliceContent).toEqual(bobContent);
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 6: Collaborative File Renaming & Connection Stability
  // ═══════════════════════════════════════════════════════════════════════════════
  test('syncs file renames live while other users are actively editing without breaking the socket', async ({ page, context }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();
    const bobName = `Bob_Rename_${timestamp}`;

    // 1. Setup & Auth for Alice
    await loginUser(alicePage, `Alice_Rename_${timestamp}`);
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Rename_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await alicePage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    // Create initial file
    await createFile(alicePage, 'old-name.js');
    await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });

    // 2. Setup & Auth for Bob
    await loginUser(bobPage, bobName);

    // 3. Invite Bob using the helper function
    await inviteUser(alicePage, bobName, 'editor');

    // 4. Bob joins and opens the file
    await bobPage.goto(`/ide/${workspaceId}`);
    await bobPage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    await bobPage.click('text=old-name.js');
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });

    // 5. Bob starts typing
    await bobPage.locator('.monaco-editor').first().click();
    await bobPage.waitForTimeout(500);
    await bobPage.keyboard.type('// Bob is typing before rename\n');
    await expect(alicePage.locator('.monaco-editor')).toContainText('before rename', { timeout: 5000 });

    // Locate terminal components for Alice
    const aliceTerminalTextarea = alicePage.locator('.xterm-helper-textarea');
    const aliceTerminalBody = alicePage.locator('.xterm');
    await expect(aliceTerminalBody).toContainText('sandbox:~#', { timeout: 25000 });

    // 6. Alice renames the file via the terminal inside the container
    await aliceTerminalTextarea.focus();
    await alicePage.keyboard.type('mv old-name.js new-name.js', { delay: 10 });
    await alicePage.keyboard.press('Enter');

    // 7. Verify Bob sees the new name in the sidebar without requiring a page reload
    // (terminal mv fires a file_created event for new-name.js; old entry may linger)
    await expect(bobPage.locator('.ide-scrollbar').getByText('new-name.js')).toBeVisible({ timeout: 10000 });

    // Since the original file was deleted, the active editor closes.
    // Both Alice and Bob open the renamed file.
    await alicePage.locator('.ide-scrollbar').getByText('new-name.js').click();
    await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });

    await bobPage.locator('.ide-scrollbar').getByText('new-name.js').click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });

    // 8. Verify Y-Websocket connection isn't severed by the rename operation
    await bobPage.locator('.monaco-editor').first().click();
    await bobPage.waitForTimeout(500);
    await bobPage.keyboard.type('// Bob typing AFTER rename');

    // Alice must receive the new text, proving the WebSocket room transferred or remained stable
    await expect(alicePage.locator('.monaco-editor')).toContainText('AFTER rename', { timeout: 10000 });
  });

});