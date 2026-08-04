import { expect, type Page, type APIRequestContext } from '@playwright/test';

export const APP_URL = process.env.BASE_URL || 'http://localhost:5173';
export const API_URL = (() => {
  const base = process.env.BASE_URL;
  if (!base) return 'http://localhost:4000/api';
  try {
    const u = new URL(base);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') u.port = '4000';
    u.pathname = '/api';
    return u.toString().replace(/\/$/, '');
  } catch { return 'http://localhost:4000/api'; }
})();
export const WS_URL = (() => {
  const base = process.env.BASE_URL;
  if (!base) return 'ws://localhost:4000';
  try {
    const u = new URL(base);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') u.port = '4000';
    else u.pathname = '/ws';
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    return u.toString().replace(/\/$/, '');
  } catch { return 'ws://localhost:4000'; }
})();

export async function login(page: Page, username: string, password?: string): Promise<string> {
  try {
    const res = await page.request.post(`${API_URL}/auth/test-login`, {
      data: { username, password: password || 'test' }
    });
    if (res.ok()) {
      const { token } = await res.json();
      await page.goto(`${APP_URL}/login`);
      await page.evaluate((t) => localStorage.setItem('token', t), token);
      await page.goto(`${APP_URL}/dashboard`);
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
      return token;
    }
  } catch {}

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
  return '';
}

export async function loginUser(page: Page, arg2: APIRequestContext | string, arg3?: string): Promise<string> {
  if (typeof arg2 === 'string') {
    return login(page, arg2, arg3);
  }
  const request = arg2 as APIRequestContext;
  const username = arg3!;
  const loginRes = await request.post(`${API_URL}/auth/test-login`, {
    data: { username, password: 'test' },
  });
  if (!loginRes.ok()) {
    throw new Error(`Login API failed for "${username}": ${loginRes.status()} ${await loginRes.text()}`);
  }
  const { token } = await loginRes.json();
  await page.goto(`${APP_URL}/login`);
  await page.evaluate((t) => localStorage.setItem('token', t), token);
  await page.goto(`${APP_URL}/dashboard`);
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
  return token;
}

export async function inviteUser(page: Page, username: string, role: 'editor' | 'viewer' | 'admin') {
  await page.click('button:has-text("Share")');
  await page.fill('input[placeholder="Username or Email"]', username);
  await page.selectOption('select', role);
  await page.click('button:has-text("Invite")');
  await expect(page.locator(`.flex.items-center.justify-between:has-text("${username}")`)).toBeVisible({ timeout: 10000 });
  await page.click('.fixed.inset-0', { position: { x: 10, y: 10 } });
}

export async function waitForBootComplete(page: Page) {
  const loadingEl = page.locator('text=Booting environment...');
  try {
    await loadingEl.waitFor({ state: 'visible', timeout: 3000 });
    await loadingEl.waitFor({ state: 'detached', timeout: 35000 });
  } catch {}
}

export async function focusEditor(page: Page) {
  const textarea = page.locator('.monaco-editor').first();
  await textarea.click();
  await page.waitForTimeout(200);
}

export async function createTestWorkspace(page: Page, title: string): Promise<string> {
  const input = page.locator('input[placeholder="e.g. React-Sandbox"]');
  await input.waitFor({ state: 'visible', timeout: 15000 });
  await input.fill(title);
  await page.click('button:has-text("Create Now")');
  
  await page.waitForURL(/\/ide\/[a-f0-9-]+/, { timeout: 20000 });
  const workspaceId = page.url().split('/ide/')[1].split('/')[0];
  
  const loadingEl = page.locator('text=Booting environment...');
  try {
    await loadingEl.waitFor({ state: 'visible', timeout: 3000 });
    await loadingEl.waitFor({ state: 'detached', timeout: 45000 });
  } catch (e) {}
  
  return workspaceId;
}

