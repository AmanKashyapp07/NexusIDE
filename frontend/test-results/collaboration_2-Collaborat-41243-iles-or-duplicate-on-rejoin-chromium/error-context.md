# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: collaboration_2.spec.ts >> Collaborative Engine Part 2 (Tests 9-16) >> 9. rapid file switches do not leak content between files or duplicate on rejoin
- Location: ../testing/e2e/collaboration_2.spec.ts:80:7

# Error details

```
Error: expect(received).toContain(expected) // indexOf

Expected substring: "FILE_B_178317379900101"
Received string:    ""

Call Log:
- Timeout 15000ms exceeded while waiting on the predicate
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
            - generic [ref=e12]: Switch_WS_178317379900101
            - 'generic "Status: connected" [ref=e13]'
          - generic [ref=e14]: admin workspace
      - generic [ref=e15]:
        - button "Join Voice" [ref=e16]:
          - img [ref=e17]
          - generic [ref=e20]: Join Voice
        - button "AL BO" [ref=e23]:
          - generic [ref=e24]:
            - generic "Alice_Switch_178317379900101" [ref=e25]: AL
            - generic "Bob_Switch_178317379900101" [ref=e27]: BO
          - img [ref=e29]
        - generic [ref=e31]:
          - button "Share" [ref=e32]:
            - img [ref=e33]
            - text: Share
          - button "Export" [ref=e38]:
            - img [ref=e39]
            - text: Export
          - button "Logout" [ref=e42]:
            - img [ref=e43]
    - generic [ref=e46]:
      - generic [ref=e48]:
        - generic [ref=e49]:
          - generic [ref=e50]: Explorer
          - generic [ref=e51]:
            - button "Refresh Explorer" [ref=e52]:
              - img [ref=e53]
            - button "New File" [ref=e58]:
              - img [ref=e59]
            - button "New Folder" [ref=e62]:
              - img [ref=e63]
        - generic [ref=e65]:
          - generic [ref=e67] [cursor=pointer]:
            - generic [ref=e68]:
              - img [ref=e70]
              - generic [ref=e73]: file-a.js
            - button "Delete File" [ref=e75]:
              - img [ref=e76]
          - generic [ref=e80] [cursor=pointer]:
            - generic [ref=e82]:
              - img [ref=e84]
              - generic [ref=e87]: file-b.js
            - button "Delete File" [ref=e89]:
              - img [ref=e90]
      - main [ref=e93]:
        - generic [ref=e94]:
          - generic [ref=e98]:
            - img [ref=e99]
            - generic [ref=e102]: file-b.js
          - code [ref=e107]:
            - generic [ref=e108]:
              - textbox "Editor content" [active] [ref=e109]
              - textbox [ref=e110]
              - generic [ref=e115]: "1"
              - generic [ref=e116]:
                - generic [ref=e119]:
                  - generic [ref=e121]: "function file_b_178317379900101() {"
                  - generic [ref=e123]: console.log("FILE_B_178317379900101");
                  - generic [ref=e125]: "}"
                  - generic [ref=e127]: export default file_b_178317379900101;
                  - generic [ref=e129]: "export function file_b_178317379900101_1() {"
                  - generic [ref=e131]: console.log("FILE_B_17
                - generic [ref=e134]: console.log("FILE_B_178317379900101");
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
    - alert [ref=e167]: "function file_b_178317379900101() { console.log(\"FILE_B_178317379900101\"); } export default file_b_178317379900101; export function file_b_178317379900101_1() { console.log(\"FILE_B_17"
    - alert
```

# Test source

