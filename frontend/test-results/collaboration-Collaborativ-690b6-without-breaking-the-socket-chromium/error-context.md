# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: collaboration.spec.ts >> Collaborative Engine E2E Integration Suite >> syncs file renames live while other users are actively editing without breaking the socket
- Location: ../testing/e2e/collaboration.spec.ts:352:7

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.monaco-editor')
Expected substring: "AFTER rename"
Received string:    "1"
Timeout: 10000ms

Call log:
  - Expect "toContainText" with timeout 10000ms
  - waiting for locator('.monaco-editor')
    24 × locator resolved to <div role="code" data-uri="file:///new-name.js" class="monaco-editor no-user-select  showUnused showDeprecated vs-dark">…</div>
       - unexpected value "1"

```

```yaml
- code:
  - textbox "Editor content"
```

# Test source

```ts
  300 |   // TEST 5: Simultaneous Conflicting Edits (CRDT Stress Test)
  301 |   test('resolves simultaneous conflicting edits without data corruption', async ({ page, context }) => {
  302 |     const alicePage = page;
  303 |     const bobContext = await context.browser()!.newContext();
  304 |     const bobPage = await bobContext.newPage();
  305 |     const timestamp = Date.now();
  306 |     const bobName = `Bob_Simul_${timestamp}`;
  307 | 
  308 |     await loginUser(alicePage, `Alice_Simul_${timestamp}`);
  309 |     await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Simul_WS_${timestamp}`);
  310 |     await alicePage.click('button:has-text("Create Now")');
  311 |     await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
  312 |     const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
  313 |     await waitForBootComplete(alicePage);
  314 | 
  315 |     await createFile(alicePage, 'conflict.js');
  316 |     await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });
  317 | 
  318 |     await loginUser(bobPage, bobName);
  319 |     await inviteUser(alicePage, bobName, 'editor');
  320 | 
  321 |     await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
  322 |     await waitForBootComplete(bobPage);
  323 |     await bobPage.click('text=conflict.js');
  324 |     await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });
  325 |     await alicePage.waitForTimeout(2000);
  326 | 
  327 |     const aliceInput = 'const a = "ALICE_WAS_HERE";\n'.repeat(5);
  328 |     const bobInput = 'const b = "BOB_WAS_HERE";\n'.repeat(5);
  329 | 
  330 |     await waitForEditorReady(alicePage);
  331 |     await focusEditor(alicePage);
  332 |     await alicePage.keyboard.type(aliceInput);
  333 |     await alicePage.waitForTimeout(500);
  334 | 
  335 |     await waitForEditorReady(bobPage);
  336 |     await focusEditor(bobPage);
  337 |     await bobPage.keyboard.type(bobInput);
  338 | 
  339 |     // Use Playwright auto-retry assertions to handle potential CPU/network latency
  340 |     // when running the full test suite in resource-constrained environments.
  341 |     await expect(async () => {
  342 |       const aliceContent = await getEditorValue(alicePage);
  343 |       const bobContent = await getEditorValue(bobPage);
  344 |       expect(aliceContent.length).toBeGreaterThan(0);
  345 |       expect(aliceContent).toContain('ALICE_WAS_HERE');
  346 |       expect(aliceContent).toContain('BOB_WAS_HERE');
  347 |       expect(aliceContent).toEqual(bobContent);
  348 |     }).toPass({ timeout: 12000, intervals: [1000] });
  349 |   });
  350 | 
  351 |   // TEST 6: Collaborative File Renaming & Connection Stability
  352 |   test('syncs file renames live while other users are actively editing without breaking the socket', async ({ page, context }) => {
  353 |     const alicePage = page;
  354 |     const bobContext = await context.browser()!.newContext();
  355 |     const bobPage = await bobContext.newPage();
  356 |     const timestamp = Date.now();
  357 |     const bobName = `Bob_Rename_${timestamp}`;
  358 | 
  359 |     await loginUser(alicePage, `Alice_Rename_${timestamp}`);
  360 |     await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Rename_WS_${timestamp}`);
  361 |     await alicePage.click('button:has-text("Create Now")');
  362 |     await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
  363 |     const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
  364 |     await waitForBootComplete(alicePage);
  365 | 
  366 |     await createFile(alicePage, 'old-name.js');
  367 |     await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });
  368 | 
  369 |     await loginUser(bobPage, bobName);
  370 |     await inviteUser(alicePage, bobName, 'editor');
  371 | 
  372 |     await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
  373 |     await waitForBootComplete(bobPage);
  374 |     await bobPage.click('text=old-name.js');
  375 |     await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });
  376 | 
  377 |     await bobPage.locator('.monaco-editor').first().click();
  378 |     await bobPage.waitForTimeout(500);
  379 |     await bobPage.keyboard.type('// Bob is typing before rename\n');
  380 |     await expect(alicePage.locator('.monaco-editor')).toContainText('before rename', { timeout: 5000 });
  381 | 
  382 |     const aliceTerminalTextarea = alicePage.locator('.xterm-helper-textarea');
  383 |     const aliceTerminalBody = alicePage.locator('.xterm');
  384 |     await expect(aliceTerminalBody).toContainText('sandbox:~#', { timeout: 25000 });
  385 | 
  386 |     await aliceTerminalTextarea.focus();
  387 |     await alicePage.keyboard.type('mv old-name.js new-name.js', { delay: 10 });
  388 |     await alicePage.keyboard.press('Enter');
  389 | 
  390 |     await expect(bobPage.locator('.ide-scrollbar').getByText('new-name.js')).toBeVisible({ timeout: 10000 });
  391 | 
  392 |     await alicePage.locator('.ide-scrollbar').getByText('new-name.js').click();
  393 |     await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });
  394 |     await bobPage.locator('.ide-scrollbar').getByText('new-name.js').click();
  395 |     await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });
  396 | 
  397 |     await bobPage.locator('.monaco-editor').first().click();
  398 |     await bobPage.waitForTimeout(500);
  399 |     await bobPage.keyboard.type('// Bob typing AFTER rename');
