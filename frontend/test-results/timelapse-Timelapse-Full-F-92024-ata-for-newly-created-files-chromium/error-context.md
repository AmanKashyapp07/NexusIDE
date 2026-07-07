# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: timelapse.spec.ts >> Timelapse Full-Fidelity Replay >> history endpoint returns valid replay data for newly created files
- Location: ../testing/e2e/timelapse.spec.ts:1181:7

# Error details

```
TimeoutError: locator.waitFor: Timeout 15000ms exceeded.
Call log:
  - waiting for locator('input[placeholder="Username (e.g. alice, bob)"]') to be visible

```

# Test source

```ts
  1   | import { expect, type Page } from '@playwright/test';
  2   | 
  3   | const APP_URL = process.env.BASE_URL || 'http://localhost:5173';
  4   | 
  5   | export async function login(page: Page, username: string, password?: string) {
  6   |   await page.goto(`${APP_URL}/login`);
  7   |   const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
> 8   |   await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
      |                       ^ TimeoutError: locator.waitFor: Timeout 15000ms exceeded.
  9   |   await usernameInput.click();
  10  |   await usernameInput.fill(username);
  11  |   
  12  |   if (password) {
  13  |     const passwordInput = page.locator('input[placeholder="Password (anything works)"]');
  14  |     if (await passwordInput.isVisible()) {
  15  |       await passwordInput.fill(password);
  16  |     }
  17  |   }
  18  |   
  19  |   await page.locator('button[type="submit"]').click();
  20  |   await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
  21  | }
  22  | 
  23  | export async function createTestWorkspace(page: Page, title: string): Promise<string> {
  24  |   const input = page.locator('input[placeholder="e.g. React-Sandbox"]');
  25  |   await input.waitFor({ state: 'visible', timeout: 15000 });
  26  |   await input.fill(title);
  27  |   await page.click('button:has-text("Create Now")');
  28  |   
  29  |   await page.waitForURL(/\/ide\/[a-f0-9-]+/, { timeout: 20000 });
  30  |   const workspaceId = page.url().split('/ide/')[1].split('/')[0];
  31  |   
  32  |   // Wait for the environment to boot
  33  |   const loadingEl = page.locator('text=Booting environment...');
  34  |   try {
  35  |     await loadingEl.waitFor({ state: 'visible', timeout: 3000 });
  36  |     await loadingEl.waitFor({ state: 'detached', timeout: 45000 });
  37  |   } catch (e) {
  38  |     // Ignore timeout if it already loaded quickly
  39  |   }
  40  |   
  41  |   return workspaceId;
  42  | }
  43  | 
  44  | export async function deleteTestWorkspace(page: Page, workspaceId: string) {
  45  |   try {
  46  |     await page.evaluate(async (id) => {
  47  |       const token = localStorage.getItem('token');
  48  |       const origin = window.location.origin;
  49  |       const apiUrl = origin.includes('localhost') || origin.includes('127.0.0.1')
  50  |         ? `${window.location.protocol}//${window.location.hostname}:4000/api`
  51  |         : `${origin}/api`;
  52  |       const res = await fetch(`${apiUrl}/workspace/${id}`, {
  53  |         method: 'DELETE',
  54  |         headers: {
  55  |           'Authorization': `Bearer ${token}`,
  56  |         },
  57  |       });
  58  |       if (!res.ok) {
  59  |         console.error(`Failed to delete workspace ${id}:`, await res.text());
  60  |       }
  61  |     }, workspaceId);
  62  |   } catch (err) {
  63  |     console.error("Failed to delete workspace via evaluate:", err);
  64  |   }
  65  | }
  66  | 
  67  | export async function createTestFile(page: Page, filename: string) {
  68  |   await page.waitForTimeout(1500);
  69  |   await page.click('button[title="New File"]');
  70  |   const sidebarInput = page.locator('.ide-scrollbar input');
  71  |   await sidebarInput.waitFor({ state: 'visible', timeout: 15000 });
  72  |   await sidebarInput.focus();
  73  |   await sidebarInput.fill(filename);
  74  |   await sidebarInput.press('Enter');
  75  |   
  76  |   // Wait for editor to load the model
  77  |   await page.waitForFunction((expectedName) => {
  78  |     const editors = (window as any).monaco?.editor?.getEditors();
  79  |     if (!editors || editors.length === 0) return false;
  80  |     const model = editors[0].getModel();
  81  |     return model && model.uri.path.endsWith(expectedName);
  82  |   }, filename, { timeout: 25000 });
  83  | }
  84  | 
  85  | export async function typeTextInMonaco(page: Page, text: string) {
  86  |   // 1. Wait for Monaco to be initialized and have an editor instance
  87  |   await page.waitForFunction(() => {
  88  |     const editors = (window as any).monaco?.editor?.getEditors();
  89  |     return editors && editors.length > 0;
  90  |   }, { timeout: 15000 });
  91  | 
  92  |   // 2. Position cursor at the end of the document and focus
  93  |   await page.evaluate(() => {
  94  |     const editor = (window as any).monaco.editor.getEditors()[0];
  95  |     const model = editor.getModel();
  96  |     if (model) {
  97  |       const lastLine = model.getLineCount();
  98  |       const lastColumn = model.getLineMaxColumn(lastLine);
  99  |       editor.setPosition({ lineNumber: lastLine, column: lastColumn });
  100 |     }
  101 |     editor.focus();
  102 |   });
  103 | 
  104 |   // 3. Type the text
  105 |   await page.keyboard.type(text, { delay: 50 });
  106 | }
  107 | 
```