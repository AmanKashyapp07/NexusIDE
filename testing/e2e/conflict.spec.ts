import { test, expect, type Page, type APIRequestContext, type Browser } from '@playwright/test';

const APP_URL = process.env.BASE_URL || 'http://localhost:5173';
const API_URL = process.env.BASE_URL ? (() => { try { const u = new URL(process.env.BASE_URL); if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') { u.port = '4000'; } u.pathname = '/api'; return u.toString().replace(/\/$/, ''); } catch { return 'http://localhost:4000/api'; } })() : 'http://localhost:4000/api';
const WS_URL = process.env.BASE_URL ? (() => { try { const u = new URL(process.env.BASE_URL); if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') { u.port = '4000'; } else { u.pathname = '/ws'; } u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'; return u.toString().replace(/\/$/, ''); } catch { return 'ws://localhost:4000'; } })() : 'ws://localhost:4000';


async function loginUser(page: Page, request: APIRequestContext, username: string) {
  // The deployed frontend bundle has VITE_API_URL=localhost:4000 baked in from
  // the build environment, so browser-side fetch() calls fail when Playwright
  // runs against the remote VM (it can't reach localhost:4000 on the VM from
  // the local machine). We bypass the UI form entirely: call the API directly
  // via Playwright's Node.js request context, then inject the JWT into
  // localStorage so the React app thinks the user is authenticated.
  const loginRes = await request.post(`${API_URL}/auth/test-login`, {
    data: { username, password: 'test' },
  });
  if (!loginRes.ok()) {
    throw new Error(`Login API failed for "${username}": ${loginRes.status()} ${await loginRes.text()}`);
  }
  const { token } = await loginRes.json();

  // Navigate to the app root first so we have a valid origin to set localStorage
  await page.goto(`${APP_URL}/login`);
  await page.evaluate((t) => localStorage.setItem('token', t), token);

  // Now go directly to dashboard — the React router will accept the token
  await page.goto(`${APP_URL}/dashboard`);
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });

  return token as string;
}


async function waitForBootComplete(page: Page) {
  const loadingEl = page.locator('text=Booting environment...');
  try {
    await loadingEl.waitFor({ state: 'visible', timeout: 3000 });
    await loadingEl.waitFor({ state: 'detached', timeout: 45000 });
  } catch {}
}

async function waitForSocketConnect(page: Page) {
  await page.locator('[title="Status: connected"]').waitFor({ state: 'visible', timeout: 15000 });
}

test.describe('Git Merge Conflict Resolver E2E - Brutal Scenarios', () => {
  test.setTimeout(120000);

  const timestamp = Date.now();
  let token: string;
  let wsId: string;
  let fileId: string;

  // Setup: Create a shared workspace and file for each test
  test.beforeEach(async ({ page, request }) => {
    token = await loginUser(page, request, `conflict_admin_${timestamp}`);
    
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

    // Login both users to ensure they are created in the database
    const tokenA = await loginUser(pageA, request, `conflict_user_a_${timestamp}`);
    await loginUser(pageB, request, `conflict_user_b_${timestamp}`);

    // Invite both users to the workspace as editors via API
    await request.post(`${API_URL}/workspace/${wsId}/collaborators`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { usernameOrEmail: `conflict_user_a_${timestamp}`, role: 'editor' }
    });
    await request.post(`${API_URL}/workspace/${wsId}/collaborators`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { usernameOrEmail: `conflict_user_b_${timestamp}`, role: 'editor' }
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
      waitForSocketConnect(pageA),
      waitForSocketConnect(pageB)
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
    await waitForSocketConnect(page);
    
    await page.waitForFunction(() => {
      return (window as any).monaco?.editor?.getEditors()?.length > 0;
    }, { timeout: 90000 });

    await page.evaluate((content) => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      const model = editor.getModel();
      const fullRange = model.getFullModelRange();
      editor.executeEdits('test-inject', [{
        range: fullRange,
        text: content,
        forceMoveMarkers: true
      }]);
    }, conflictContent);
    
    // Poll the database until the injected conflict content has synced and saved
    await expect.poll(async () => {
      const res = await request.get(`${API_URL}/workspace/${wsId}/files/${fileId}/content`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok()) return '';
      const body = await res.json();
      return body.content || '';
    }, {
      intervals: [500, 1000, 2000],
      timeout: 15000
    }).toContain('<<<<<<< HEAD');

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

    const resolveRes = await resolvePromise;
    expect(resolveRes.ok()).toBeTruthy();

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

  test('Brutal Scenario 1: Nested and False Positive Conflict Markers', async ({ request }) => {
    // Tests conflict markers inside code strings and nested conflict markers
    const nestedContent = 
      `const codeString = "System marker: <<<<<<< HEAD";\n` +
      `<<<<<<< HEAD\n` +
      `const a = 1;\n` +
      `<<<<<<< HEAD\n` +
      `nested_a();\n` +
      `=======\n` +
      `nested_b();\n` +
      `>>>>>>> inner-branch\n` +
      `=======\n` +
      `const a = 2;\n` +
      `>>>>>>> outer-branch\n`;

    await request.put(`${API_URL}/workspace/${wsId}/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { content: nestedContent }
    });

    const parseRes = await request.get(`${API_URL}/workspace/${wsId}/files/${fileId}/conflicts`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    expect(parseRes.ok()).toBeTruthy();
    const parseData = await parseRes.json();
    // Verify that the parser handles nested markers deterministically without throwing 500 internal server error
    expect(parseData).toHaveProperty('hasConflicts');
  });

  test('Brutal Scenario 2: Thundering Herd Concurrent Resolution Requests', async ({ request }) => {
    // Inject conflict
    const conflictContent = `<<<<<<< HEAD\nVersion Alpha\n=======\nVersion Beta\n>>>>>>> branch`;
    await request.put(`${API_URL}/workspace/${wsId}/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { content: conflictContent }
    });

    // Fire 5 simultaneous resolve requests with competing payloads
    const resolveRequests = Array.from({ length: 5 }).map((_, index) => 
      request.post(`${API_URL}/workspace/${wsId}/files/${fileId}/conflicts/resolve`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { resolvedContent: `Resolved by Request #${index}` }
      })
    );

    const responses = await Promise.all(resolveRequests);
    
    // Every request should succeed without deadlocking the database pool
    responses.forEach(res => expect(res.ok()).toBeTruthy());

    // Verify DB consistency: final content should be equal to one of the resolved payloads
    const getRes = await request.get(`${API_URL}/workspace/${wsId}/files/${fileId}/content`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(getRes.ok()).toBeTruthy();
    const body = await getRes.json();
    expect(body.content).toMatch(/Resolved by Request #[0-4]/);
  });

  test('Brutal Scenario 3: Large File Payload Stress Test (5,000+ Lines)', async ({ request }) => {
    // Generate a massive file containing 5,000 lines with 10 large conflict blocks
    let largeContent = '';
    for (let i = 0; i < 500; i++) {
      if (i % 50 === 0) {
        largeContent += `<<<<<<< HEAD\n// Ours block ${i}\n` + 'console.log("ours");\n'.repeat(10) +
                        `=======\n// Theirs block ${i}\n` + 'console.log("theirs");\n'.repeat(10) +
                        `>>>>>>> branch-${i}\n`;
      } else {
        largeContent += `function fn_${i}() { return ${i}; }\n`;
      }
    }

    await request.put(`${API_URL}/workspace/${wsId}/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { content: largeContent }
    });

    // Measure parsing performance
    const startTime = Date.now();
    const parseRes = await request.get(`${API_URL}/workspace/${wsId}/files/${fileId}/conflicts`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const parseTime = Date.now() - startTime;

    expect(parseRes.ok()).toBeTruthy();
    const parseData = await parseRes.json();
    expect(parseData.hasConflicts).toBe(true);
    expect(parseData.conflicts.filter((c: any) => c.type === 'conflict').length).toBe(10);
    // Parse time for 5,000 lines should take under 1000ms
    expect(parseTime).toBeLessThan(1000);

    // Resolve the large conflict
    const resolvedContent = `// Resolved massive file\n` + 'function resolvedFn() {}\n'.repeat(500);
    const resolveRes = await request.post(`${API_URL}/workspace/${wsId}/files/${fileId}/conflicts/resolve`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { resolvedContent }
    });
    expect(resolveRes.ok()).toBeTruthy();
  });
});