> 400 |     await expect(alicePage.locator('.monaco-editor')).toContainText('AFTER rename', { timeout: 10000 });
      |                                                       ^ Error: expect(locator).toContainText(expected) failed
  401 |   });
  402 | 
  403 |   // =============================================================================
  404 |   // TEST 7: Late-Joiner Content Integrity (catches Yjs + REST double-init bug)
  405 |   //
  406 |   // THE BUG THIS CATCHES:
  407 |   //   User A writes "console.log('iiita')" and the content is persisted to DB.
  408 |   //   User B joins later. CodeEditor does TWO things on mount:
  409 |   //     1. Fetches saved content via REST and seeds the Monaco model directly.
  410 |   //     2. Yjs WebsocketProvider syncs server doc which ALSO has that content.
  411 |   //   MonacoBinding sees content in both → doubles it.
  412 |   //
  413 |   //   This was NOT caught by earlier tests because every prior test had BOTH users
  414 |   //   start simultaneously on an EMPTY file. The bug only triggers when content
  415 |   //   already exists in the file at the time the second user joins.
  416 |   // =============================================================================
  417 |   test('late-joining user sees exact content once — no duplication or data loss', async ({ page, context }) => {
  418 |     const alicePage = page;
  419 |     const bobContext = await context.browser()!.newContext();
  420 |     const bobPage = await bobContext.newPage();
  421 |     const timestamp = Date.now();
  422 |     const aliceName = `Alice_Late_${timestamp}`;
  423 |     const bobName = `Bob_Late_${timestamp}`;
  424 |     const SENTINEL = `UNIQUE_SENTINEL_${timestamp}`;
  425 | 
  426 |     await loginUser(alicePage, aliceName);
  427 |     await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Late_WS_${timestamp}`);
  428 |     await alicePage.click('button:has-text("Create Now")');
  429 |     await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
  430 |     const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
  431 |     await waitForBootComplete(alicePage);
  432 | 
  433 |     await createFile(alicePage, 'late.js');
  434 |     await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });
  435 |     await alicePage.locator('.monaco-editor').first().click();
  436 |     await alicePage.waitForTimeout(500);
  437 |     await alicePage.keyboard.type(`console.log("${SENTINEL}");`, { delay: 20 });
  438 | 
  439 |     // CRITICAL: Wait for the 800ms debounce to flush content to Postgres + Docker.
  440 |     // Simulates real workflow: type → save → walk away → peer joins later.
  441 |     await alicePage.waitForTimeout(3000);
  442 | 
  443 |     await loginUser(bobPage, bobName);
  444 |     await inviteUser(alicePage, bobName, 'editor');
  445 | 
  446 |     await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
  447 |     await waitForBootComplete(bobPage);
  448 |     await bobPage.locator('.ide-scrollbar').getByText('late.js').click();
  449 |     await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });
  450 |     await bobPage.waitForTimeout(2000);
  451 | 
  452 |     // THE CRITICAL ASSERTION: content must appear EXACTLY ONCE
  453 |     await expect(async () => {
  454 |       const bobEditorText = await getEditorValue(bobPage);
  455 |       expect(bobEditorText).toContain(SENTINEL);
  456 |       // The duplication bug causes count = 2
  457 |       expect(bobEditorText.split(SENTINEL).length - 1).toBe(1);
  458 |     }).toPass({ timeout: 15000, intervals: [1000] });
  459 | 
  460 |     await expect(async () => {
  461 |       const aliceEditorText = await getEditorValue(alicePage);
  462 |       expect(aliceEditorText).toContain(SENTINEL);
  463 |       expect(aliceEditorText.split(SENTINEL).length - 1).toBe(1);
  464 |     }).toPass({ timeout: 15000, intervals: [1000] });
  465 | 
  466 |     // Bob types after joining — must sync without causing further duplication
  467 |     await bobPage.locator('.monaco-editor').first().click();
  468 |     await bobPage.waitForTimeout(500);
  469 |     await bobPage.keyboard.type('\n// Bob appended this', { delay: 20 });
  470 |     
  471 |     // Auto-retry checking updated content since UI updates are async
  472 |     await expect(async () => {
  473 |       const aliceFinal = await getEditorValue(alicePage);
  474 |       const bobFinal = await getEditorValue(bobPage);
  475 |       expect(aliceFinal).toContain('Bob appended this');
  476 |       expect(aliceFinal.split(SENTINEL).length - 1).toBe(1);
  477 |       expect(bobFinal.split(SENTINEL).length - 1).toBe(1);
  478 |       expect(aliceFinal).toEqual(bobFinal);
  479 |     }).toPass({ timeout: 10000, intervals: [1000] });
  480 |   });
  481 | 
  482 |   // =============================================================================
  483 |   // TEST 8: Reconnect After Disconnect — Content Integrity & No Duplication
  484 |   //
  485 |   // User B joins, leaves (navigates away, destroying the Yjs provider), then
  486 |   // rejoins the same file. A fresh provider creates a new Yjs doc and syncs
  487 |   // from the server — content must appear exactly once, not doubled.
  488 |   // =============================================================================
  489 |   test('reconnecting user sees correct content once without duplication', async ({ page, context }) => {
  490 |     const alicePage = page;
  491 |     const bobContext = await context.browser()!.newContext();
  492 |     const bobPage = await bobContext.newPage();
  493 |     const timestamp = Date.now();
  494 |     const SENTINEL = `RECONNECT_${timestamp}`;
  495 | 
  496 |     await loginUser(alicePage, `Alice_Reconn_${timestamp}`);
  497 |     await loginUser(bobPage, `Bob_Reconn_${timestamp}`);
  498 | 
  499 |     await alicePage.goto('/dashboard');
  500 |     await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Reconn_WS_${timestamp}`);
```