# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: timelapse.spec.ts >> Live Editor Blame Feature >> attributes authorship chronologically on the same line
- Location: ../testing/e2e/timelapse.spec.ts:290:7

# Error details

```
Error: locator.click: Error: strict mode violation: locator('button').filter({ hasText: 'Hide Blame' }) resolved to 2 elements:
    1) <button class="flex items-center gap-1.5 rounded-md bg-indigo-500/10 hover:bg-indigo-500/20 px-3 py-1.5 text-xs font-medium text-indigo-400 border border-indigo-500/20 transition-colors">…</button> aka getByRole('banner').getByRole('button', { name: 'Hide Blame' })
    2) <button class="absolute top-4 right-6 z-30 flex items-center gap-1.5 rounded-md bg-[#2d2d2d] hover:bg-[#3d3d3d] px-3 py-1.5 text-xs font-medium text-zinc-300 border border-white/10 transition-colors shadow-lg">…</button> aka getByRole('main').getByRole('button', { name: 'Hide Blame' })

Call log:
  - waiting for locator('button').filter({ hasText: 'Hide Blame' })

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e3]:
    - banner [ref=e4]:
      - generic [ref=e6] [cursor=pointer]:
        - img [ref=e8]
        - generic [ref=e10]:
          - generic [ref=e11]:
            - generic [ref=e12]: Blame-Test-1783449928951
            - 'generic "Status: connected" [ref=e13]'
          - generic [ref=e14]: admin workspace
      - generic [ref=e15]:
        - button "Join Voice" [ref=e16]:
          - img [ref=e17]
          - generic [ref=e20]: Join Voice
        - button "Hide Blame" [ref=e21]:
          - img [ref=e22]
          - text: Hide Blame
        - button "AT" [ref=e26]:
          - generic "Jump to attr_alice's cursor" [ref=e28] [cursor=pointer]: AT
          - img [ref=e30]
        - generic [ref=e32]:
          - button "Share" [ref=e33]:
            - img [ref=e34]
            - text: Share
          - button "Export" [ref=e39]:
            - img [ref=e40]
            - text: Export
          - button "History" [ref=e43]:
            - img [ref=e44]
            - text: History
          - button "Logout" [ref=e48]:
            - img [ref=e49]
    - generic [ref=e52]:
      - generic [ref=e54]:
        - generic [ref=e55]:
          - generic [ref=e56]: Explorer
          - generic [ref=e57]:
            - button "Refresh Explorer" [ref=e58]:
              - img [ref=e59]
            - button "New File" [ref=e64]:
              - img [ref=e65]
            - button "New Folder" [ref=e68]:
              - img [ref=e69]
        - generic [ref=e73] [cursor=pointer]:
          - generic [ref=e75]:
            - img [ref=e77]
            - generic [ref=e80]: blame_chrono.js
          - button "Delete File" [ref=e82]:
            - img [ref=e83]
      - main [ref=e86]:
        - generic [ref=e87]:
          - generic [ref=e89]:
            - generic [ref=e92]:
              - img [ref=e93]
              - generic [ref=e96]: blame_chrono.js
            - button "Timelapse" [ref=e97]:
              - img [ref=e98]
              - text: Timelapse
          - generic [ref=e104]:
            - generic [ref=e107]:
              - generic [ref=e109]: attr_alice
              - generic [ref=e110]: Live edit
            - generic [ref=e111]:
              - code [ref=e114]:
                - generic [ref=e115]:
                  - textbox "Editor content" [ref=e116]
                  - textbox [ref=e117]
                  - generic [ref=e122]: "1"
                  - generic [ref=e128]: let data = [];
              - button "Hide Blame" [active] [ref=e132]:
                - img [ref=e133]
                - text: Hide Blame
              - generic [ref=e135]: LSP
        - generic [ref=e137]:
          - generic [ref=e138]:
            - generic [ref=e139]:
              - img [ref=e140]
              - generic [ref=e143]: Sandbox
            - generic [ref=e144]:
              - button "Preview" [ref=e145]:
                - img [ref=e146]
                - text: Preview
              - button "Restart" [ref=e149]:
                - img [ref=e150]
                - text: Restart
          - generic [ref=e154]:
            - button "Clear Terminal" [ref=e156]:
              - img [ref=e157]
            - generic [ref=e164]:
              - textbox "Terminal input" [ref=e165]
              - generic:
                - generic:
                  - generic: sandbox
                  - generic: ":"
                  - generic: ~
                  - generic: "#"
  - generic [ref=e166]:
    - alert
    - alert
```

# Test source

