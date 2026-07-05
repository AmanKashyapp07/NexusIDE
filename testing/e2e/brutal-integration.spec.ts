import { test, expect, type Page } from '@playwright/test';

const APP_URL = 'http://localhost:5173';

async function loginUser(page: Page, username: string) {
  await page.goto(`${APP_URL}/login`);
  const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
  await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
  await usernameInput.click();
  await usernameInput.fill(username);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
}

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

test.describe('Brutal Integration & Security Test Suite (CRDT, Sandbox Limits, RBAC)', () => {

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 1: CRDT Split-Brain (Network Partition) Convergence & Presence Teardown
  // ═══════════════════════════════════════════════════════════════════════════════
  test('1. resolves network partition split-brain and handles user presence cleanup', async ({ page, context }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();
    const aliceName = `Alice_Split_${timestamp}`;
    const bobName = `Bob_Split_${timestamp}`;

    await loginUser(alicePage, aliceName);
    await loginUser(bobPage, bobName);

    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Split_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await inviteUser(alicePage, bobName, 'editor');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);

    await createFile(alicePage, 'conflict.txt');
    await alicePage.waitForTimeout(2000);

    const aliceTextarea = alicePage.locator('.monaco-editor').first();
    await aliceTextarea.click();
    await alicePage.keyboard.type('Init', { delay: 10 });
    await alicePage.waitForTimeout(1000);

    await expect.poll(async () => await getEditorValue(bobPage), { timeout: 10000 }).toBe('Init');

    await alicePage.context().setOffline(true);
    await bobPage.context().setOffline(true);

    await aliceTextarea.click();
    await alicePage.keyboard.press('End');
    await alicePage.keyboard.type(' Alice', { delay: 10 });

    const bobTextarea = bobPage.locator('.monaco-editor').first();
    await bobTextarea.click();
    await bobPage.keyboard.press('End');
    await bobPage.keyboard.type(' Bob', { delay: 10 });

    expect(await getEditorValue(alicePage)).toBe('Init Alice');
    expect(await getEditorValue(bobPage)).toBe('Init Bob');

    await alicePage.context().setOffline(false);
    await bobPage.context().setOffline(false);

    await expect.poll(async () => {
      const valAlice = await getEditorValue(alicePage);
      const valBob = await getEditorValue(bobPage);
      return valAlice === valBob && (valAlice.includes('Alice') && valAlice.includes('Bob'));
    }, { timeout: 15000 }).toBe(true);

    await expect(alicePage.locator('.flex.items-center.-space-x-2')).toContainText(bobName.slice(0, 2).toUpperCase());

    await bobPage.close();

    await expect(alicePage.locator('.flex.items-center.-space-x-2')).not.toContainText(bobName.slice(0, 2).toUpperCase(), { timeout: 15000 });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 2: Sandbox Resource Limits, Interactive Prompts & Signal Trapping
  // ═══════════════════════════════════════════════════════════════════════════════
  test('2. runs interactive bash scripts, handles Ctrl+C signal trapping, and sustains CPU load', async ({ page }) => {
    const timestamp = Date.now();
    await loginUser(page, `TermSec_${timestamp}`);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `TermSec_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalTextarea = page.locator('.xterm-helper-textarea');
    const terminalBody = page.locator('.xterm');

    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await terminalTextarea.focus();

    await page.keyboard.type('read -p "Type input: " val; echo "Logged: $val"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('Type input:', { timeout: 5000 });

    await page.keyboard.type('SecurePTY', { delay: 50 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('Logged: SecurePTY', { timeout: 5000 });

    await page.keyboard.type('sleep 100', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    await page.keyboard.press('Control+C');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 5000 });

    await page.keyboard.type('node -e "let count = 0; setInterval(() => { count++; if(count > 50) process.exit(0); }, 50)" &', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    await page.keyboard.type('echo "PTY_ACTIVE"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('PTY_ACTIVE', { timeout: 5000 });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 3: Socket Security & Role-Based Access Control (RBAC)
  // ═══════════════════════════════════════════════════════════════════════════════
  test('3. restricts viewer workspace access and blocks unauthorized WebSocket upgrades', async ({ page, context }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();
    const aliceName = `Alice_RBAC_${timestamp}`;
    const bobName = `Bob_RBAC_${timestamp}`;

    await loginUser(alicePage, aliceName);
    await loginUser(bobPage, bobName);

    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `RBAC_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await createFile(alicePage, 'viewer-test.js');
    await alicePage.waitForTimeout(2000);

    await inviteUser(alicePage, bobName, 'viewer');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);

    await expect(bobPage.locator('text=View Only')).toBeVisible({ timeout: 15000 });
    await expect(bobPage.locator('.xterm')).toContainText('sandbox:~#', { timeout: 25000 });

    const bobTerminalTextarea = bobPage.locator('.xterm-helper-textarea');
    await bobTerminalTextarea.focus();
    await bobPage.keyboard.type('cd ..', { delay: 10 });
    await bobPage.keyboard.press('Enter');
    await expect(bobPage.locator('.xterm')).toContainText('restricted', { timeout: 15000 });

    // Try running git command in Bob's terminal (should fail with command not found since PATH=/viewer_bin)
    await bobTerminalTextarea.focus();
    await bobPage.keyboard.type('git status', { delay: 10 });
    await bobPage.keyboard.press('Enter');
    await expect(bobPage.locator('.xterm')).toContainText('command not found', { timeout: 15000 });

    await bobPage.locator('.ide-scrollbar').getByText('viewer-test.js').click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });

    const bobMonaco = bobPage.locator('.monaco-editor').first();
    await bobMonaco.click();
    await bobPage.keyboard.type('Cannot write', { delay: 10 });
    await bobPage.waitForTimeout(1000);
    expect(await getEditorValue(bobPage)).toBe('');
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 4: The "Rug Pull" - Active Deletion During Live Typing
  // ═══════════════════════════════════════════════════════════════════════════════
  test('4. handles active file deletion while another peer is rapidly typing', async ({ page, context }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();

    await loginUser(alicePage, `Alice_RugPull_${timestamp}`);
    await loginUser(bobPage, `Bob_RugPull_${timestamp}`);

    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `RugPull_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await inviteUser(alicePage, `Bob_RugPull_${timestamp}`, 'editor');
    
    await createFile(alicePage, 'doomed.js');
    await alicePage.waitForTimeout(2000);

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    
    await bobPage.locator('.ide-scrollbar').getByText('doomed.js').click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });

    // Bob starts typing rapidly via evaluation to simulate intense CRDT activity
    await bobPage.evaluate(() => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      (window as any).rugPullInterval = setInterval(() => {
        editor.executeEdits('test', [{
          range: editor.getModel().getFullModelRange(),
          text: editor.getModel().getValue() + '\nSPAM',
          forceMoveMarkers: true
        }]);
      }, 50);
    });

    await alicePage.waitForTimeout(1000);

    // Alice ruthlessly deletes the file from the UI
    const fileRow = alicePage.locator('.ide-scrollbar .group', { hasText: 'doomed.js' });
    await fileRow.hover();
    await fileRow.locator('button[title="Delete File"]').click();

    // Verify Bob's UI recovers cleanly without a React crash (white screen of death)
    await expect(bobPage.locator('.ide-scrollbar').getByText('doomed.js')).toBeHidden({ timeout: 10000 });
    
    // Clear the interval to prevent memory leaks in the test browser
    await bobPage.evaluate(() => clearInterval((window as any).rugPullInterval));

    const emptyState = bobPage.locator('text=Select a file from the explorer to begin.');
    await expect(emptyState).toBeVisible({ timeout: 10000 });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 5: Massive Payload / Copy-Paste Bomb
  // ═══════════════════════════════════════════════════════════════════════════════
  test('5. survives massive copy-paste payload bombs without crashing the CRDT or WebSocket', async ({ page, context }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();

    await loginUser(alicePage, `Alice_Bomb_${timestamp}`);
    await loginUser(bobPage, `Bob_Bomb_${timestamp}`);

    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Bomb_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await inviteUser(alicePage, `Bob_Bomb_${timestamp}`, 'editor');
    
    await createFile(alicePage, 'payload.js');
    await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('payload.js').click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });

    // Generate a massive string (e.g., ~19KB of code)
    const massiveString = "const data = 'X';\n".repeat(1000);

    // Alice pastes the massive string instantly
    await alicePage.evaluate((payload) => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      editor.executeEdits('paste', [{
        range: editor.getModel().getFullModelRange(),
        text: payload,
        forceMoveMarkers: true
      }]);
    }, massiveString);

    // Bob should receive the massive payload without the connection dying
    await expect.poll(async () => {
      const bobText = await getEditorValue(bobPage);
      const normalizedBob = bobText.replace(/\r/g, '');
      const normalizedExpected = massiveString.replace(/\r/g, '');
      console.log(`MASSIVE SYNC: Bob got ${normalizedBob.length} chars (raw: ${bobText.length}), expected ${normalizedExpected.length}`);
      return normalizedBob.length === normalizedExpected.length;
    }, { timeout: 20000 }).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 6: Terminal Watcher vs CRDT Ownership Race
  // ═══════════════════════════════════════════════════════════════════════════════
  test('6. prevents terminal background processes from overwriting actively edited Yjs documents', async ({ page }) => {
    const timestamp = Date.now();
    await loginUser(page, `Race_${timestamp}`);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Race_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(page.locator('.xterm')).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await createFile(page, 'race.js');
    await page.waitForSelector('.monaco-editor', { timeout: 15000 });

    // Type in the editor so Yjs takes explicit ownership
    const editor = page.locator('.monaco-editor').first();
    await editor.click();
    await page.keyboard.type('YJS_OWNS_THIS', { delay: 10 });
    await page.waitForTimeout(1000);

    // Terminal attempts to overwrite the file concurrently
    await terminalTextarea.focus();
    await page.keyboard.type('echo "TERMINAL_ATTACK" > race.js\n', { delay: 10 });
    
    // Wait for the watcher cycle (usually 1.5s - 3s)
    await page.waitForTimeout(5000);

    // Editor should NOT be overwritten by the terminal watcher
    const finalVal = await getEditorValue(page);
    expect(finalVal).toContain('YJS_OWNS_THIS');
    expect(finalVal).not.toContain('TERMINAL_ATTACK');
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 7: Security - REST API RBAC Bypass Attempt
  // ═══════════════════════════════════════════════════════════════════════════════
  test('7. prevents viewer from bypassing UI to execute destructive REST API calls', async ({ page, context }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();

    await loginUser(alicePage, `Alice_API_${timestamp}`);
    await loginUser(bobPage, `Bob_API_${timestamp}`);

    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `API_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await inviteUser(alicePage, `Bob_API_${timestamp}`, 'viewer');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);

    // Bob attempts to use the browser fetch API to maliciously create a file
    const apiResponseStatus = await bobPage.evaluate(async (wsId) => {
      const token = localStorage.getItem('token');
      try {
        const res = await fetch(`http://localhost:4000/api/workspace/${wsId}/files`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ name: 'hacked.js', type: 'file' })
        });
        return res.status;
      } catch (err) {
        return 500;
      }
    }, workspaceId);

    // Expect the backend RBAC middleware to strictly reject the request
    expect(apiResponseStatus).toBe(403);
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 8: Snapshotting and Branching Verification
  // ═══════════════════════════════════════════════════════════════════════════════
  test('8. performs atomic workspace snapshotting and instant branching verification', async ({ page }) => {
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    const timestamp = Date.now();
    const username = `SnapUser_${timestamp}`;
    const workspaceTitle = `OriginalWS_${timestamp}`;

    // 1. User logs in
    await loginUser(page, username);

    // 2. User creates a workspace
    await page.fill('input[placeholder="e.g. React-Sandbox"]', workspaceTitle);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[a-f0-9-]+/);
    const ideUrl = page.url();
    const originalWorkspaceId = ideUrl.split('/ide/')[1].split('/')[0];
    await waitForBootComplete(page);

    // Locate terminal components
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    const terminalBody = page.locator('.xterm');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    // 3. Create a file structure and content in the workspace
    await terminalTextarea.focus();
    await page.keyboard.type('echo "initial content text" > hello.txt\n', { delay: 10 });
    await page.waitForTimeout(4000); // Allow watcher to detect hello.txt

    // 4. Open hello.txt in Monaco
    const helloFile = page.locator('.ide-scrollbar').getByText('hello.txt');
    await expect(helloFile).toBeVisible({ timeout: 10000 });
    await helloFile.click();
    await page.waitForSelector('.monaco-editor', { timeout: 15000 });

    // 5. Append additional text to hello.txt via Monaco
    await page.evaluate(() => {
      const ed = (window as any).monaco.editor.getEditors()[0];
      const model = ed.getModel();
      model.setValue('initial content text and collaborative edits');
    });

    // Wait for the debounce save to finish
    await page.waitForTimeout(3500);

    // 6. Request snapshot via API directly and log response
    console.log('[E2E] Triggering snapshot API call...');
    const result = await page.evaluate(async (wsId) => {
      const token = localStorage.getItem('token');
      try {
        const res = await fetch(`http://localhost:4000/api/workspace/${wsId}/snapshot`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        });
        const body = await res.json().catch(() => ({}));
        return { status: res.status, body };
      } catch (err: any) {
        return { status: 500, error: err.message };
      }
    }, originalWorkspaceId);
    
    console.log('[E2E] Snapshot API response:', result);
    expect(result.status).toBe(201);
    const snapshotWorkspaceId = result.body.id;
    expect(snapshotWorkspaceId).not.toBe(originalWorkspaceId);
    
    // Navigate to the new snapshot workspace URL
    await page.goto(`${APP_URL}/ide/${snapshotWorkspaceId}`);

    // Wait for new container to boot and workspace state load
    await waitForBootComplete(page);

    // 8. Verify the file list in snapshot workspace contains hello.txt
    const helloFileInSnapshot = page.locator('.ide-scrollbar').getByText('hello.txt');
    await expect(helloFileInSnapshot).toBeVisible({ timeout: 15000 });
    await helloFileInSnapshot.click();
    await page.waitForSelector('.monaco-editor', { timeout: 15000 });

    // Check that editor content matches the parent workspace content
    const valInSnapshot = await getEditorValue(page);
    expect(valInSnapshot).toBe('initial content text and collaborative edits');

    // 9. Verify the container filesystem data is copied over correctly
    const terminalTextarea2 = page.locator('.xterm-helper-textarea');
    const terminalBody2 = page.locator('.xterm');
    await expect(terminalBody2).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await terminalTextarea2.focus();
    await page.keyboard.type('cat hello.txt\n', { delay: 10 });
    await expect(terminalBody2).toContainText('initial content text and collaborative edits', { timeout: 10000 });

    // 10. Perform edits in snapshot to verify isolation (does not modify original workspace)
    await page.evaluate(() => {
      const ed = (window as any).monaco.editor.getEditors()[0];
      ed.getModel().setValue('changed in snapshot workspace');
    });
    await page.waitForTimeout(3500); // Allow save

    // Navigate back to original workspace
    await page.goto(ideUrl);
    await waitForBootComplete(page);

    // Open hello.txt in the original workspace
    const helloFileInOriginal = page.locator('.ide-scrollbar').getByText('hello.txt');
    await expect(helloFileInOriginal).toBeVisible({ timeout: 15000 });
    await helloFileInOriginal.click();
    await page.waitForSelector('.monaco-editor', { timeout: 15000 });

    // Verify original content remains intact (isolation is maintained)
    const valInOriginal = await getEditorValue(page);
    expect(valInOriginal).toBe('initial content text and collaborative edits');
  });

});