export async function deleteTestWorkspace(page: Page, workspaceId: string) {
  try {
    await page.evaluate(async (id) => {
      const token = localStorage.getItem('token');
      const origin = window.location.origin;
      const apiUrl = origin.includes('localhost') || origin.includes('127.0.0.1')
        ? `${window.location.protocol}//${window.location.hostname}:4000/api`
        : `${origin}/api`;
      const res = await fetch(`${apiUrl}/workspace/${id}`, {
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
  
  await page.waitForFunction((expectedName) => {
    const editors = (window as any).monaco?.editor?.getEditors();
    if (!editors || editors.length === 0) return false;
    const model = editors[0].getModel();
    return model && model.uri.path.endsWith(expectedName);
  }, filename, { timeout: 25000 });
}

export const createFile = createTestFile;

export async function typeTextInMonaco(page: Page, text: string) {
  await page.waitForFunction(() => {
    const editors = (window as any).monaco?.editor?.getEditors();
    return editors && editors.length > 0;
  }, { timeout: 15000 });

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

  await page.keyboard.type(text, { delay: 50 });
}

export async function getEditorValue(page: Page): Promise<string> {
  return page.evaluate(() => {
    const editors = (window as any).monaco?.editor?.getEditors();
    return editors && editors[0] ? editors[0].getModel()?.getValue() || '' : '';
  });
}

export async function waitForEditorSync(page: Page) {
  const loading = page.locator('text=Syncing with server...');
  try { await loading.waitFor({ state: 'visible', timeout: 1500 }); } catch {}
  try { await loading.waitFor({ state: 'detached', timeout: 30000 }); } catch {}
}

export async function waitForEditorModel(page: Page, filename: string) {
  await page.waitForFunction((expectedName) => {
    const editors = (window as any).monaco?.editor?.getEditors();
    if (!editors || editors.length === 0) return false;
    const model = editors[0].getModel();
    return model && model.uri.path.endsWith(expectedName);
  }, filename, { timeout: 30000 });
  await page.waitForFunction(() => {
    const editors = (window as any).monaco?.editor?.getEditors();
    return editors && editors.length > 0 && typeof editors[0].hasTextFocus === 'function';
  }, { timeout: 15000 });
  await waitForEditorSync(page);
}

export async function setMonacoValue(page: Page, text: string) {
  await page.evaluate((val) => {
    const editors = (window as any).monaco?.editor?.getEditors();
    if (editors && editors[0]) {
      editors[0].setValue(val);
    }
  }, text);
}

export async function setEditorValue(page: Page, text: string) {
  await page.evaluate((val) => {
    const editors = (window as any).monaco?.editor?.getEditors();
    if (!editors || !editors[0]) return;
    const editor = editors[0];
    const model = editor.getModel();
    if (!model) return;
    const fullRange = model.getFullModelRange();
    editor.executeEdits('test-edit', [{
      range: fullRange,
      text: val,
      forceMoveMarkers: true
    }]);
    editor.pushUndoStop();
  }, text);
}

export async function waitForSocketConnect(page: Page) {
  await page.locator('[title="Status: connected"]').waitFor({ state: 'visible', timeout: 25000 });
}

export async function setupUserAndWorkspace(page: Page, request: APIRequestContext | undefined, username: string, wsTitle: string) {
  const token = request ? await loginUser(page, request, username) : await login(page, username);
  const workspaceId = await createTestWorkspace(page, wsTitle);
  return { token, workspaceId };
}

export async function createFileAndOpen(page: Page, filename: string) {
  await createFile(page, filename);
  await waitForEditorModel(page, filename);
}

export async function waitForLspStatus(page: Page, status: 'ready' | 'connecting' | 'error', timeout = 30000) {
  await expect(page.locator('[data-testid="lsp-status-badge"]')).toHaveAttribute('data-lsp-status', status, { timeout });
}

export async function getMarkers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const monaco = (window as any).monaco;
    if (!monaco) return [];
    return monaco.editor.getModelMarkers({}).map((m: any) => m.message);
  });
}

export async function getSliderMax(page: Page): Promise<number> {
  const max = await page.locator('.shadow-2xl.z-50 input[type="range"]').getAttribute('max');
  return parseInt(max || '100', 10);
}

export async function setRangeValue(page: Page, selector: string, value: string) {
  const targetSelector = selector || '.shadow-2xl.z-50 input[type="range"]';
  await page.evaluate(({ sel, val }) => {
    const input = document.querySelector(sel) as HTMLInputElement;
    if (input) {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      nativeSetter?.call(input, val);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, { sel: targetSelector, val: value });
}
