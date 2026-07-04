import { test, expect } from '@playwright/test';

test('check monaco', async ({ page }) => {
  await page.goto('http://localhost:5173/login');
  await page.fill('input[placeholder="Username (e.g. alice, bob)"]', 'testmonaco');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/);
  await page.fill('input[placeholder="e.g. React-Sandbox"]', 'MonacoCheck');
  await page.click('button:has-text("Create Now")');
  await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
  await page.click('button[title="New File"]');
  await page.fill('.ide-scrollbar input', 'test.js');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.monaco-editor', { timeout: 15000 });
  const monacoType = await page.evaluate(() => typeof (window as any).monaco);
  console.log("MONACO TYPE:", monacoType);
  const getEditors = await page.evaluate(() => typeof (window as any).monaco?.editor?.getEditors);
  console.log("GET EDITORS:", getEditors);
  const models = await page.evaluate(() => (window as any).monaco?.editor?.getModels()?.length);
  console.log("MODELS:", models);
});
