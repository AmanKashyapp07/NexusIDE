# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: conflict.spec.ts >> Git Merge Conflict Resolver E2E - Brutal Scenarios >> Should handle multiple, empty, and CRLF-formatted conflicts gracefully
- Location: ../testing/e2e/conflict.spec.ts:52:7

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - navigation [ref=e4]:
    - generic [ref=e5]:
      - generic [ref=e6]:
        - img [ref=e8]
        - generic [ref=e10]: NexusIDE
      - generic [ref=e11]:
        - generic [ref=e12]:
          - img "conflict_admin" [ref=e13]
          - generic [ref=e14]: conflict_admin
        - button "Log out" [ref=e15]:
          - img [ref=e16]
  - main [ref=e19]:
    - generic [ref=e20]:
      - heading "Overview" [level=1] [ref=e21]
      - paragraph [ref=e22]: Manage your cloud environments and collaborate with your team.
    - generic [ref=e23]:
      - generic [ref=e24]:
        - heading "Recent Workspaces" [level=2] [ref=e26]:
          - img [ref=e27]
          - text: Recent Workspaces
        - generic [ref=e31]:
          - img [ref=e33]
          - heading "No workspaces yet" [level=3] [ref=e37]
          - paragraph [ref=e38]: Create your first sandbox environment to start writing code.
      - complementary [ref=e39]:
        - generic [ref=e40]:
          - heading "Create Workspace" [level=3] [ref=e42]
          - paragraph [ref=e43]: Spin up a new isolated environment.
          - generic [ref=e44]:
            - textbox "e.g. React-Sandbox" [ref=e45]
            - button "Create Now" [ref=e46]:
              - img [ref=e47]
              - text: Create Now
        - generic [ref=e48]:
          - heading "Join Workspace" [level=3] [ref=e49]
          - paragraph [ref=e50]: Enter a UUID to collaborate with others.
          - generic [ref=e51]:
            - textbox "Paste workspace ID..." [ref=e52]
            - button "Join Environment" [ref=e53]:
              - text: Join Environment
              - img [ref=e54]
