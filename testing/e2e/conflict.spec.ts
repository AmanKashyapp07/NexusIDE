import { test, expect, type Page, type APIRequestContext, type Browser } from '@playwright/test';

const APP_URL = process.env.BASE_URL || 'http://localhost:5173';
const API_URL = process.env.BASE_URL ? (() => { try { const u = new URL(process.env.BASE_URL); u.port = '4000'; u.pathname = '/api'; return u.toString().replace(/\/$/, ''); } catch { return 'http://localhost:4000/api'; } })() : 'http://localhost:4000/api';
const WS_URL = process.env.BASE_URL ? (() => { try { const u = new URL(process.env.BASE_URL); u.port = '4000'; u.pathname = ''; u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'; return u.toString().replace(/\/$/, ''); } catch { return 'ws://localhost:4000'; } })() : 'ws://localhost:4000';

async function loginUser(page: Page, request: APIRequestContext, username: string) {
  await page.goto(`${APP_URL}/login`);
  const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
  await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
  await usernameInput.click();
  await usernameInput.fill(username);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
  
  const token = await page.evaluate(() => localStorage.getItem('token'));
  return token as string;
}

async function waitForBootComplete(page: Page) {
  const loadingEl = page.locator('text=Booting environment...');
  try {
    await loadingEl.waitFor({ state: 'visible', timeout: 3000 });
    await loadingEl.waitFor({ state: 'detached', timeout: 45000 });
  } catch {}
}

test.describe('Git Merge Conflict Resolver E2E - Brutal Scenarios', () => {
  test.setTimeout(120000);

  let token: string;
  let wsId: string;
  let fileId: string;

  // Setup: Create a shared workspace and file for each test
  test.beforeEach(async ({ page, request }) => {
    token = await loginUser(page, request, 'conflict_admin');
    
    const wsRes = await request.post(`${API_URL}/workspace`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'Brutal Merge Conflict Workspace' }
    });
    const ws = await wsRes.json();
    wsId = ws.id;
    
    const fileRes = await request.post(`${API_URL}/workspace/${wsId}/files`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'brutal_conflict.js', type: 'file' }
    });
    const file = await fileRes.json();
    fileId = file.id;
  });

  // Cleanup
  test.afterEach(async ({ request }) => {
    await request.delete(`${API_URL}/workspace/${wsId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  });

  test('Should handle multiple, empty, and CRLF-formatted conflicts gracefully', async ({ request }) => {
    // Inject a brutally messy conflict string:
    // 1. CRLF mixed with LF
    // 2. Empty 'ours' block
    // 3. Multiple conflicts in one file
    const messyConflictContent = 
      `function init() { \r\n` +
      `<<<<<<< HEAD\n` +
      `=======\r\n` +
      `  console.log("Only theirs exists");\n` +
      `>>>>>>> branch-a\n` +
      `  let active = true;\n` +
      `<<<<<<< HEAD\n` +
      `  runProcess(active);\n` +
      `=======\n` +
      `  execute(active);\n` +
      `>>>>>>> branch-b\n` +
      `}`;

    // Force content update via API (assuming a backend hook exists for git pulls)
    // Or inject via Monaco if API bypass isn't available
    await request.put(`${API_URL}/workspace/${wsId}/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { content: messyConflictContent }
    });

    const parseRes = await request.get(`${API_URL}/workspace/${wsId}/files/${fileId}/conflicts`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    expect(parseRes.ok()).toBeTruthy();
    const parseData = await parseRes.json();
    
    expect(parseData.hasConflicts).toBe(true);
    expect(parseData.conflicts.filter(c => c.type === 'conflict').length).toBe(2);
    
    // Validate empty block parsing
    expect(parseData.conflicts[1].ours.trim()).toBe('');
    expect(parseData.conflicts[1].theirs).toContain('Only theirs exists');
  });

  test('Should fail securely on malformed conflict markers', async ({ request }) => {
    // Missing the closing >>>>>>> marker
    const malformedContent = `<<<<<<< HEAD\nconsole.log("a");\n=======\nconsole.log("b");`;

    await request.put(`${API_URL}/workspace/${wsId}/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { content: malformedContent }
    });

    const parseRes = await request.get(`${API_URL}/workspace/${wsId}/files/${fileId}/conflicts`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    // The parser should ideally catch this and return a 400 or mark it as an invalid git state,
    // rather than crashing the backend.
    expect([200, 400, 422]).toContain(parseRes.status());
    if (parseRes.ok()) {
      const parseData = await parseRes.json();
      expect(parseData.hasConflicts).toBe(false); // Should not parse as a valid conflict
    }
  });

  test('Collaborative Real-time Resolution (Dual-Browser Sync)', async ({ browser, request }) => {
    // Create two separate browser contexts to simulate two different users
    // this suite is to test whether 
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    pageA.on('console', msg => console.log('PAGE A:', msg.text()));
    pageB.on('console', msg => console.log('PAGE B:', msg.text()));

    // Login both users to ensure they are created in the database
    const tokenA = await loginUser(pageA, request, 'user_a');
    await loginUser(pageB, request, 'user_b');

    // Invite both users to the workspace as editors via API
    await request.post(`${API_URL}/workspace/${wsId}/collaborators`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { usernameOrEmail: 'user_a', role: 'editor' }
    });
    await request.post(`${API_URL}/workspace/${wsId}/collaborators`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { usernameOrEmail: 'user_b', role: 'editor' }
    });

    // Both users navigate to the same file
    await Promise.all([
      pageA.goto(`${APP_URL}/ide/${wsId}/${fileId}`),
      pageB.goto(`${APP_URL}/ide/${wsId}/${fileId}`)
    ]);

    await Promise.all([
      waitForBootComplete(pageA),
      waitForBootComplete(pageB)
    ]);

    // Wait for both editors to mount
    const waitForEditor = async (page: Page) => {
      await page.waitForFunction(() => {
        return (window as any).monaco?.editor?.getEditors()?.length > 0;
      }, { timeout: 90000 });
    };
    await Promise.all([waitForEditor(pageA), waitForEditor(pageB)]);

    // Allow Yjs WebSockets to handshake and complete initial sync
    await Promise.all([
      pageA.waitForTimeout(2000),
      pageB.waitForTimeout(2000)
    ]);

    // Inject conflict via User A using executeEdits so the change flows through
    // MonacoBinding → Y.Text → broadcast to User B via Yjs CRDT.
    // Using editor.setValue() bypasses MonacoBinding entirely: Y.Text stays empty,
    // the Yjs room never gets the conflict content, and the resolve API's Yjs
    // transaction operates on empty text, producing wrong results on User B.
    const conflictContent = `<<<<<<< HEAD\nUser A edits\n=======\nUser B edits\n>>>>>>> main`;
    await pageA.evaluate((content) => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      console.log('[Test Debug] User A setting value to:', content);
      // Use executeEdits to route through MonacoBinding so Y.Text is updated
      const model = editor.getModel();
      const fullRange = model.getFullModelRange();
      editor.executeEdits('test-inject', [{
        range: fullRange,
        text: content,
        forceMoveMarkers: true
      }]);
      // Push undo stop so it's a clean edit
      editor.pushUndoStop();
      console.log('[Test Debug] User A set value complete. Current value:', editor.getValue());
    }, conflictContent);

    // Assert User B sees the conflict injected by User A via Yjs
    await pageB.waitForFunction((expected) => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      const normalize = (s: string) => s.replace(/\r\n/g, '\n');
      return normalize(editor.getValue()) === normalize(expected);
    }, conflictContent, { timeout: 15000 });

    // User A resolves the conflict via API
    const resolvedContent = `Merged edits`;
    const resolveRes = await request.post(`${API_URL}/workspace/${wsId}/files/${fileId}/conflicts/resolve`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { resolvedContent }
    });
    expect(resolveRes.ok()).toBeTruthy();

    // BRUTAL CHECK: Does User B's Monaco editor update instantly without a page reload?
    // This tests if your backend correctly broadcasts the resolution over WebSockets/Yjs
    await pageB.waitForFunction((expected) => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      const normalize = (s: string) => s.replace(/\r\n/g, '\n');
      return normalize(editor.getValue()) === normalize(expected);
    }, resolvedContent, { timeout: 10000 });

    const finalContentB = await pageB.evaluate(() => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      return editor.getValue();
    });
    
    expect(finalContentB).toBe(resolvedContent);

    await contextA.close();
    await contextB.close();
  });

  test('Race Condition: User types in Monaco while conflict is being resolved via API', async ({ page, request }) => {
    // Setup file with conflict
    const conflictContent = `<<<<<<< HEAD\nvar x = 1;\n=======\nvar x = 2;\n>>>>>>> main`;
    await page.goto(`${APP_URL}/ide/${wsId}/${fileId}`);
    await waitForBootComplete(page);
    
    await page.waitForFunction(() => {
      return (window as any).monaco?.editor?.getEditors()?.length > 0;
    }, { timeout: 90000 });

    await page.evaluate((content) => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      editor.setValue(content);
    }, conflictContent);
    
    await page.waitForTimeout(2000); // Wait for sync

    // Simulate API resolving the conflict at the exact moment the user is typing
    const resolvedContent = `var x = 3; // resolved`;
    
    // Start the API request, but don't await it immediately
    const resolvePromise = request.post(`${API_URL}/workspace/${wsId}/files/${fileId}/conflicts/resolve`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { resolvedContent }
    });

    // Immediately simulate user typing in the editor during the network request
    await page.evaluate(() => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      const position = editor.getPosition();
      editor.executeEdits("test", [{
        range: new (window as any).monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
        text: "\n// User typing...",
        forceMoveMarkers: true
      }]);
    });

    await resolvePromise;

    // Wait for the dust to settle on the WebSocket sync
    await page.waitForTimeout(2000);

    const finalContent = await page.evaluate(() => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      return editor.getValue();
    });

    // The brutal check: Depending on your Operational Transformation / CRDT implementation, 
    // the system should not crash. It should either:
    // 1. Keep the resolved content (overwriting user's concurrent typing)
    // 2. Keep both (resolved content + user's new typing)
    // It should NOT contain the old Git conflict markers.
    expect(finalContent).not.toContain('<<<<<<< HEAD');
    expect(finalContent).not.toContain('=======');
  });
});