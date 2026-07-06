import { expect, type Page } from '@playwright/test';

const APP_URL = process.env.BASE_URL || 'http://localhost:5173';

export async function login(page: Page, username: string, password?: string) {
  await page.goto(`${APP_URL}/login`);
  const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
  await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
  await usernameInput.click();
  await usernameInput.fill(username);
  
  if (password) {
    const passwordInput = page.locator('input[placeholder="Password (anything works)"]');
    if (await passwordInput.isVisible()) {
      await passwordInput.fill(password);
    }
  }
  
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
}

export async function createTestWorkspace(page: Page, title: string): Promise<string> {
  const input = page.locator('input[placeholder="e.g. React-Sandbox"]');
  await input.waitFor({ state: 'visible', timeout: 15000 });
  await input.fill(title);
  await page.click('button:has-text("Create Now")');
  
  await page.waitForURL(/\/ide\/[a-f0-9-]+/, { timeout: 20000 });
  const workspaceId = page.url().split('/ide/')[1].split('/')[0];
  
  // Wait for the environment to boot
  const loadingEl = page.locator('text=Booting environment...');
  try {
    await loadingEl.waitFor({ state: 'visible', timeout: 3000 });
    await loadingEl.waitFor({ state: 'detached', timeout: 45000 });
  } catch (e) {
    // Ignore timeout if it already loaded quickly
  }
  
  return workspaceId;
}

export async function deleteTestWorkspace(page: Page, workspaceId: string) {
  try {
    await page.evaluate(async (id) => {
      const token = localStorage.getItem('token');
      const res = await fetch(`${window.location.protocol}//${window.location.hostname}:4000/api/workspace/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        console.error(`Failed to delete workspace ${id}:`, await res.text());
      }
    }, workspaceId);
  } catch (err) {
    console.error("Failed to delete workspace via evaluate:", err);
  }
}

export async function createTestFile(page: Page, filename: string) {
  await page.waitForTimeout(1500);
  await page.click('button[title="New File"]');
  const sidebarInput = page.locator('.ide-scrollbar input');
  await sidebarInput.waitFor({ state: 'visible', timeout: 15000 });
  await sidebarInput.focus();
  await sidebarInput.fill(filename);
  await sidebarInput.press('Enter');
  
  // Wait for editor to load the model
  await page.waitForFunction((expectedName) => {
    const editors = (window as any).monaco?.editor?.getEditors();
    if (!editors || editors.length === 0) return false;
    const model = editors[0].getModel();
    return model && model.uri.path.endsWith(expectedName);
  }, filename, { timeout: 25000 });
}

export async function typeTextInMonaco(page: Page, text: string) {
  // 1. Wait for Monaco to be initialized and have an editor instance
  await page.waitForFunction(() => {
    const editors = (window as any).monaco?.editor?.getEditors();
    return editors && editors.length > 0;
  }, { timeout: 15000 });

  // 2. Position cursor at the end of the document and focus
  await page.evaluate(() => {
    const editor = (window as any).monaco.editor.getEditors()[0];
    const model = editor.getModel();
    if (model) {
      const lastLine = model.getLineCount();
      const lastColumn = model.getLineMaxColumn(lastLine);
      editor.setPosition({ lineNumber: lastLine, column: lastColumn });
    }
    editor.focus();
  });

  // 3. Type the text
  await page.keyboard.type(text, { delay: 50 });
}
