# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: timelapse.spec.ts >> Live Editor Blame Feature >> attributes authorship chronologically on the same line
- Location: ../testing/e2e/timelapse.spec.ts:290:7

# Error details

```
Test timeout of 45000ms exceeded.
```

```
Error: locator.click: Test timeout of 45000ms exceeded.
Call log:
  - waiting for locator('button').filter({ hasText: /^Blame$/ })

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
            - generic [ref=e12]: Blame-Test-1783428622869
            - 'generic "Status: connected" [ref=e13]'
          - generic [ref=e14]: admin workspace
      - generic [ref=e15]:
        - button "Join Voice" [ref=e16]:
          - img [ref=e17]
          - generic [ref=e20]: Join Voice
        - button "AT" [ref=e23]:
          - generic "Jump to attr_alice's cursor" [ref=e25] [cursor=pointer]: AT
          - img [ref=e27]
        - generic [ref=e29]:
          - button "Share" [ref=e30]:
            - img [ref=e31]
            - text: Share
          - button "Export" [ref=e36]:
            - img [ref=e37]
            - text: Export
          - button "History" [ref=e40]:
            - img [ref=e41]
            - text: History
          - button "Logout" [ref=e45]:
            - img [ref=e46]
    - generic [ref=e49]:
      - generic [ref=e51]:
        - generic [ref=e52]:
          - generic [ref=e53]: Explorer
          - generic [ref=e54]:
            - button "Refresh Explorer" [ref=e55]:
              - img [ref=e56]
            - button "New File" [ref=e61]:
              - img [ref=e62]
            - button "New Folder" [ref=e65]:
              - img [ref=e66]
        - generic [ref=e70] [cursor=pointer]:
          - generic [ref=e72]:
            - img [ref=e74]
            - generic [ref=e77]: blame_chrono.js
          - button "Delete File" [ref=e79]:
            - img [ref=e80]
      - main [ref=e83]:
        - generic [ref=e84]:
          - generic [ref=e86]:
            - generic [ref=e89]:
              - img [ref=e90]
              - generic [ref=e93]: blame_chrono.js
            - button "Timelapse" [ref=e94]:
              - img [ref=e95]
              - text: Timelapse
          - generic [ref=e101]:
            - code [ref=e104]:
              - generic [ref=e105]:
                - textbox "Editor content" [active] [ref=e106]
                - textbox [ref=e107]
                - generic [ref=e112]: "1"
                - generic [ref=e113]:
                  - generic [ref=e116]:
                    - generic [ref=e118]: let data2 = [];
                    - generic [ref=e120]: let data3 = [];
                    - generic [ref=e122]: let data4 = [];
                    - generic [ref=e124]: let data5 = [];
                    - generic [ref=e126]: let data6 = [];
                    - generic [ref=e128]: let data7 = [];
                    - generic [ref=e130]: let data8 = [];
                    - generic [ref=e132]: let data9 = [];
                    - generic [ref=e134]: let data10 = [];
                    - generic [ref=e136]: let data11 = [];
                    - generic [ref=e138]: let data12 = [];
                    - generic [ref=e140]: let data13 = [];
                    - generic [ref=e142]: let data14 = [];
                    - generic [ref=e144]: let data15 = [];
                    - generic [ref=e146]: let data16 = [];
                    - generic [ref=e148]: let data17 = [];
                    - generic [ref=e150]: let data18 = [];
                    - generic [ref=e152]: let data19 =
                  - generic [ref=e155]: let data = [];
            - generic [ref=e158]: LSP
        - generic [ref=e160]:
          - generic [ref=e161]:
            - generic [ref=e162]:
              - img [ref=e163]
              - generic [ref=e166]: Sandbox
            - generic [ref=e167]:
              - button "Preview" [ref=e168]:
                - img [ref=e169]
                - text: Preview
              - button "Restart" [ref=e172]:
                - img [ref=e173]
                - text: Restart
          - generic [ref=e177]:
            - button "Clear Terminal" [ref=e179]:
              - img [ref=e180]
            - generic [ref=e187]:
              - textbox "Terminal input" [ref=e188]
              - generic:
                - generic:
                  - generic: sandbox
                  - generic: ":"
                  - generic: ~
                  - generic: "#"
  - generic [ref=e189]:
    - alert [ref=e190]: let data2 = []; let data3 = []; let data4 = []; let data5 = []; let data6 = []; let data7 = []; let data8 = []; let data9 = []; let data10 = []; let data11 = []; let data12 = []; let data13 = []; let data14 = []; let data15 = []; let data16 = []; let data17 = []; let data18 = []; let data19 =
    - alert
```

# Test source

```ts
  198 |     await page.waitForTimeout(4000);
  199 | 
  200 |     // 3. Switch back to file A in explorer
  201 |     await page.locator('.ide-scrollbar').getByText('docA.js').click();
  202 |     await expect(page.locator('.monaco-editor').first()).toContainText('console.log("A");');
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
> 298 |     await blameBtn.click();
      |                    ^ Error: locator.click: Test timeout of 45000ms exceeded.
  299 |     
  300 |     await expect(page.getByText('attr_alice').first()).toBeVisible();
  301 |     
  302 |     const hideBtn = page.locator('button', { hasText: 'Hide Blame' });
  303 |     await hideBtn.click(); // Close for Bob's turn
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
```