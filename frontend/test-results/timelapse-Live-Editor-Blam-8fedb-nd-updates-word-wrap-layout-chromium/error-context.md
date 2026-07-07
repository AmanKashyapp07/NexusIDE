# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: timelapse.spec.ts >> Live Editor Blame Feature >> toggles blame sidebar visibility and updates word-wrap layout
- Location: ../testing/e2e/timelapse.spec.ts:261:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('button').filter({ hasText: /^Blame$/ })
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for locator('button').filter({ hasText: /^Blame$/ })

```

```yaml
- banner:
  - text: Blame-Test-1783428541292 admin workspace
  - button "Join Voice"
  - button "AT"
  - button "Share"
  - button "Export"
  - button "History"
  - button "Logout"
- text: Explorer
- button "Refresh Explorer"
- button "New File"
- button "New Folder"
- text: blame_toggle.js
- button "Delete File"
- main:
  - text: blame_toggle.js
  - button "Timelapse"
  - code:
    - textbox "Editor content"
  - text: LSP Sandbox
  - button "Preview"
  - button "Restart"
  - button "Clear Terminal"
  - textbox "Terminal input"
- alert: "function add(a, b) { return a + b; } const result = add(x, y); console.log(result);"
- alert
```

# Test source

```ts
  170 |     // 7. Verify text is restored
  171 |     await expect.poll(async () => {
  172 |       return page.evaluate(() => {
  173 |         const editors = (window as any).monaco?.editor?.getEditors();
  174 |         return editors && editors[1] ? editors[1].getModel()?.getValue() || '' : '';
  175 |       });
  176 |     }).toContain('LineOne');
  177 | 
  178 |     await expect.poll(async () => {
  179 |       return page.evaluate(() => {
  180 |         const editors = (window as any).monaco?.editor?.getEditors();
  181 |         return editors && editors[1] ? editors[1].getModel()?.getValue() || '' : '';
  182 |       });
  183 |     }).toContain('LineTwo');
  184 | 
  185 |     // Close
  186 |     await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  187 |   });
  188 | 
  189 |   test('should show separate histories for separate files in timelapse mode', async ({ page }) => {
  190 |     // 1. Create file A and write text
  191 |     await createTestFile(page, 'docA.js');
  192 |     await typeTextInMonaco(page, 'console.log("A");');
  193 |     await page.waitForTimeout(4000);
  194 | 
  195 |     // 2. Create file B and write text
  196 |     await createTestFile(page, 'docB.js');
  197 |     await typeTextInMonaco(page, 'console.log("B");');
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
> 270 |     await expect(blameBtn).toBeVisible();
      |                            ^ Error: expect(locator).toBeVisible() failed
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
```