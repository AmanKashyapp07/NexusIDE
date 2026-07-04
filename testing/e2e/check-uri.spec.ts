import { test, expect } from '@playwright/test';

test('check monaco uri', async ({ page }) => {
  await page.goto('http://localhost:5173/login');
  await page.fill('input[placeholder="Username (e.g. alice, bob)"]', 'testuri');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/);
  await page.fill('input[placeholder="e.g. React-Sandbox"]', 'UriTest');
  await page.click('button:has-text("Create Now")');
  await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
  await page.click('button[title="New File"]');
  await page.fill('.ide-scrollbar input', 'file-alpha.js');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.monaco-editor', { timeout: 15000 });
  
  await page.waitForTimeout(2000);

  const uris = await page.evaluate(() => {
    const editors = (window as any).monaco.editor.getEditors();
    if (!editors || !editors[0]) return [];
    return [
      editors[0].getModel().uri.toString(),
      editors[0].getModel().uri.path
    ];
  });
  console.log("URIs:", uris);
});
