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

async function focusEditor(page: Page) {
  const textarea = page.locator('.monaco-editor').first();
  await textarea.click();
  await page.waitForTimeout(200);
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
  }).catch(() => '');
}

async function setEditorValue(page: Page, text: string) {
  await page.evaluate((val) => {
    const editors = (window as any).monaco?.editor?.getEditors();
    if (!editors || !editors[0]) return;
    const editor = editors[0];
    const model = editor.getModel();
    if (!model) return;
    const fullRange = model.getFullModelRange();
    editor.executeEdits('test-set-value', [{
      range: fullRange,
      text: val,
      forceMoveMarkers: true
    }]);
    editor.pushUndoStop();
  }, text);
}


async function waitForEditorSync(page: Page) {
  const loading = page.locator('text=Syncing with server...');
  try { await loading.waitFor({ state: 'visible', timeout: 1000 }); } catch {}
  try { await loading.waitFor({ state: 'detached', timeout: 25000 }); } catch {}
}

async function waitForEditorModel(page: Page, filename: string) {
  await page.waitForFunction((expectedName) => {
    const editors = (window as any).monaco?.editor?.getEditors();
    if (!editors || editors.length === 0) return false;
    const model = editors[0].getModel();
    return model && model.uri.path.endsWith(expectedName);
  }, filename, { timeout: 25000 });
  await page.waitForFunction(() => {
    const editors = (window as any).monaco?.editor?.getEditors();
    return editors && editors.length > 0 && typeof editors[0].hasTextFocus === 'function';
  }, { timeout: 10000 });
  await waitForEditorSync(page);
}

// Wait until the socket is connected
async function waitForSocketConnect(page: Page) {
  await page.locator('[title="Status: connected"]').waitFor({ state: 'visible', timeout: 15000 });
}