```ts
  203 | 
  204 |     // 4. Open Timelapse for file A and verify contents
  205 |     await page.getByRole('button', { name: 'Timelapse' }).click();
  206 |     const replayerContainer = page.locator('.shadow-2xl.z-50');
  207 |     await expect(replayerContainer.getByText('console.log("A");')).toBeVisible();
  208 |     await expect(replayerContainer.getByText('console.log("B");')).not.toBeVisible();
  209 |     
  210 |     // Close
  211 |     await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  212 | 
  213 |     // 5. Switch to file B in explorer
  214 |     await page.locator('.ide-scrollbar').getByText('docB.js').click();
  215 |     await expect(page.locator('.monaco-editor').first()).toContainText('console.log("B");');
  216 | 
  217 |     // 6. Open Timelapse for file B and verify contents
  218 |     await page.getByRole('button', { name: 'Timelapse' }).click();
  219 |     await expect(replayerContainer.getByText('console.log("B");')).toBeVisible();
  220 |     await expect(replayerContainer.getByText('console.log("A");')).not.toBeVisible();
  221 | 
  222 |     // Close
  223 |     await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  224 |   });
  225 | });
  226 | 
  227 | // =============================================================================
  228 | // Author Attribution Tests
  229 | // Tests the hybrid clientID→user mapping persisted in author_map JSONB column.
  230 | // These run as a separate describe block because they require two browser
  231 | // contexts (two users) and their own workspace lifecycle.
  232 | // =============================================================================
  233 | test.describe('Live Editor Blame Feature', () => {
  234 |   let workspaceId: string;
  235 |   const WS_TITLE = `Blame-Test-${Date.now()}`;
  236 | 
  237 |   // Helper: invite a user to the workspace via API
  238 |   async function inviteViaApi(page: Page, username: string, role = 'editor') {
  239 |     await page.evaluate(async ({ wsId, username, role }) => {
  240 |       const token = localStorage.getItem('token');
  241 |       await fetch(`/api/workspace/${wsId}/collaborators`, {
  242 |         method: 'POST',
  243 |         headers: {
  244 |           'Content-Type': 'application/json',
  245 |           Authorization: `Bearer ${token}`,
  246 |         },
  247 |         body: JSON.stringify({ usernameOrEmail: username, role }),
  248 |       });
  249 |     }, { wsId: workspaceId, username, role });
  250 |   }
  251 | 
  252 |   test.beforeEach(async ({ page }) => {
  253 |     await login(page, 'attr_alice', 'password123');
  254 |     workspaceId = await createTestWorkspace(page, WS_TITLE);
  255 |   });
  256 | 
  257 |   test.afterEach(async ({ page }) => {
  258 |     await deleteTestWorkspace(page, workspaceId);
  259 |   });
  260 | 
  261 |   test('toggles blame sidebar visibility and updates word-wrap layout', async ({ page }) => {
  262 |     await createTestFile(page, 'blame_toggle.js');
  263 |     await typeTextInMonaco(page, 'const x = 10;\nconst y = 20;');
  264 | 
  265 |     // Allow Yjs to sync the awareness state and doc
  266 |     await page.waitForTimeout(2000);
  267 | 
  268 |     // FIX: Bypass accessibility tree, find the button by its exact text content
  269 |     const blameBtn = page.locator('button', { hasText: /^Blame$/ });
  270 |     await expect(blameBtn).toBeVisible();
  271 | 
  272 |     // 1. Open Blame
  273 |     await blameBtn.click();
  274 | 
  275 |     // Button text should change
  276 |     const hideBtn = page.locator('button', { hasText: 'Hide Blame' });
  277 |     await expect(hideBtn).toBeVisible();
  278 | 
  279 |     // Sidebar should appear containing the author's username
  280 |     const sidebar = page.locator('div').filter({ hasText: 'Live edit' }).first();
  281 |     await expect(sidebar).toBeVisible();
  282 |     await expect(page.getByText('attr_alice').first()).toBeVisible();
  283 | 
  284 |     // 2. Close Blame
  285 |     await hideBtn.click();
  286 |     await expect(blameBtn).toBeVisible();
  287 |     await expect(page.getByText('Live edit')).toBeHidden();
  288 |   });
  289 | 
  290 |   test('attributes authorship chronologically on the same line', async ({ page, browser }) => {
  291 |     // 1. Alice creates the file and writes the initial code
  292 |     await createTestFile(page, 'blame_chrono.js');
  293 |     await typeTextInMonaco(page, 'let data = [];');
  294 |     await page.waitForTimeout(3000);
  295 | 
  296 |     // Verify Alice is the author of line 1
  297 |     const blameBtn = page.locator('button', { hasText: /^Blame$/ });
  298 |     await blameBtn.click();
  299 |     
  300 |     await expect(page.getByText('attr_alice').first()).toBeVisible();
  301 |     
  302 |     const hideBtn = page.locator('button', { hasText: 'Hide Blame' });
> 303 |     await hideBtn.click(); // Close for Bob's turn
      |                   ^ Error: locator.click: Error: strict mode violation: locator('button').filter({ hasText: 'Hide Blame' }) resolved to 2 elements:
  304 | 
  305 |     // 2. Invite Bob
  306 |     await inviteViaApi(page, 'attr_bob', 'editor');
  307 | 
  308 |     const bobContext = await browser.newContext();
  309 |     const bobPage = await bobContext.newPage();
  310 | 
  311 |     try {
  312 |       await login(bobPage, 'attr_bob', 'password123');
  313 |       await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
  314 | 
  315 |       // Wait for environment and click the file
  316 |       const loadingEl = bobPage.locator('text=Booting environment...');
  317 | 
  318 |       try {
  319 |         await loadingEl.waitFor({ state: 'visible', timeout: 3000 });
  320 |       } catch {}
  321 | 
  322 |       try {
  323 |         await loadingEl.waitFor({ state: 'detached', timeout: 35000 });
  324 |       } catch {}
  325 | 
  326 |       await bobPage
  327 |         .locator('.ide-scrollbar')
  328 |         .getByText('blame_chrono.js')
  329 |         .waitFor({ state: 'visible', timeout: 15000 });
  330 | 
  331 |       await bobPage
  332 |         .locator('.ide-scrollbar')
  333 |         .getByText('blame_chrono.js')
  334 |         .click();
  335 | 
  336 |       await bobPage.waitForFunction(
  337 |         (name) => {
  338 |           const eds = (window as any).monaco?.editor?.getEditors();
  339 |           return (
  340 |             eds &&
  341 |             eds.length > 0 &&
  342 |             eds[0].getModel()?.uri.path.endsWith(name)
  343 |           );
  344 |         },
  345 |         'blame_chrono.js',
  346 |         { timeout: 20000 }
  347 |       );
  348 | 
  349 |       // Bob modifies the exact same line Alice wrote
  350 |       await bobPage.evaluate(() => {
  351 |         const editor = (window as any).monaco.editor.getEditors()[0];
  352 |         editor.setPosition({ lineNumber: 1, column: 14 });
  353 |         editor.focus();
  354 |       });
  355 | 
  356 |       // Bob types, acquiring the highest Yjs clock for this line
  357 |       await bobPage.keyboard.type(' /* loaded */');
  358 |       await bobPage.waitForTimeout(3000);
  359 | 
  360 |     } finally {
  361 |       await bobContext.close();
  362 |     }
  363 | 
  364 |     // 3. Back to Alice: Open Blame again
  365 |     await blameBtn.click();
  366 | 
  367 |     // The line should now be attributed to Bob because his edit has a higher Yjs clock
  368 |     const blameSidebar = page.locator('.w-\\[260px\\]');
  369 | 
  370 |     await expect(
  371 |       blameSidebar.getByText('attr_bob')
  372 |     ).toBeVisible({ timeout: 5000 });
  373 | 
  374 |     // Alice's name should no longer be the primary blame for line 1
  375 |     await expect(
  376 |       blameSidebar.getByText('attr_alice')
  377 |     ).toBeHidden();
  378 |   });
  379 | 
  380 |   test('gracefully handles missing author history (offline/deleted)', async ({ page }) => {
  381 |     await createTestFile(page, 'blame_empty.js');
  382 | 
  383 |     // Simulate Monaco line insertion without a Yjs aware author attached
  384 |     await page.evaluate(() => {
  385 |       const editor = (window as any).monaco.editor.getEditors()[0];
  386 |       editor.getModel()?.setValue(
  387 |         'function autoGenerated() {\n  return true;\n}'
  388 |       );
  389 |     });
  390 | 
  391 |     await page.waitForTimeout(1000);
  392 | 
  393 |     // FIX: Use robust text locator
  394 |     const blameBtn = page.locator('button', { hasText: /^Blame$/ });
  395 |     await blameBtn.click();
  396 | 
  397 |     // Fallback UI should render cleanly without crashing
  398 |     const unknownLines = page.getByText('No history');
  399 |     const count = await unknownLines.count();
  400 | 
  401 |     expect(count).toBeGreaterThanOrEqual(1);
  402 |   });
  403 | });
```