```ts
  31  |   await page.goto(`${APP_URL}/login`);
  32  |   const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
  33  |   await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
  34  |   await usernameInput.click();
  35  |   await usernameInput.fill(username);
  36  |   await page.locator('button[type="submit"]').click();
  37  |   await expect(page).toHaveURL(/\/dashboard/);
  38  | }
  39  | 
  40  | async function createFile(page: Page, filename: string) {
  41  |   await page.waitForTimeout(1500);
  42  |   await page.click('button[title="New File"]');
  43  |   const sidebarInput = page.locator('.ide-scrollbar input');
  44  |   await sidebarInput.waitFor({ state: 'visible', timeout: 15000 });
  45  |   await sidebarInput.focus();
  46  |   await sidebarInput.fill(filename);
  47  |   await sidebarInput.press('Enter');
  48  | }
  49  | 
  50  | async function getEditorValue(page: Page): Promise<string> {
  51  |   return page.evaluate(() => {
  52  |     const editors = (window as any).monaco?.editor?.getEditors();
  53  |     return editors && editors[0] ? editors[0].getModel()?.getValue() || '' : '';
  54  |   });
  55  | }
  56  | 
  57  | async function focusEditor(page: Page) {
  58  |   await page.evaluate(() => {
  59  |     const editors = (window as any).monaco?.editor?.getEditors();
  60  |     if (editors && editors[0]) editors[0].focus();
  61  |   });
  62  | }
  63  | 
  64  | async function waitForEditorModel(page: Page, filename: string) {
  65  |   await page.waitForFunction((expectedName) => {
  66  |     const editors = (window as any).monaco?.editor?.getEditors();
  67  |     if (!editors || editors.length === 0) return false;
  68  |     const model = editors[0].getModel();
  69  |     return model && model.uri.path.endsWith(expectedName);
  70  |   }, filename, { timeout: 25000 });
  71  |   await waitForEditorSync(page);
  72  | }
  73  | 
  74  | async function waitForEditorSync(page: Page) {
  75  |   await page.locator('text=Syncing with server...').waitFor({ state: 'hidden', timeout: 25000 });
  76  | }
  77  | 
  78  | test.describe('Collaborative Engine Part 2 (Tests 9-16)', () => {
  79  | 
  80  |   test('9. rapid file switches do not leak content between files or duplicate on rejoin', async ({ page, context }) => {
  81  |     const alicePage = page;
  82  |     const bobPage = await context.browser()!.newContext().then(c => c.newPage());
  83  |     const timestamp = Date.now();
  84  |     const FILE_A_CONTENT = `FILE_A_${timestamp}`;
  85  |     const FILE_B_CONTENT = `FILE_B_${timestamp}`;
  86  | 
  87  |     alicePage.on('console', msg => console.log(`[Test9 - Alice] ${msg.type()}: ${msg.text()}`));
  88  |     bobPage.on('console', msg => console.log(`[Test9 - Bob] ${msg.type()}: ${msg.text()}`));
  89  | 
  90  |     await loginUser(alicePage, `Alice_Switch_${timestamp}`);
  91  |     await loginUser(bobPage, `Bob_Switch_${timestamp}`);
  92  | 
  93  |     await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Switch_WS_${timestamp}`);
  94  |     await alicePage.click('button:has-text("Create Now")');
  95  |     await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
  96  |     const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
  97  |     await waitForBootComplete(alicePage);
  98  |     await inviteUser(alicePage, `Bob_Switch_${timestamp}`, 'editor');
  99  | 
  100 |     await createFile(alicePage, 'file-a.js');
  101 |     await waitForEditorModel(alicePage, 'file-a.js');
  102 |     await focusEditor(alicePage);
  103 |     await alicePage.keyboard.type(`console.log("${FILE_A_CONTENT}");`);
  104 |     await alicePage.waitForTimeout(3000);
  105 | 
  106 |     await createFile(alicePage, 'file-b.js');
  107 |     await waitForEditorModel(alicePage, 'file-b.js');
  108 |     await focusEditor(alicePage);
  109 |     await alicePage.keyboard.type(`console.log("${FILE_B_CONTENT}");`);
  110 |     await alicePage.waitForTimeout(3000);
  111 | 
  112 |     await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
  113 |     await waitForBootComplete(bobPage);
  114 | 
  115 |     // FIX: Using waitForEditorModel instead of hardcoded 300ms delays prevents
  116 |     // virtual DOM tearing by ensuring React fully executes the state change.
  117 |     for (let i = 0; i < 2; i++) {
  118 |       await bobPage.locator('.ide-scrollbar').getByText('file-a.js').click();
  119 |       await waitForEditorModel(bobPage, 'file-a.js');
  120 |       await bobPage.locator('.ide-scrollbar').getByText('file-b.js').click();
  121 |       await waitForEditorModel(bobPage, 'file-b.js');
  122 |     }
  123 |     
  124 |     await bobPage.locator('.ide-scrollbar').getByText('file-b.js').click();
  125 |     await waitForEditorModel(bobPage, 'file-b.js');
  126 | 
  127 |     await expect(async () => {
  128 |       const bobFileBText = await getEditorValue(bobPage);
  129 |       expect(bobFileBText).toContain(FILE_B_CONTENT);
  130 |       expect(bobFileBText).not.toContain(FILE_A_CONTENT);
> 131 |     }).toPass({ timeout: 15000, intervals: [1000] });
      |        ^ Error: expect(received).toContain(expected) // indexOf
  132 | 
  133 |     await bobPage.locator('.ide-scrollbar').getByText('file-a.js').click();
  134 |     await waitForEditorModel(bobPage, 'file-a.js');
  135 | 
  136 |     await expect(async () => {
  137 |       const modelText = await getEditorValue(bobPage);
  138 |       expect(modelText).toContain(FILE_A_CONTENT);
  139 |       expect(modelText).not.toContain(FILE_B_CONTENT);
  140 |     }).toPass({ timeout: 15000, intervals: [1000] });
  141 |   });
  142 | 
  143 |   test('10. content persists through full server doc eviction and reloads correctly for new users', async ({ page, context }) => {
  144 |     const alicePage = page;
  145 |     const bobPage = await context.browser()!.newContext().then(c => c.newPage());
  146 |     const timestamp = Date.now();
  147 |     const PERSIST_SENTINEL = `PERSISTED_${timestamp}`;
  148 | 
  149 |     await loginUser(alicePage, `Alice_Persist_${timestamp}`);
  150 |     await loginUser(bobPage, `Bob_Persist_${timestamp}`);
  151 | 
  152 |     await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Persist_WS_${timestamp}`);
  153 |     await alicePage.click('button:has-text("Create Now")');
  154 |     await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
  155 |     const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
  156 |     await waitForBootComplete(alicePage);
  157 |     await inviteUser(alicePage, `Bob_Persist_${timestamp}`, 'editor');
  158 | 
  159 |     await createFile(alicePage, 'persist-test.js');
  160 |     await waitForEditorModel(alicePage, 'persist-test.js');
  161 |     await focusEditor(alicePage);
  162 |     await alicePage.keyboard.type(`const sentinel = "${PERSIST_SENTINEL}";\n`);
  163 | 
  164 |     await alicePage.waitForTimeout(3000);
  165 |     await alicePage.goto(`${APP_URL}/dashboard`);
  166 |     await alicePage.waitForURL(/\/dashboard/);
  167 |     
  168 |     // Crucial: Give Postgres enough time to physically commit the BYTEA blob
  169 |     await alicePage.waitForTimeout(4000);
  170 | 
  171 |     await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
  172 |     await waitForBootComplete(bobPage);
  173 |     await bobPage.locator('.ide-scrollbar').getByText('persist-test.js').click();
  174 |     await waitForEditorModel(bobPage, 'persist-test.js');
  175 | 
  176 |     await expect(async () => {
  177 |       const bobText = await getEditorValue(bobPage);
  178 |       expect(bobText).toContain(PERSIST_SENTINEL);
  179 |       expect(bobText.split(PERSIST_SENTINEL).length - 1).toBe(1);
  180 |     }).toPass({ timeout: 15000, intervals: [1000] });
  181 |   });
  182 | 
  183 |   test('11. maintains isolated undo/redo stacks per user without affecting peer edits', async ({ page, context }) => {
  184 |     const alicePage = page;
  185 |     const bobPage = await context.browser()!.newContext().then(c => c.newPage());
  186 |     const timestamp = Date.now();
  187 | 
  188 |     await loginUser(alicePage, `Alice_Undo_${timestamp}`);
  189 |     await loginUser(bobPage, `Bob_Undo_${timestamp}`);
  190 | 
  191 |     await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Undo_WS_${timestamp}`);
  192 |     await alicePage.click('button:has-text("Create Now")');
  193 |     await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
  194 |     const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
  195 |     await waitForBootComplete(alicePage);
  196 | 
  197 |     await inviteUser(alicePage, `Bob_Undo_${timestamp}`, 'editor');
  198 |     await createFile(alicePage, 'undo-test.js');
  199 |     await waitForEditorModel(alicePage, 'undo-test.js');
  200 | 
  201 |     await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
  202 |     await waitForBootComplete(bobPage);
  203 |     await bobPage.locator('.ide-scrollbar').getByText('undo-test.js').click();
  204 |     await waitForEditorModel(bobPage, 'undo-test.js');
  205 | 
  206 |     await focusEditor(alicePage);
  207 |     await alicePage.keyboard.type('// Alice Edit 1\n');
  208 |     await alicePage.waitForTimeout(500);
  209 | 
  210 |     await focusEditor(bobPage);
  211 |     await bobPage.keyboard.type('// Bob Edit 1\n');
  212 |     await bobPage.waitForTimeout(500);
  213 | 
  214 |     await focusEditor(alicePage);
  215 |     await alicePage.keyboard.type('X');
  216 |     
  217 |     await expect(async () => {
  218 |       const bobText = await getEditorValue(bobPage);
  219 |       expect(bobText).toContain('Alice Edit 1');
  220 |       expect(bobText).toContain('Bob Edit 1');
  221 |       expect(bobText).toContain('X');
  222 |     }).toPass({ timeout: 5000, intervals: [500] });
  223 | 
  224 |     await alicePage.evaluate(() => {
  225 |       const ed = (window as any).monaco.editor.getEditors()[0];
  226 |       if (ed) { ed.focus(); ed.trigger('keyboard', 'undo', null); }
  227 |     });
  228 | 
  229 |     await expect(async () => {
  230 |       const aliceText = await getEditorValue(alicePage);
  231 |       expect(aliceText).toContain('Bob Edit 1');
```