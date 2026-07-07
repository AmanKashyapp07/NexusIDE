# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: brutal-integration.spec.ts >> Brutal Integration & Security Test Suite (CRDT, Sandbox Limits, RBAC) >> 2. runs interactive bash scripts, handles Ctrl+C signal trapping, and sustains CPU load
- Location: ../testing/e2e/brutal-integration.spec.ts:165:7

# Error details

```
Error: page.waitForTimeout: Test ended.
```

# Test source

```ts
  98  |     const aliceName = `Alice_Split_${timestamp}`;
  99  |     const bobName = `Bob_Split_${timestamp}`;
  100 | 
  101 |     await loginUser(alicePage, aliceName);
  102 |     await loginUser(bobPage, bobName);
  103 |     await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Split_WS_${timestamp}`);
  104 |     await alicePage.click('button:has-text("Create Now")');
  105 |     await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
  106 |     const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
  107 |     await waitForBootComplete(alicePage);
  108 | 
  109 |     await inviteUser(alicePage, bobName, 'editor');
  110 | 
  111 |     await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
  112 |     await waitForBootComplete(bobPage);
  113 |     await waitForSocketConnect(bobPage);
  114 | 
  115 |     await createFile(alicePage, 'conflict.txt');
  116 |     await alicePage.waitForTimeout(2000);
  117 | 
  118 |     // Bob waits for file to appear in sidebar (via file-tree-update socket event)
  119 |     await expect(bobPage.locator('.ide-scrollbar').getByText('conflict.txt')).toBeVisible({ timeout: 10000 });
  120 |     await bobPage.locator('.ide-scrollbar').getByText('conflict.txt').click();
  121 |     await waitForEditorModel(bobPage, 'conflict.txt');
  122 | 
  123 |     const aliceTextarea = alicePage.locator('.monaco-editor').first();
  124 |     await aliceTextarea.click();
  125 |     await alicePage.keyboard.type('Init', { delay: 10 });
  126 |     await alicePage.waitForTimeout(1000);
  127 | 
  128 |     // Confirm Bob received Alice's initial content before going offline
  129 |     await expect.poll(async () => await getEditorValue(bobPage), { timeout: 10000 }).toBe('Init');
  130 | 
  131 |     await alicePage.context().setOffline(true);
  132 |     await bobPage.context().setOffline(true);
  133 | 
  134 |     await aliceTextarea.click();
  135 |     await alicePage.keyboard.press('End');
  136 |     await alicePage.keyboard.type(' Alice', { delay: 10 });
  137 | 
  138 |     const bobTextarea = bobPage.locator('.monaco-editor').first();
  139 |     await bobTextarea.click();
  140 |     await bobPage.keyboard.press('End');
  141 |     await bobPage.keyboard.type(' Bob', { delay: 10 });
  142 | 
  143 |     expect(await getEditorValue(alicePage)).toBe('Init Alice');
  144 |     expect(await getEditorValue(bobPage)).toBe('Init Bob');
  145 | 
  146 |     await alicePage.context().setOffline(false);
  147 |     await bobPage.context().setOffline(false);
  148 | 
  149 |     await expect.poll(async () => {
  150 |       const valAlice = await getEditorValue(alicePage);
  151 |       const valBob = await getEditorValue(bobPage);
  152 |       return valAlice === valBob && (valAlice.includes('Alice') && valAlice.includes('Bob'));
  153 |     }, { timeout: 15000 }).toBe(true);
  154 | 
  155 |     await expect(alicePage.locator('.flex.items-center.-space-x-2')).toContainText(bobName.slice(0, 2).toUpperCase());
  156 | 
  157 |     await bobPage.close();
  158 | 
  159 |     await expect(alicePage.locator('.flex.items-center.-space-x-2')).not.toContainText(bobName.slice(0, 2).toUpperCase(), { timeout: 15000 });
  160 |   });
  161 | 
  162 |   // ═══════════════════════════════════════════════════════════════════════════════
  163 |   // TEST 2: Sandbox Resource Limits, Interactive Prompts & Signal Trapping
  164 |   // ═══════════════════════════════════════════════════════════════════════════════
  165 |   test('2. runs interactive bash scripts, handles Ctrl+C signal trapping, and sustains CPU load', async ({ page }) => {
  166 |     const timestamp = Date.now();
  167 |     await loginUser(page, `TermSec_${timestamp}`);
  168 | 
  169 |     await page.fill('input[placeholder="e.g. React-Sandbox"]', `TermSec_WS_${timestamp}`);
  170 |     await page.click('button:has-text("Create Now")');
  171 |     await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
  172 | 
  173 |     const terminalTextarea = page.locator('.xterm-helper-textarea');
  174 |     const terminalBody = page.locator('.xterm');
  175 | 
  176 |     await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
  177 |     await page.waitForTimeout(3000);
  178 | 
  179 |     await terminalTextarea.focus();
  180 | 
  181 |     await page.keyboard.type('read -p "Type input: " val; echo "Logged: $val"', { delay: 10 });
  182 |     await page.keyboard.press('Enter');
  183 |     await expect(terminalBody).toContainText('Type input:', { timeout: 5000 });
  184 | 
  185 |     await page.keyboard.type('SecurePTY', { delay: 50 });
  186 |     await page.keyboard.press('Enter');
  187 |     await expect(terminalBody).toContainText('Logged: SecurePTY', { timeout: 5000 });
  188 | 
  189 |     await page.keyboard.type('sleep 100', { delay: 10 });
  190 |     await page.keyboard.press('Enter');
  191 |     await page.waitForTimeout(1000);
  192 | 
  193 |     await page.keyboard.press('Control+C');
  194 |     await expect(terminalBody).toContainText('sandbox:~#', { timeout: 5000 });
  195 | 
  196 |     await page.keyboard.type('node -e "let count = 0; setInterval(() => { count++; if(count > 50) process.exit(0); }, 50)" &', { delay: 10 });
  197 |     await page.keyboard.press('Enter');
> 198 |     await page.waitForTimeout(500);
      |                ^ Error: page.waitForTimeout: Test ended.
  199 | 
  200 |     await page.keyboard.type('echo "PTY_ACTIVE"', { delay: 10 });
  201 |     await page.keyboard.press('Enter');
  202 |     await expect(terminalBody).toContainText('PTY_ACTIVE', { timeout: 5000 });
  203 |   });
  204 | 
  205 |   // ═══════════════════════════════════════════════════════════════════════════════
  206 |   // TEST 3: Socket Security & Role-Based Access Control (RBAC)
  207 |   // ═══════════════════════════════════════════════════════════════════════════════
  208 |   test('3. restricts viewer workspace access and blocks unauthorized WebSocket upgrades', async ({ page, context }) => {
  209 |     const alicePage = page;
  210 |     const bobPage = await context.browser()!.newContext().then(c => c.newPage());
  211 |     const timestamp = Date.now();
  212 |     const aliceName = `Alice_RBAC_${timestamp}`;
  213 |     const bobName = `Bob_RBAC_${timestamp}`;
  214 | 
  215 |     await loginUser(alicePage, aliceName);
  216 |     await loginUser(bobPage, bobName);
  217 | 
  218 |     await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `RBAC_WS_${timestamp}`);
  219 |     await alicePage.click('button:has-text("Create Now")');
  220 |     await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
  221 |     const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
  222 |     await waitForBootComplete(alicePage);
  223 | 
  224 |     await createFile(alicePage, 'viewer-test.js');
  225 |     await alicePage.waitForTimeout(2000);
  226 | 
  227 |     await inviteUser(alicePage, bobName, 'viewer');
  228 | 
  229 |     await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
  230 |     await waitForBootComplete(bobPage);
  231 |     // Wait for auto-navigation to file and editor to mount with readOnly=true
  232 |     await bobPage.locator('.ide-scrollbar').getByText('viewer-test.js').waitFor({ state: 'visible', timeout: 15000 });
  233 |     await bobPage.locator('.ide-scrollbar').getByText('viewer-test.js').click();
  234 |     await waitForEditorModel(bobPage, 'viewer-test.js');
  235 | 
  236 |     await expect(bobPage.locator('text=View Only')).toBeVisible({ timeout: 10000 });
  237 |     await expect(bobPage.locator('.xterm')).toContainText('sandbox:~#', { timeout: 25000 });
  238 | 
  239 |     const bobTerminalTextarea = bobPage.locator('.xterm-helper-textarea');
  240 |     await bobTerminalTextarea.focus();
  241 |     await bobPage.keyboard.type('cd ..', { delay: 10 });
  242 |     await bobPage.keyboard.press('Enter');
  243 |     await expect(bobPage.locator('.xterm')).toContainText('restricted', { timeout: 15000 });
  244 | 
  245 |     // Try running git command in Bob's terminal (should fail with command not found since PATH=/viewer_bin)
  246 |     await bobTerminalTextarea.focus();
  247 |     await bobPage.keyboard.type('git status', { delay: 10 });
  248 |     await bobPage.keyboard.press('Enter');
  249 |     await expect(bobPage.locator('.xterm')).toContainText('command not found', { timeout: 15000 });
  250 | 
  251 |     await bobPage.locator('.ide-scrollbar').getByText('viewer-test.js').click();
  252 |     await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });
  253 | 
  254 |     const bobMonaco = bobPage.locator('.monaco-editor').first();
  255 |     await bobMonaco.click();
  256 |     await bobPage.keyboard.type('Cannot write', { delay: 10 });
  257 |     await bobPage.waitForTimeout(1000);
  258 |     expect(await getEditorValue(bobPage)).toBe('');
  259 |   });
  260 | 
  261 |   // ═══════════════════════════════════════════════════════════════════════════════
  262 |   // TEST 4: The "Rug Pull" - Active Deletion During Live Typing
  263 |   // ═══════════════════════════════════════════════════════════════════════════════
  264 |   test('4. handles active file deletion while another peer is rapidly typing', async ({ page, context }) => {
  265 |     const alicePage = page;
  266 |     const bobPage = await context.browser()!.newContext().then(c => c.newPage());
  267 |     const timestamp = Date.now();
  268 | 
  269 |     await loginUser(alicePage, `Alice_RugPull_${timestamp}`);
  270 |     await loginUser(bobPage, `Bob_RugPull_${timestamp}`);
  271 | 
  272 |     await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `RugPull_WS_${timestamp}`);
  273 |     await alicePage.click('button:has-text("Create Now")');
  274 |     await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
  275 |     const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
  276 |     await waitForBootComplete(alicePage);
  277 | 
  278 |     await inviteUser(alicePage, `Bob_RugPull_${timestamp}`, 'editor');
  279 |     
  280 |     await createFile(alicePage, 'doomed.js');
  281 |     await alicePage.waitForTimeout(2000);
  282 | 
  283 |     await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
  284 |     await waitForBootComplete(bobPage);
  285 |     
  286 |     await bobPage.locator('.ide-scrollbar').getByText('doomed.js').waitFor({ state: 'visible', timeout: 15000 });
  287 |     await bobPage.locator('.ide-scrollbar').getByText('doomed.js').click();
  288 |     await waitForEditorModel(bobPage, 'doomed.js');
  289 | 
  290 |     // Bob starts typing rapidly via evaluation to simulate intense CRDT activity
  291 |     await bobPage.evaluate(() => {
  292 |       const editor = (window as any).monaco.editor.getEditors()[0];
  293 |       (window as any).rugPullInterval = setInterval(() => {
  294 |         editor.executeEdits('test', [{
  295 |           range: editor.getModel().getFullModelRange(),
  296 |           text: editor.getModel().getValue() + '\nSPAM',
  297 |           forceMoveMarkers: true
  298 |         }]);
```