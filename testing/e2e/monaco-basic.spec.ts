import { test, expect } from '@playwright/test';

const APP_URL = process.env.BASE_URL || 'http://localhost:5173';

test.describe('Monaco Editor Basic Functions', () => {

  test('1. verify monaco global type and instance structure', async ({ page }) => {
    await page.goto(`${APP_URL}/login`);
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
    expect(monacoType).toBe('object');
    
    const getEditors = await page.evaluate(() => typeof (window as any).monaco?.editor?.getEditors);
    console.log("GET EDITORS:", getEditors);
    expect(getEditors).toBe('function');
    
    const models = await page.evaluate(() => (window as any).monaco?.editor?.getModels()?.length);
    console.log("MODELS:", models);
    expect(models).toBeGreaterThan(0);
  });

  test('2. verify monaco edit undo history', async ({ page }) => {
    await page.goto(`${APP_URL}/login`);
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
    expect(valBefore).toBe('Hello World');

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
    expect(valAfter).toBe('Hello');
  });

  test('3. verify monaco model URI paths', async ({ page }) => {
    await page.goto(`${APP_URL}/login`);
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
    expect(uris.length).toBe(2);
    expect(uris[1]).toBe('/file-alpha.js');
  });

});