```

# Test source

```ts
  1   | import { test, expect, type Page, type APIRequestContext, type Browser } from '@playwright/test';
  2   | 
  3   | const APP_URL = 'http://localhost:5173';
  4   | const API_URL = 'http://localhost:4000/api';
  5   | 
  6   | async function loginUser(page: Page, request: APIRequestContext, username: string) {
  7   |   await page.goto(`${APP_URL}/login`);
  8   |   const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
  9   |   await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
  10  |   await usernameInput.click();
  11  |   await usernameInput.fill(username);
  12  |   await page.locator('button[type="submit"]').click();
  13  |   await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
  14  |   
  15  |   const token = await page.evaluate(() => localStorage.getItem('token'));
  16  |   return token as string;
  17  | }
  18  | 
  19  | test.describe('Git Merge Conflict Resolver E2E - Brutal Scenarios', () => {
  20  |   test.setTimeout(120000);
  21  | 
  22  |   let token: string;
  23  |   let wsId: string;
  24  |   let fileId: string;
  25  | 
  26  |   // Setup: Create a shared workspace and file for each test
  27  |   test.beforeEach(async ({ page, request }) => {
  28  |     token = await loginUser(page, request, 'conflict_admin');
  29  |     
  30  |     const wsRes = await request.post(`${API_URL}/workspace`, {
  31  |       headers: { Authorization: `Bearer ${token}` },
  32  |       data: { title: 'Brutal Merge Conflict Workspace' }
  33  |     });
  34  |     const ws = await wsRes.json();
  35  |     wsId = ws.id;
  36  |     
  37  |     const fileRes = await request.post(`${API_URL}/workspace/${wsId}/files`, {
  38  |       headers: { Authorization: `Bearer ${token}` },
  39  |       data: { name: 'brutal_conflict.js', type: 'file' }
  40  |     });
  41  |     const file = await fileRes.json();
  42  |     fileId = file.id;
  43  |   });
  44  | 
  45  |   // Cleanup
  46  |   test.afterEach(async ({ request }) => {
  47  |     await request.delete(`${API_URL}/workspace/${wsId}`, {
  48  |       headers: { Authorization: `Bearer ${token}` }
  49  |     });
  50  |   });
  51  | 
  52  |   test('Should handle multiple, empty, and CRLF-formatted conflicts gracefully', async ({ request }) => {
  53  |     // Inject a brutally messy conflict string:
  54  |     // 1. CRLF mixed with LF
  55  |     // 2. Empty 'ours' block
  56  |     // 3. Multiple conflicts in one file
  57  |     const messyConflictContent = 
  58  |       `function init() { \r\n` +
  59  |       `<<<<<<< HEAD\n` +
  60  |       `=======\r\n` +
  61  |       `  console.log("Only theirs exists");\n` +
  62  |       `>>>>>>> branch-a\n` +
  63  |       `  let active = true;\n` +
  64  |       `<<<<<<< HEAD\n` +
  65  |       `  runProcess(active);\n` +
  66  |       `=======\n` +
  67  |       `  execute(active);\n` +
  68  |       `>>>>>>> branch-b\n` +
  69  |       `}`;
  70  | 
  71  |     // Force content update via API (assuming a backend hook exists for git pulls)
  72  |     // Or inject via Monaco if API bypass isn't available
  73  |     await request.put(`${API_URL}/workspace/${wsId}/files/${fileId}`, {
  74  |       headers: { Authorization: `Bearer ${token}` },
  75  |       data: { content: messyConflictContent }
  76  |     });
  77  | 
  78  |     const parseRes = await request.get(`${API_URL}/workspace/${wsId}/files/${fileId}/conflicts`, {
  79  |       headers: { Authorization: `Bearer ${token}` }
  80  |     });
  81  |     
  82  |     expect(parseRes.ok()).toBeTruthy();
  83  |     const parseData = await parseRes.json();
  84  |     
> 85  |     expect(parseData.hasConflicts).toBe(true);
      |                                    ^ Error: expect(received).toBe(expected) // Object.is equality
  86  |     expect(parseData.conflicts.filter(c => c.type === 'conflict').length).toBe(2);
  87  |     
  88  |     // Validate empty block parsing
  89  |     expect(parseData.conflicts[1].ours.trim()).toBe('');
  90  |     expect(parseData.conflicts[1].theirs).toContain('Only theirs exists');
  91  |   });
  92  | 
  93  |   test('Should fail securely on malformed conflict markers', async ({ request }) => {
  94  |     // Missing the closing >>>>>>> marker
  95  |     const malformedContent = `<<<<<<< HEAD\nconsole.log("a");\n=======\nconsole.log("b");`;
  96  | 
  97  |     await request.put(`${API_URL}/workspace/${wsId}/files/${fileId}`, {
  98  |       headers: { Authorization: `Bearer ${token}` },
  99  |       data: { content: malformedContent }
  100 |     });
  101 | 
  102 |     const parseRes = await request.get(`${API_URL}/workspace/${wsId}/files/${fileId}/conflicts`, {
  103 |       headers: { Authorization: `Bearer ${token}` }
  104 |     });
  105 |     
  106 |     // The parser should ideally catch this and return a 400 or mark it as an invalid git state,
  107 |     // rather than crashing the backend.
  108 |     expect([200, 400, 422]).toContain(parseRes.status());
  109 |     if (parseRes.ok()) {
  110 |       const parseData = await parseRes.json();
  111 |       expect(parseData.hasConflicts).toBe(false); // Should not parse as a valid conflict
  112 |     }
  113 |   });
  114 | 
  115 |   test('Collaborative Real-time Resolution (Dual-Browser Sync)', async ({ browser, request }) => {
  116 |     // Create two separate browser contexts to simulate two different users
  117 |     const contextA = await browser.newContext();
  118 |     const contextB = await browser.newContext();
  119 |     
  120 |     const pageA = await contextA.newPage();
  121 |     const pageB = await contextB.newPage();
  122 | 
  123 |     // Login both users
  124 |     const tokenA = await loginUser(pageA, request, 'user_a');
  125 |     await loginUser(pageB, request, 'user_b');
  126 | 
  127 |     // Both users navigate to the same file
  128 |     await Promise.all([
  129 |       pageA.goto(`${APP_URL}/ide/${wsId}/${fileId}`),
  130 |       pageB.goto(`${APP_URL}/ide/${wsId}/${fileId}`)
  131 |     ]);
  132 | 
  133 |     // Wait for both editors to mount
  134 |     const waitForEditor = async (page: Page) => {
  135 |       await page.waitForFunction(() => {
  136 |         return (window as any).monaco?.editor?.getEditors()?.length > 0;
  137 |       }, { timeout: 30000 });
  138 |     };
  139 |     await Promise.all([waitForEditor(pageA), waitForEditor(pageB)]);
  140 | 
  141 |     // Inject conflict via User A
  142 |     const conflictContent = `<<<<<<< HEAD\nUser A edits\n=======\nUser B edits\n>>>>>>> main`;
  143 |     await pageA.evaluate((content) => {
  144 |       const editor = (window as any).monaco.editor.getEditors()[0];
  145 |       editor.setValue(content);
  146 |     }, conflictContent);
  147 | 
  148 |     // Assert User B sees the conflict injected by User A via Yjs
  149 |     await pageB.waitForFunction((expected) => {
  150 |       const editor = (window as any).monaco.editor.getEditors()[0];
  151 |       return editor.getValue() === expected;
  152 |     }, conflictContent, { timeout: 10000 });
  153 | 
  154 |     // User A resolves the conflict via API
  155 |     const resolvedContent = `Merged edits`;
  156 |     const resolveRes = await request.post(`${API_URL}/workspace/${wsId}/files/${fileId}/conflicts/resolve`, {
  157 |       headers: { Authorization: `Bearer ${tokenA}` },
  158 |       data: { resolvedContent }
  159 |     });
  160 |     expect(resolveRes.ok()).toBeTruthy();
  161 | 
  162 |     // BRUTAL CHECK: Does User B's Monaco editor update instantly without a page reload?
  163 |     // This tests if your backend correctly broadcasts the resolution over WebSockets/Yjs
  164 |     await pageB.waitForFunction((expected) => {
  165 |       const editor = (window as any).monaco.editor.getEditors()[0];
  166 |       return editor.getValue() === expected;
  167 |     }, resolvedContent, { timeout: 5000 });
  168 | 
  169 |     const finalContentB = await pageB.evaluate(() => {
  170 |       const editor = (window as any).monaco.editor.getEditors()[0];
  171 |       return editor.getValue();
  172 |     });
  173 |     
  174 |     expect(finalContentB).toBe(resolvedContent);
  175 | 
  176 |     await contextA.close();
  177 |     await contextB.close();
  178 |   });
  179 | 
  180 |   test('Race Condition: User types in Monaco while conflict is being resolved via API', async ({ page, request }) => {
  181 |     // Setup file with conflict
  182 |     const conflictContent = `<<<<<<< HEAD\nvar x = 1;\n=======\nvar x = 2;\n>>>>>>> main`;
  183 |     await page.goto(`${APP_URL}/ide/${wsId}/${fileId}`);
  184 |     
  185 |     await page.waitForFunction(() => {
```