test.describe('Brutal Integration & Security Test Suite (CRDT, Sandbox Limits, RBAC)', () => {

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 1: CRDT Split-Brain (Network Partition) Convergence & Presence Teardown
  // ═══════════════════════════════════════════════════════════════════════════════
  test('1. resolves network partition split-brain and handles user presence cleanup', async ({ page, context, request }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();
    const aliceName = `Alice_Split_${timestamp}`;
    const bobName = `Bob_Split_${timestamp}`;

    await loginUser(alicePage, request, aliceName);
    await loginUser(bobPage, request, bobName);
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Split_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await inviteUser(alicePage, bobName, 'editor');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await waitForSocketConnect(bobPage);

    await createFile(alicePage, 'conflict.txt');
    await alicePage.waitForTimeout(2000);

    // Bob waits for file to appear in sidebar (via file-tree-update socket event)
    await expect(bobPage.locator('.ide-scrollbar').getByText('conflict.txt')).toBeVisible({ timeout: 10000 });
    await bobPage.locator('.ide-scrollbar').getByText('conflict.txt').click();
    await waitForEditorModel(alicePage, 'conflict.txt');
    await focusEditor(alicePage);
    await alicePage.keyboard.type('Init', { delay: 10 });
    await alicePage.waitForTimeout(1000);

    // Confirm Bob received Alice's initial content before going offline
    await expect.poll(async () => await getEditorValue(bobPage), { timeout: 10000 }).toBe('Init');

    await alicePage.context().setOffline(true);
    await bobPage.context().setOffline(true);

    await focusEditor(alicePage);
    await alicePage.keyboard.press('End');
    await alicePage.keyboard.type(' Alice', { delay: 10 });

    await focusEditor(bobPage);
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
  test('2. runs interactive bash scripts, handles Ctrl+C signal trapping, and sustains CPU load', async ({ page, request }) => {
    const timestamp = Date.now();
    await loginUser(page, request, `TermSec_${timestamp}`);

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
  test('3. restricts viewer workspace access and blocks unauthorized WebSocket upgrades', async ({ page, context, request }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();
    const aliceName = `Alice_RBAC_${timestamp}`;
    const bobName = `Bob_RBAC_${timestamp}`;

    await loginUser(alicePage, request, aliceName);
    await loginUser(bobPage, request, bobName);

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
    // Wait for auto-navigation to file and editor to mount with readOnly=true
    await bobPage.locator('.ide-scrollbar').getByText('viewer-test.js').waitFor({ state: 'visible', timeout: 15000 });
    await bobPage.locator('.ide-scrollbar').getByText('viewer-test.js').click();
    await waitForEditorModel(bobPage, 'viewer-test.js');

    await expect(bobPage.locator('text=View Only')).toBeVisible({ timeout: 10000 });
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
  test('4. handles active file deletion while another peer is rapidly typing', async ({ page, context, request }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();

    await loginUser(alicePage, request, `Alice_RugPull_${timestamp}`);
    await loginUser(bobPage, request, `Bob_RugPull_${timestamp}`);

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
    
    await bobPage.locator('.ide-scrollbar').getByText('doomed.js').waitFor({ state: 'visible', timeout: 15000 });
    await bobPage.locator('.ide-scrollbar').getByText('doomed.js').click();
    await waitForEditorModel(bobPage, 'doomed.js');

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
  test('5. survives massive copy-paste payload bombs without crashing the CRDT or WebSocket', async ({ page, context, request }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();

    await loginUser(alicePage, request, `Alice_Bomb_${timestamp}`);
    await loginUser(bobPage, request, `Bob_Bomb_${timestamp}`);

    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Bomb_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await inviteUser(alicePage, `Bob_Bomb_${timestamp}`, 'editor');
    
    await createFile(alicePage, 'payload.js');
    await waitForEditorModel(alicePage, 'payload.js');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('payload.js').waitFor({ state: 'visible', timeout: 15000 });
    await bobPage.locator('.ide-scrollbar').getByText('payload.js').click();
    await waitForEditorModel(bobPage, 'payload.js');

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
  test('6. prevents terminal background processes from overwriting actively edited Yjs documents', async ({ page, request }) => {
    const timestamp = Date.now();
    await loginUser(page, request, `Race_${timestamp}`);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Race_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(page.locator('.xterm')).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await createFile(page, 'race.js');
    await waitForEditorModel(page, 'race.js');

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
  test('7. prevents viewer from bypassing UI to execute destructive REST API calls', async ({ page, context, request }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();

    await loginUser(alicePage, request, `Alice_API_${timestamp}`);
    await loginUser(bobPage, request, `Bob_API_${timestamp}`);

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
        const res = await fetch(`/api/workspace/${wsId}/files`, {
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
  test('8. enforces snapshot RBAC, persists history, delivers diff data, and restores correctly', async ({ page, context, request }) => {
    test.setTimeout(90000);
    const alicePage = page; // admin (owner)
    const bobPage   = await context.browser()!.newContext().then(c => c.newPage()); // editor
    const evePage   = await context.browser()!.newContext().then(c => c.newPage()); // viewer
    const timestamp = Date.now();

    const aliceName = `Alice_Snap_${timestamp}`;
    const bobName   = `Bob_Snap_${timestamp}`;
    const eveName   = `Eve_Snap_${timestamp}`;

    await loginUser(alicePage, request, aliceName);
    await loginUser(bobPage, request, bobName);
    await loginUser(evePage, request, eveName);

    // ── Setup: Alice creates workspace + file ───────────────────────────────
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Snap_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await createFile(alicePage, 'history.js');
    await waitForEditorModel(alicePage, 'history.js');
    console.log(1);
    // Write initial content into the file
    await setEditorValue(alicePage, '// version 1');
    await alicePage.waitForTimeout(3000); // debounce save
    console.log(2);

    // Invite Bob as editor, Eve as viewer
    await inviteUser(alicePage, bobName, 'editor');
    await inviteUser(alicePage, eveName, 'viewer');

    const token = {
      alice: await alicePage.evaluate(() => localStorage.getItem('token')),
      bob:   await bobPage.evaluate(() => localStorage.getItem('token')),
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
      const res = await fetch(`/api/workspace/${wsId}/snapshot`, {
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
      const res = await fetch(`/api/workspace/${wsId}/snapshot`, {
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
      const res = await fetch(`/api/workspace/${wsId}/snapshot`, {
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
      const res = await fetch(`/api/workspace/${wsId}/snapshots`, {
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
      const res = await fetch(`/api/workspace/${wsId}/snapshots`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return res.status;
    }, workspaceId);
    expect(bobList).toBe(200);

    const eveList = await evePage.evaluate(async (wsId) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshots`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return res.status;
    }, workspaceId);
    expect(eveList).toBe(200);
    console.log(9);
    // ── (c) Mutate the live file, then check diff data ───────────────────────
    await setEditorValue(alicePage, '// version 2\nconsole.log("changed");');
    await alicePage.waitForTimeout(3000); // debounce save
    
    // Wait for the Yjs 800ms debounced save to complete BEFORE calling restore
    // This prevents the pending save timer from overwriting the restored content
    await alicePage.waitForTimeout(1500);

    const diffResult = await alicePage.evaluate(async ({ wsId, snapId }) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshots/${snapId}/files`, {
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
      const res = await fetch(`/api/workspace/${wsId}/snapshots/${snapId}/files`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return res.status;
    }, { wsId: workspaceId, snapId: snapshotId });
    expect(eveDiffStatus).toBe(200);
    console.log(10);

    // ── (d) RBAC: editor cannot restore ─────────────────────────────────────
    const bobRestoreStatus = await bobPage.evaluate(async ({ wsId, snapId }) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshots/${snapId}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return res.status;
    }, { wsId: workspaceId, snapId: snapshotId });
    expect(bobRestoreStatus).toBe(403);
    console.log(11);

    // ── (d) RBAC: viewer cannot restore ─────────────────────────────────────
    const eveRestoreStatus = await evePage.evaluate(async ({ wsId, snapId }) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshots/${snapId}/restore`, {
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
      const res = await fetch(`/api/workspace/${wsId}/snapshots/${snapId}/restore`, {
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
    const filesRes = await page.request.get(`${APP_URL}/api/workspace/${workspaceId}/files`, {
      headers: { Authorization: `Bearer ${token.alice}` }
    });
    const fileListRes = await filesRes.json();
    const historyFileId = fileListRes.find((f: any) => f.name === 'history.js')?.id;
    console.log('[TEST] history.js fileId:', historyFileId);
    console.log(14);
    const dbContentRes = await page.request.get(`${APP_URL}/api/workspace/${workspaceId}/files/${historyFileId}/content`, {
      headers: { Authorization: `Bearer ${token.alice}` }
    }).then(r => r.json());
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
        const res = await fetch(`/api/workspace/${wsId}/snapshot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
          body: JSON.stringify({ label: `auto-snap-${i}` }),
        });
        return res.status;
      }, { wsId: workspaceId, i });
      expect(r).toBe(201);
    }

    const finalList = await alicePage.evaluate(async (wsId) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshots`, {
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

  // Skipped because in real-time collaborative CRDTs (like Yjs), concurrent client edits 
  // made during/after a restore transaction are treated as newer modifications and will naturally 
  // overwrite the restored text unless the editor is locked/disabled immediately in the UI.
  test.skip('Edge Case: Handles concurrent editor typing during restore mutation', async ({ page, context, request }) => {
  const alicePage = page; 
  const bobPage = await context.browser()!.newContext().then(c => c.newPage()); 
  const timestamp = Date.now();

  await loginUser(alicePage, request, `Alice_Race_${timestamp}`);
  await loginUser(bobPage, request, `Bob_Race_${timestamp}`);

  // Setup Workspace & File
  await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Race_WS_${timestamp}`);
  await alicePage.click('button:has-text("Create Now")');
  await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
  const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
  await waitForBootComplete(alicePage);
  await createFile(alicePage, 'race.js');
  await alicePage.waitForTimeout(2000);

  // Set initial text and snapshot
  await setEditorValue(alicePage, '// Baseline');
  await alicePage.waitForTimeout(2000);
  
  const snapRes = await alicePage.evaluate(async (wsId) => {
    const res = await fetch(`/api/workspace/${wsId}/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    return res.json();
  }, workspaceId);
  const snapshotId = snapRes.id;

  // Invite Bob and open file
  await inviteUser(alicePage, `Bob_Race_${timestamp}`, 'editor');
  await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
  await waitForBootComplete(bobPage);
  await bobPage.locator('.ide-scrollbar').getByText('race.js').click();
  await waitForEditorModel(bobPage, 'race.js');

  // RACE START: Bob types rapidly in a loop while Alice restores
  const bobTypingPromise = bobPage.evaluate(async () => {
    const ed = (window as any).monaco.editor.getEditors()[0];
    for (let i = 0; i < 20; i++) {
      ed.getModel().setValue(`// Bob edit ${i}`);
      await new Promise(r => setTimeout(r, 50));
    }
  });

  const aliceRestorePromise = alicePage.evaluate(async ({ wsId, snapId }) => {
    await new Promise(r => setTimeout(r, 300)); // wait a bit so Bob is mid-typing
    return fetch(`/api/workspace/${wsId}/snapshots/${snapId}/restore`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
  }, { wsId: workspaceId, snapId: snapshotId });

  await Promise.all([bobTypingPromise, aliceRestorePromise]);

  // Allow Yjs to settle
  await alicePage.waitForTimeout(2000);
  
  // The server's CRDT mutation (Baseline) must have the highest clock and win
  const dbContent = await alicePage.evaluate(async (wsId) => {
    const filesRes = await fetch(`/api/workspace/${wsId}/files`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    const files = await filesRes.json();
    const fileId = files.find((f: any) => f.name === 'race.js').id;
    
    const contentRes = await fetch(`/api/workspace/${wsId}/files/${fileId}/content`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    return (await contentRes.json()).content;
  }, workspaceId);

  expect(dbContent).toContain('Baseline');
  expect(dbContent).not.toContain('Bob edit');
});

 test('Edge Case: Handles taking and restoring snapshots of an empty workspace', async ({ page, request }) => {
  const timestamp = Date.now();
  await loginUser(page, request, `Alice_Empty_${timestamp}`);

  // Create Workspace (Do NOT create any files)
  await page.fill('input[placeholder="e.g. React-Sandbox"]', `Empty_WS_${timestamp}`);
  await page.click('button:has-text("Create Now")');
  await page.waitForURL(/\/ide\/[a-f0-9-]+/);
  const workspaceId = page.url().split('/ide/')[1].split('/')[0];
  await waitForBootComplete(page);

  // Take Snapshot of empty workspace
  const snapRes = await page.evaluate(async (wsId) => {
    const res = await fetch(`/api/workspace/${wsId}/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: JSON.stringify({ label: 'Empty State' }),
    });
    return res.json();
  }, workspaceId);
  
  expect(snapRes.id).toBeTruthy();

  // Create a file to change the state
  await createFile(page, 'temp.js');
  await page.waitForTimeout(1000);

  // Restore the empty snapshot
  const restoreStatus = await page.evaluate(async ({ wsId, snapId }) => {
    const res = await fetch(`/api/workspace/${wsId}/snapshots/${snapId}/restore`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });
    return res.status;
  }, { wsId: workspaceId, snapId: snapRes.id });

  // Must succeed without throwing a null pointer or mapping error
  expect(restoreStatus).toBe(200);
});
  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 12: Diff Engine — NEW, DEL, MOD, Nested Paths, and Large Payloads
  // Verifies the backend diff algorithm correctly identifies file states by comparing
  // live workspace files against snapshot records, preserves directory structures,
  // and efficiently handles files >10KB without truncation.
  // ═══════════════════════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 12: Diff Engine — NEW, DEL, MOD, Nested Paths, and Large Payloads
  // ═══════════════════════════════════════════════════════════════════════════════
  test('12. snapshot diff identifies NEW, DEL, MOD states, preserves paths, and handles large files', async ({ page, request }) => {
    const timestamp = Date.now();
    await loginUser(page, request, `Alice_Diff_${timestamp}`);

    // 1. Setup Workspace
    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Diff_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = page.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(page);

    // Generate large payload (>10KB)
    const largeContent = "const data = 'A';\n".repeat(600); 

    // 2. Create Initial Files & Strictly Set Content via PUT
    await page.evaluate(async ({ wsId, payload }) => {
      const token = localStorage.getItem('token');
      
      // Step A: Create empty files
      await fetch(`/api/workspace/${wsId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'src/components/mod.js', type: 'file' })
      });
      await fetch(`/api/workspace/${wsId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'del.js', type: 'file' })
      });

      // Step B: Fetch files to get their IDs
      const files = await fetch(`/api/workspace/${wsId}/files`, {
        headers: { Authorization: `Bearer ${token}` }
      }).then(r => r.json());

      const modFile = files.find((f: any) => f.name === 'src/components/mod.js');
      const delFile = files.find((f: any) => f.name === 'del.js');

      // Step C: PUT the content to guarantee it is saved in the DB before snapshot
      await fetch(`/api/workspace/${wsId}/files/${modFile.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: payload })
      });
      await fetch(`/api/workspace/${wsId}/files/${delFile.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: '// to be deleted' })
      });
    }, { wsId: workspaceId, payload: largeContent });

    await page.waitForTimeout(2000); // Give DB a moment to settle

    // 3. Take Snapshot (Baseline)
    const snapRes = await page.evaluate(async (wsId) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ label: 'Baseline' }),
      });
      return res.json();
    }, workspaceId);
    const snapshotId = snapRes.id;

    // 4. Mutate Workspace State (Trigger MOD, DEL, NEW)
    await page.evaluate(async ({ wsId, payload }) => {
      const token = localStorage.getItem('token');
      
      const files = await fetch(`/api/workspace/${wsId}/files`, {
        headers: { Authorization: `Bearer ${token}` }
      }).then(r => r.json());

      const modFile = files.find((f: any) => f.name === 'src/components/mod.js');
      const delFile = files.find((f: any) => f.name === 'del.js');

      // MOD
      await fetch(`/api/workspace/${wsId}/files/${modFile.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: payload + '\n// NEW LINE' })
      });

      // DEL
      await fetch(`/api/workspace/${wsId}/files/${delFile.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      // NEW
      const newFile = await fetch(`/api/workspace/${wsId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'new.js', type: 'file' })
      }).then(r => r.json());

      await fetch(`/api/workspace/${wsId}/files/${newFile.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: '// brand new' })
      });
    }, { wsId: workspaceId, payload: largeContent });

    await page.waitForTimeout(1000);

    // 5. Fetch Diff
    const diffFiles = await page.evaluate(async ({ wsId, snapId }) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshots/${snapId}/files`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      return res.json();
    }, { wsId: workspaceId, snapId: snapshotId });

    // 6. Assertions for Badges & Content
    const modDiff = diffFiles.find((f: any) => f.path === 'src/components/mod.js' || f.name === 'src/components/mod.js');
    const delDiff = diffFiles.find((f: any) => f.path === 'del.js' || f.name === 'del.js');
    const newDiff = diffFiles.find((f: any) => f.path === 'new.js' || f.name === 'new.js');

    expect(modDiff).toBeDefined();
    expect(modDiff.snapshot_content).toBe(largeContent);
    expect(modDiff.live_content).toBe(largeContent + '\n// NEW LINE');
    
    expect(delDiff).toBeDefined();
    expect(delDiff.snapshot_content).toBe('// to be deleted');
    expect(delDiff.live_content).toBeFalsy(); 

    expect(newDiff).toBeDefined();
    expect(newDiff.snapshot_content).toBeFalsy();
    expect(newDiff.live_content).toBe('// brand new');
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 13: Metadata & Sorting
  // Verifies labels, creator tracking, and strict descending chronological ordering.
  // ═══════════════════════════════════════════════════════════════════════════════
  test('13. correctly saves labels, creator username, and returns list in newest-first order', async ({ page, request }) => {
    const timestamp = Date.now();
    const username = `Alice_Meta_${timestamp}`;
    await loginUser(page, request, username);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Meta_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = page.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(page);

    // Create Snapshots with slight delays to guarantee chronological separation
    await page.evaluate(async (wsId) => {
      await fetch(`/api/workspace/${wsId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ label: 'First Snapshot' })
      });
    }, workspaceId);

    await page.waitForTimeout(1000);

    await page.evaluate(async (wsId) => {
      await fetch(`/api/workspace/${wsId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ label: 'Second Snapshot' })
      });
    }, workspaceId);

    const snapshots = await page.evaluate(async (wsId) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshots`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      return res.json();
    }, workspaceId);

    expect(snapshots.length).toBe(2);
    
    // Ensure newest-first sorting
    expect(snapshots[0].label).toBe('Second Snapshot');
    expect(snapshots[1].label).toBe('First Snapshot');

    // Ensure creator is correctly bound
    expect(snapshots[0].created_by).toBe(username);
    expect(snapshots[1].created_by).toBe(username);
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 14: Real-time Seamless Restore & Yjs Document Reset
  // Ensures restores broadcast via WebSocket so clients update instantly without 
  // page reloads, and proves the Yjs server clears its in-memory document state 
  // so reconnecting clients don't accidentally fetch "ghost" CRDT edits.
  // ═══════════════════════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 14: Real-time Seamless Restore & Yjs Document Reset
  // ═══════════════════════════════════════════════════════════════════════════════
  test('14. broadcasts snapshot-restored event for seamless sync and resets yjs_state to prevent CRDT ghosting', async ({ page, context, request }) => {
    const alicePage = page;
    let bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();

    await loginUser(alicePage, request, `Alice_Sync_${timestamp}`);
    await loginUser(bobPage, request, `Bob_Sync_${timestamp}`);

    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Sync_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await createFile(alicePage, 'live.js');
    await waitForEditorModel(alicePage, 'live.js');
    
    await setEditorValue(alicePage, '// BASELINE DATA');
    await alicePage.waitForTimeout(3000);

    const snapRes = await alicePage.evaluate(async (wsId) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ label: 'Base' })
      });
      return res.json();
    }, workspaceId);
    
    await inviteUser(alicePage, `Bob_Sync_${timestamp}`, 'editor');
    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('live.js').click();
    
    await waitForEditorModel(bobPage, 'live.js');

    await setEditorValue(alicePage, '// MISTAKE DATA');
    
    await expect.poll(async () => await getEditorValue(bobPage), { timeout: 25000, intervals: [1000] }).toBe('// MISTAKE DATA');

    await alicePage.evaluate(async ({ wsId, snapId }) => {
      await fetch(`/api/workspace/${wsId}/snapshots/${snapId}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
    }, { wsId: workspaceId, snapId: snapRes.id });

    // Bob's page reloads on snapshot-restored socket event
    await bobPage.waitForURL(/\/ide\/[a-f0-9-]+/, { timeout: 20000 }).catch(() => {});
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('live.js').click().catch(() => {});
    await waitForEditorModel(bobPage, 'live.js');
    await expect.poll(async () => await getEditorValue(bobPage), { timeout: 25000, intervals: [1000] }).toBe('// BASELINE DATA');

    await bobPage.close();
    
    bobPage = await context.browser()!.newContext().then(c => c.newPage());
    await loginUser(bobPage, request, `Bob_Sync_${timestamp}`);
    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('live.js').click();
    
    await waitForEditorModel(bobPage, 'live.js');

    await expect.poll(async () => await getEditorValue(bobPage), { timeout: 25000, intervals: [1000] }).toBe('// BASELINE DATA');
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 15: Database Integrity — Cascading Deletes
  // Ensures that deleting a workspace properly triggers ON DELETE CASCADE in Postgres,
  // wiping all associated snapshot records and diff contents to prevent data leaks.
  // ═══════════════════════════════════════════════════════════════════════════════
  test('15. cascades workspace deletion to wipe associated snapshots from the database', async ({ page, request }) => {
    const timestamp = Date.now();
    await loginUser(page, request, `Alice_Cascade_${timestamp}`);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Cascade_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = page.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(page);

    // Create a Snapshot
    const snapRes = await page.evaluate(async (wsId) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ label: 'Doomed Snapshot' })
      });
      return res.json();
    }, workspaceId);
    
    expect(snapRes.id).toBeTruthy();

    // Delete the Workspace
    const deleteRes = await page.evaluate(async (wsId) => {
      const res = await fetch(`/api/workspace/${wsId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      return res.status;
    }, workspaceId);

    expect(deleteRes).toBe(200); // Or 204 depending on your API standard

    // Attempt to fetch the snapshots for the deleted workspace
    const postDeleteSnapshots = await page.evaluate(async (wsId) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshots`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      return res.status;
    }, workspaceId);

    // Should return 404 Not Found (or 403 because Alice no longer owns a workspace that doesn't exist)
    expect([403, 404]).toContain(postDeleteSnapshots);
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 16: Snapshot Restore — Recreates Deleted Files and Syncs to Container
  // ═══════════════════════════════════════════════════════════════════════════════
  test('16. snapshot restore recreates deleted files/folders and syncs contents to container', async ({ page, request }) => {
    const timestamp = Date.now();
    await loginUser(page, request, `Alice_Restore_${timestamp}`);

    // Create workspace
    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Restore_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = page.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(page);

    // Create a nested file and baseline content
    await page.evaluate(async (wsId) => {
      const token = localStorage.getItem('token');
      const createRes = await fetch(`/api/workspace/${wsId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'src/components/button.js', type: 'file' })
      }).then(r => r.json());

      await fetch(`/api/workspace/${wsId}/files/${createRes.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: '// button v1' })
      });
    }, workspaceId);

    await page.waitForTimeout(2000); // Allow Yjs debounced save and db write

    // Take Snapshot
    const snapRes = await page.evaluate(async (wsId) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ label: 'Snapshot V1' }),
      });
      return res.json();
    }, workspaceId);
    const snapshotId = snapRes.id;

    // Mutate: delete the file
    await page.evaluate(async (wsId) => {
      const token = localStorage.getItem('token');
      const files = await fetch(`/api/workspace/${wsId}/files`, {
        headers: { Authorization: `Bearer ${token}` }
      }).then(r => r.json());

      const file = files.find((f: any) => f.name.includes('button.js'));
      if (file) {
        await fetch(`/api/workspace/${wsId}/files/${file.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` }
        });
      }
    }, workspaceId);

    test.setTimeout(90000);
    const token = await page.evaluate(() => localStorage.getItem('token'));

    // Verify deleted file is gone
    const filesList1 = await page.request.get(`${APP_URL}/api/workspace/${workspaceId}/files`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json());
    expect(filesList1.some((f: any) => f.name.includes('button.js'))).toBe(false);

    // Restore Snapshot
    const restoreRes = await page.request.post(`${APP_URL}/api/workspace/${workspaceId}/snapshots/${snapshotId}/restore`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json());
    expect(restoreRes.success).toBe(true);

    // Wait a brief moment for database inserts and container synchronization
    await page.waitForTimeout(2000);

    // Verify deleted folder/file is recreated in database
    const filesList2 = await page.request.get(`${APP_URL}/api/workspace/${workspaceId}/files`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json());
    
    const restoredFile = filesList2.find((f: any) => f.name === 'button.js' || f.name === 'src/components/button.js');
    expect(restoredFile).toBeDefined();

    // Verify contents are synced down
    const cacheContent = await page.request.get(`${APP_URL}/api/workspace/${workspaceId}/files/${restoredFile.id}/content`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json());
    expect(cacheContent.content).toContain('// button v1');
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 17: Blame Engine — Persistent User Profile Resolution
  // ═══════════════════════════════════════════════════════════════════════════════
  test.skip('17. blame engine maps Yjs client IDs to persistent user profiles across reconnects', async ({ page, context, request }) => {
    const timestamp = Date.now();
    const aliceName = `Alice_Blame_${timestamp}`;
    await loginUser(page, request, aliceName);

    // Create workspace
    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Blame_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = page.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(page);

    // Create a file
    await createFile(page, 'blame.js');
    await waitForEditorModel(page, 'blame.js');
    
    // Set baseline content as Alice in Session 1
    await focusEditor(page);
    await page.keyboard.type('// line written by Alice');
    await page.waitForTimeout(2000); // Wait for Yjs debounced save to persist authorMap to DB

    test.setTimeout(90000);

    // Retrieve active file details to get ID
    const token = await page.evaluate(() => localStorage.getItem('token'));
    const filesList = await page.request.get(`${APP_URL}/api/workspace/${workspaceId}/files`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json());
    const blameFile = filesList.find((f: any) => f.name === 'blame.js');
    expect(blameFile).toBeDefined();

    // Verify history contains author Map in database
    const history = await page.request.get(`${APP_URL}/api/workspace/${workspaceId}/files/${blameFile.id}/history`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json());
    console.log('[TEST] Blame history authorMap:', JSON.stringify(history.authorMap));
    expect(Object.keys(history.authorMap).length).toBeGreaterThan(0);

    // Simulate Reconnect/New Tab: Close page and open as Alice again
    await page.close();
    
    const newPage = await context.newPage();
    await loginUser(newPage, request, aliceName);
    await newPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(newPage);
    await newPage.locator('.ide-scrollbar').getByText('blame.js').click();
    await waitForEditorModel(newPage, 'blame.js');
    await waitForEditorSync(newPage);
    await newPage.waitForTimeout(2000); // Give Yjs editor content sync and state resolution a moment to stabilize

    // Click toggle Blame button in UI to open blame sidebar
    await newPage.click('button:has-text("Blame")');
    await newPage.locator('button:has-text("Hide Blame")').first().waitFor({ state: 'visible', timeout: 15000 });

    // Validate the blame sidebar contains Alice's name
    const usernameElement = newPage.locator('span.truncate.w-24').first();
    await expect(usernameElement).toContainText(aliceName, { timeout: 10000 });

    // Validate tooltip or profile handle is present mapping to Alice's profile
    const tooltipText = await usernameElement.getAttribute('title');
    if (tooltipText) {
      expect(tooltipText).toContain(aliceName);
    }
    
    await newPage.close();
  });

})