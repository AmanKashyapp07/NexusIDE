import { test, expect } from '@playwright/test';

test('check monaco undo', async ({ page }) => {
  await page.goto('http://localhost:5173/login');
  await page.fill('input[placeholder="Username (e.g. alice, bob)"]', 'testundo');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/);
  await page.fill('input[placeholder="e.g. React-Sandbox"]', 'MonacoUndo');
  await page.click('button:has-text("Create Now")');
  await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
  await page.click('button[title="New File"]');
  await page.fill('.ide-scrollbar input', 'test.js');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.monaco-editor', { timeout: 15000 });
  
  // Type something
  const editor = page.locator('.monaco-editor').first();
  await editor.click();
  await page.keyboard.type('Hello World', { delay: 10 });
  await page.waitForTimeout(500);

  // Get value
  const valBefore = await page.evaluate(() => (window as any).monaco.editor.getEditors()[0].getModel().getValue());
  console.log("BEFORE UNDO:", valBefore);

  // Undo
  await page.evaluate(() => {
    const ed = (window as any).monaco.editor.getEditors()[0];
    ed.focus();
    ed.trigger('keyboard', 'undo', null);
  });
  await page.waitForTimeout(500);

  // Get value after
  const valAfter = await page.evaluate(() => (window as any).monaco.editor.getEditors()[0].getModel().getValue());
  console.log("AFTER UNDO:", valAfter);
});
