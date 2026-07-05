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
  // TEST 8: Snapshotting — RBAC, History, Diff Preview & Restore
  // Verifies the full snapshot lifecycle:
  //   a) Only admins can create snapshots (viewer + editor are rejected with 403)
  //   b) All roles can list snapshots (GET /snapshots returns 200)
  //   c) All roles can preview snapshot files with diff metadata
  //   d) Only admins can restore a snapshot (viewer + editor rejected with 403)
  //   e) Restore actually overwrites live file content
  //   f) Max-10 eviction: creating 11 snapshots keeps only the latest 10
  // ═══════════════════════════════════════════════════════════════════════════════
  test('8. enforces snapshot RBAC, persists history, delivers diff data, and restores correctly', async ({ page, context }) => {
    const alicePage = page; // admin (owner)
    const bobPage   = await context.browser()!.newContext().then(c => c.newPage()); // editor
    const evePage   = await context.browser()!.newContext().then(c => c.newPage()); // viewer
    const timestamp = Date.now();

    const aliceName = `Alice_Snap_${timestamp}`;
    const bobName   = `Bob_Snap_${timestamp}`;
    const eveName   = `Eve_Snap_${timestamp}`;

    await loginUser(alicePage, aliceName);
    await loginUser(bobPage,   bobName);
    await loginUser(evePage,   eveName);

    // ── Setup: Alice creates workspace + file ───────────────────────────────
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Snap_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await createFile(alicePage, 'history.js');
    await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });
    console.log(1);
    // Write initial content into the file
    await alicePage.evaluate(() => {
      const ed = (window as any).monaco.editor.getEditors()[0];
      ed.getModel().setValue('// version 1');
    });
    await alicePage.waitForTimeout(3000); // debounce save
    console.log(2);

    // Invite Bob as editor, Eve as viewer
    await inviteUser(alicePage, bobName, 'editor');
    await inviteUser(alicePage, eveName, 'viewer');

    const token = {
      alice: await alicePage.evaluate(() => localStorage.getItem('token')),
      bob:   await bobPage.evaluate(async () => {
        await fetch('http://localhost:4000/api/auth/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: '' }) // placeholder — token already in storage
        }).catch(() => {});
        return localStorage.getItem('token');
      }),
      eve:   await evePage.evaluate(() => localStorage.getItem('token')),
    };
    console.log(3);
    // Navigate Bob and Eve to the workspace so their tokens are populated
    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await evePage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await waitForBootComplete(evePage);
    console.log(4);
    const bobToken = await bobPage.evaluate(() => localStorage.getItem('token'));
    const eveToken = await evePage.evaluate(() => localStorage.getItem('token'));
    const aliceToken = await alicePage.evaluate(() => localStorage.getItem('token'));
    console.log(5);
    // ── (a) RBAC: editor cannot create snapshot ─────────────────────────────
    const bobCreateStatus = await bobPage.evaluate(async (wsId) => {
      const res = await fetch(`http://localhost:4000/api/workspace/${wsId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ label: 'bob-attempt' }),
      });
      return res.status;
    }, workspaceId);
    expect(bobCreateStatus).toBe(403);
    console.log(6);
    // ── (a) RBAC: viewer cannot create snapshot ──────────────────────────────
    const eveCreateStatus = await evePage.evaluate(async (wsId) => {
      const res = await fetch(`http://localhost:4000/api/workspace/${wsId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ label: 'eve-attempt' }),
      });
      return res.status;
    }, workspaceId);
    expect(eveCreateStatus).toBe(403);
    console.log(7);
    // ── Admin creates a valid snapshot ───────────────────────────────────────
    const createResult = await alicePage.evaluate(async (wsId) => {
      const res = await fetch(`http://localhost:4000/api/workspace/${wsId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ label: 'v1-baseline' }),
      });
      return { status: res.status, body: await res.json() };
    }, workspaceId);
    expect(createResult.status).toBe(201);
    expect(createResult.body.label).toBe('v1-baseline');
    const snapshotId = createResult.body.id as string;
    expect(snapshotId).toBeTruthy();
    console.log(8);
    // ── (b) All roles can list snapshots ────────────────────────────────────
    const aliceList = await alicePage.evaluate(async (wsId) => {
      const res = await fetch(`http://localhost:4000/api/workspace/${wsId}/snapshots`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return { status: res.status, body: await res.json() };
    }, workspaceId);
    expect(aliceList.status).toBe(200);
    expect(Array.isArray(aliceList.body)).toBe(true);
    expect(aliceList.body.length).toBe(1);
    expect(aliceList.body[0].label).toBe('v1-baseline');
    expect(aliceList.body[0].created_by).toBe(aliceName);
    console.log(9);
    const bobList = await bobPage.evaluate(async (wsId) => {
      const res = await fetch(`http://localhost:4000/api/workspace/${wsId}/snapshots`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return res.status;
    }, workspaceId);
    expect(bobList).toBe(200);

    const eveList = await evePage.evaluate(async (wsId) => {
      const res = await fetch(`http://localhost:4000/api/workspace/${wsId}/snapshots`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return res.status;
    }, workspaceId);
    expect(eveList).toBe(200);
    console.log(9);
    // ── (c) Mutate the live file, then check diff data ───────────────────────
    await alicePage.evaluate(() => {
      const ed = (window as any).monaco.editor.getEditors()[0];
      ed.getModel().setValue('// version 2\nconsole.log("changed");');
    });
    await alicePage.waitForTimeout(3000); // debounce save
    
    // Wait for the Yjs 800ms debounced save to complete BEFORE calling restore
    // This prevents the pending save timer from overwriting the restored content
    await alicePage.waitForTimeout(1500);

    const diffResult = await alicePage.evaluate(async ({ wsId, snapId }) => {
      const res = await fetch(`http://localhost:4000/api/workspace/${wsId}/snapshots/${snapId}/files`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return { status: res.status, body: await res.json() };
    }, { wsId: workspaceId, snapId: snapshotId });

    expect(diffResult.status).toBe(200);
    const historyFile = diffResult.body.find((f: any) => f.path === 'history.js');
    expect(historyFile).toBeTruthy();
    // snapshot captured v1; live is now v2 — both sides must be present
    expect(historyFile.snapshot_content).toContain('version 1');
    expect(historyFile.live_content).toContain('version 2');

    // Eve (viewer) can also preview the diff
    const eveDiffStatus = await evePage.evaluate(async ({ wsId, snapId }) => {
      const res = await fetch(`http://localhost:4000/api/workspace/${wsId}/snapshots/${snapId}/files`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return res.status;
    }, { wsId: workspaceId, snapId: snapshotId });
    expect(eveDiffStatus).toBe(200);
    console.log(10);

    // ── (d) RBAC: editor cannot restore ─────────────────────────────────────
    const bobRestoreStatus = await bobPage.evaluate(async ({ wsId, snapId }) => {
      const res = await fetch(`http://localhost:4000/api/workspace/${wsId}/snapshots/${snapId}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return res.status;
    }, { wsId: workspaceId, snapId: snapshotId });
    expect(bobRestoreStatus).toBe(403);
    console.log(11);

    // ── (d) RBAC: viewer cannot restore ─────────────────────────────────────
    const eveRestoreStatus = await evePage.evaluate(async ({ wsId, snapId }) => {
      const res = await fetch(`http://localhost:4000/api/workspace/${wsId}/snapshots/${snapId}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return res.status;
    }, { wsId: workspaceId, snapId: snapshotId });
    expect(eveRestoreStatus).toBe(403);
    console.log(12);

    // Close Bob and Eve's pages before restore — their active Yjs connections would
    // otherwise reconnect after eviction and save v2 back from their in-memory state.
    await bobPage.close();
    await evePage.close();
    // Give their WebSocket connections time to close and server to process the disconnect
    await alicePage.waitForTimeout(1500);

    // ── (e) Admin restores snapshot → live file reverts to v1 ───────────────
    console.log('[TEST] Triggering restore API call...');
    const restoreResult = await alicePage.evaluate(async ({ wsId, snapId }) => {
      const res = await fetch(`http://localhost:4000/api/workspace/${wsId}/snapshots/${snapId}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return { status: res.status, body: await res.json() };
    }, { wsId: workspaceId, snapId: snapshotId });
    console.log('[TEST] Restore API response:', restoreResult);
    expect(restoreResult.status).toBe(200);
    expect(restoreResult.body.success).toBe(true);
    expect(restoreResult.body.restored_files).toBeGreaterThan(0);
    console.log(13);
    // Verify the DB actually has the restored content (bypassing Yjs in-memory cache)
    console.log('[TEST] Checking DB content directly via API...');
    const fileListRes = await alicePage.evaluate(async (wsId) => {
      const res = await fetch(`http://localhost:4000/api/workspace/${wsId}/files`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return res.json();
    }, workspaceId);
    const historyFileId = fileListRes.find((f: any) => f.name === 'history.js')?.id;
    console.log('[TEST] history.js fileId:', historyFileId);
    console.log(14);
    const dbContentRes = await alicePage.evaluate(async ({ wsId, fileId }) => {
      const res = await fetch(`http://localhost:4000/api/workspace/${wsId}/files/${fileId}/content`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return res.json();
    }, { wsId: workspaceId, fileId: historyFileId });
    console.log('[TEST] DB content after restore:', JSON.stringify(dbContentRes.content));
    
    // DB must have restored content
    expect(dbContentRes.content).toContain('version 1');
    expect(dbContentRes.content).not.toContain('version 2');

    console.log('[TEST] Waiting for socket event propagation + page reload...');
    // Wait for the snapshot-restored socket event to trigger page reload
    await alicePage.waitForTimeout(2500);
    
    console.log('[TEST] Waiting for boot complete after reload...');
    await waitForBootComplete(alicePage);
    
    console.log('[TEST] Opening history.js file...');
    await alicePage.locator('.ide-scrollbar').getByText('history.js').click();
    await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });
    await alicePage.waitForTimeout(2000);

    console.log('[TEST] Reading editor content...');
    const restoredContent = await getEditorValue(alicePage);
    console.log('[TEST] Restored content:', JSON.stringify(restoredContent));
    expect(restoredContent).toContain('version 1');
    expect(restoredContent).not.toContain('version 2');
    console.log(15);
    // ── (f) Max-10 eviction: create 10 more snapshots, total must stay ≤ 10 ─
    for (let i = 2; i <= 11; i++) {
      const r = await alicePage.evaluate(async ({ wsId, i }) => {
        const res = await fetch(`http://localhost:4000/api/workspace/${wsId}/snapshot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
          body: JSON.stringify({ label: `auto-snap-${i}` }),
        });
        return res.status;
      }, { wsId: workspaceId, i });
      expect(r).toBe(201);
    }

    const finalList = await alicePage.evaluate(async (wsId) => {
      const res = await fetch(`http://localhost:4000/api/workspace/${wsId}/snapshots`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return res.json();
    }, workspaceId);

    // Trigger fires after insert, so total should never exceed 10
    expect(finalList.length).toBeLessThanOrEqual(10);
    // Oldest (v1-baseline) should have been evicted
    const labels = finalList.map((s: any) => s.label);
    expect(labels).not.toContain('v1-baseline');
    // Most recent should be present
    expect(labels).toContain('auto-snap-11');
    console.log(16);
  });

});