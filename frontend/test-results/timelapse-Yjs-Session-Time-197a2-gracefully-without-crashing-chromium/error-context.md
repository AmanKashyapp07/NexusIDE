# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: timelapse.spec.ts >> Yjs Session Timelapse Replay >> should handle empty files gracefully without crashing
- Location: ../testing/e2e/timelapse.spec.ts:74:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.shadow-2xl.z-50').getByText('CRDT Timelapse')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for locator('.shadow-2xl.z-50').getByText('CRDT Timelapse')

```

```yaml
- banner:
  - text: Timelapse-Test-1783449847718 admin workspace
  - button "Join Voice"
  - button "TE"
  - button "Share"
  - button "Export"
  - button "History"
  - button "Logout"
- text: Explorer
- button "Refresh Explorer"
- button "New File"
- button "New Folder"
- text: empty.js
- button "Delete File"
- main:
  - text: empty.js
  - button "Timelapse"
  - text: "Failed to load history Failed to execute 'atob' on 'Window': The string to be decoded is not correctly encoded. Sandbox"
  - button "Preview"
  - button "Restart"
  - button "Clear Terminal"
  - textbox "Terminal input"
- alert
- alert
```

# Test source

```ts
  1   | import { test, expect, type Page, type Browser } from '@playwright/test';
  2   | import { login, createTestWorkspace, deleteTestWorkspace, createTestFile, typeTextInMonaco } from './testUtils';
  3   | 
  4   | const APP_URL = process.env.BASE_URL || 'http://localhost:5173';
  5   | 
  6   | // Helper: set the timelapse clock to a specific value.
  7   | // React 18 production builds do NOT respond to native DOM events dispatched on
  8   | // range inputs via evaluate(). The TimelapseReplayer exposes `window.__timelapseSetClock`
  9   | // as an imperative escape hatch that directly calls React's setState.
  10  | async function setRangeValue(page: Page, _selector: string, value: string) {
  11  |   await page.evaluate((val) => {
  12  |     if ((window as any).__timelapseSetClock) {
  13  |       (window as any).__timelapseSetClock(Number(val));
  14  |     }
  15  |   }, value);
  16  |   // Wait for React to re-render with the new clock value
  17  |   await page.waitForTimeout(200);
  18  | }
  19  | 
  20  | test.describe('Yjs Session Timelapse Replay', () => {
  21  |   let workspaceId: string;
  22  |   const testWorkspaceTitle = `Timelapse-Test-${Date.now()}`;
  23  | 
  24  |   test.beforeEach(async ({ page }) => {
  25  |     await login(page, 'testuser1', 'password123');
  26  |     workspaceId = await createTestWorkspace(page, testWorkspaceTitle);
  27  |   });
  28  | 
  29  |   test.afterEach(async ({ page }) => {
  30  |     await deleteTestWorkspace(page, workspaceId);
  31  |   });
  32  | 
  33  |   test('should record keystrokes and play them back in timelapse mode', async ({ page }) => {
  34  |     // 1. Create a file
  35  |     await createTestFile(page, 'history_test.js');
  36  | 
  37  |     // 2. Type some code with slight delays so Yjs clocks advance distinctly
  38  |     await typeTextInMonaco(page, 'console.log("Hello");');
  39  |     
  40  |     // Allow time for debounced backend save
  41  |     await page.waitForTimeout(4000);
  42  |     
  43  |     // Type more code
  44  |     await page.keyboard.press('Enter');
  45  |     await typeTextInMonaco(page, 'const x = 42;');
  46  | 
  47  |     // Allow time for debounced backend save
  48  |     await page.waitForTimeout(4000);
  49  | 
  50  |     // 3. Open Timelapse Mode
  51  |     await expect(page.getByRole('button', { name: 'Timelapse' })).toBeVisible();
  52  |     await page.getByRole('button', { name: 'Timelapse' }).click();
  53  | 
  54  |     // 4. Verify Timelapse Replayer appears
  55  |     await expect(page.getByText('CRDT Timelapse')).toBeVisible();
  56  | 
  57  |     // Verify it loads with the latest content (slider is at max)
  58  |     const replayerContainer = page.locator('.shadow-2xl.z-50'); // Our TimelapseReplayer container
  59  |     await expect(replayerContainer.getByText('console.log("Hello");')).toBeVisible();
  60  |     await expect(replayerContainer.getByText('const x = 42;')).toBeVisible();
  61  | 
  62  |     // 5. Test Rewind
  63  |     await replayerContainer.getByTitle('Back to start (Home)').click();
  64  |     
  65  |     // 6. Test Playback
  66  |     // Wait for the text to appear gradually while playing
  67  |     await replayerContainer.getByTitle('Play (space)').click();
  68  |     
  69  |     // We should see text appear
  70  |     await expect(replayerContainer.getByText('console.log("Hello");')).toBeVisible({ timeout: 10000 });
  71  |     await expect(replayerContainer.getByText('const x = 42;')).toBeVisible({ timeout: 10000 });
  72  |   });
  73  | 
  74  |   test('should handle empty files gracefully without crashing', async ({ page }) => {
  75  |     // 1. Create an empty file
  76  |     await createTestFile(page, 'empty.js');
  77  | 
  78  |     // 2. Open Timelapse Mode
  79  |     await expect(page.getByRole('button', { name: 'Timelapse' })).toBeVisible();
  80  |     await page.getByRole('button', { name: 'Timelapse' }).click();
  81  | 
  82  |     // 3. Verify Timelapse Replayer loads and shows no content
  83  |     const replayerContainer = page.locator('.shadow-2xl.z-50');
> 84  |     await expect(replayerContainer.getByText('CRDT Timelapse')).toBeVisible();
      |                                                                 ^ Error: expect(locator).toBeVisible() failed
  85  |     
  86  |     // Check Monaco Editor model value instead of DOM text
  87  |     const editorValue = await page.evaluate(() => {
  88  |       const editors = (window as any).monaco?.editor?.getEditors();
  89  |       return editors && editors[1] ? editors[1].getModel()?.getValue() || '' : '';
  90  |     });
  91  |     expect(editorValue.trim()).toBe('');
  92  | 
  93  |     // 4. Close Timelapse
  94  |     await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  95  |     await expect(replayerContainer).not.toBeVisible();
  96  |   });
  97  | 
  98  |   test('should track edits interactively when replayer is closed and reopened', async ({ page }) => {
  99  |     // 1. Create file and perform initial typing
  100 |     await createTestFile(page, 'interactive.js');
  101 |     await typeTextInMonaco(page, 'const first = 1;');
  102 |     await page.waitForTimeout(4000); // Wait for debounced save
  103 | 
  104 |     // 2. Open Timelapse and verify initial state
  105 |     await page.getByRole('button', { name: 'Timelapse' }).click();
  106 |     const replayerContainer = page.locator('.shadow-2xl.z-50');
  107 |     await expect(replayerContainer.getByText('const first = 1;')).toBeVisible();
  108 | 
  109 |     // 3. Close Timelapse
  110 |     await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  111 |     await expect(replayerContainer).not.toBeVisible();
  112 | 
  113 |     // 4. Add more content outside timelapse mode
  114 |     await page.locator('.monaco-editor').first().click();
  115 |     await page.keyboard.press('Enter');
  116 |     await typeTextInMonaco(page, 'const second = 2;');
  117 |     await page.waitForTimeout(4000); // Wait for debounced save
  118 | 
  119 |     // 5. Reopen Timelapse and verify it has the latest updates
  120 |     await page.getByRole('button', { name: 'Timelapse' }).click();
  121 |     await expect(replayerContainer.getByText('const first = 1;')).toBeVisible();
  122 |     await expect(replayerContainer.getByText('const second = 2;')).toBeVisible();
  123 | 
  124 |     // Close again
  125 |     await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  126 |   });
  127 | 
  128 |   test('should update the replayed text dynamically when dragging the timeline slider', async ({ page }) => {
  129 |     // 1. Create file and make sequential distinct edits
  130 |     await createTestFile(page, 'slider.js');
  131 |     await typeTextInMonaco(page, 'LineOne');
  132 |     await page.waitForTimeout(4000);
  133 |     
  134 |     await page.keyboard.press('Enter');
  135 |     await typeTextInMonaco(page, 'LineTwo');
  136 |     await page.waitForTimeout(4000);
  137 | 
  138 |     // 2. Open Timelapse
  139 |     await page.getByRole('button', { name: 'Timelapse' }).click();
  140 |     const replayerContainer = page.locator('.shadow-2xl.z-50');
  141 |     await expect(replayerContainer.getByText('LineOne')).toBeVisible();
  142 |     await expect(replayerContainer.getByText('LineTwo')).toBeVisible();
  143 | 
  144 |     // 3. Get the slider element
  145 |     const slider = page.locator('.shadow-2xl.z-50 input[type="range"]');
  146 |     await expect(slider).toBeVisible();
  147 | 
  148 |     // 4. Move slider to start (0) using native setter so React's onChange fires
  149 |     await setRangeValue(page, '.shadow-2xl.z-50 input[type="range"]', '0');
  150 | 
  151 |     // 5. Verify the replayed text is now empty (back in time)
  152 |     await expect.poll(async () => {
  153 |       return page.evaluate(() => {
  154 |         const editors = (window as any).monaco?.editor?.getEditors();
  155 |         return editors && editors[1] ? editors[1].getModel()?.getValue() || '' : '';
  156 |       });
  157 |     }, { timeout: 10000 }).not.toContain('LineOne');
  158 |     
  159 |     await expect.poll(async () => {
  160 |       return page.evaluate(() => {
  161 |         const editors = (window as any).monaco?.editor?.getEditors();
  162 |         return editors && editors[1] ? editors[1].getModel()?.getValue() || '' : '';
  163 |       });
  164 |     }, { timeout: 10000 }).not.toContain('LineTwo');
  165 | 
  166 |     // 6. Reset slider to max using native setter
  167 |     const maxVal = await slider.getAttribute('max');
  168 |     await setRangeValue(page, '.shadow-2xl.z-50 input[type="range"]', maxVal ?? '100');
  169 | 
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
```