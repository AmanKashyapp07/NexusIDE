import { test, expect, type Page, type APIRequestContext, type Browser } from '@playwright/test';
import {
  APP_URL, API_URL, WS_URL, extractWorkspaceId,
  login, loginUser, inviteUser, waitForBootComplete, focusEditor,
  createTestWorkspace, deleteTestWorkspace, createTestFile, createFile, typeTextInMonaco,
  getEditorValue, waitForEditorModel, waitForEditorSync, setMonacoValue, setEditorValue, waitForSocketConnect,
  setupUserAndWorkspace, createFileAndOpen
} from './test-utils';

test.describe('Collab - Core Engine', () => {
  test('1. Live typing & role sync', async ({ page, context, request }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();
    await loginUser(alicePage, request, `Alice_${timestamp}`);
    await loginUser(bobPage, request, `Bob_${timestamp}`);
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `E2E_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const match = alicePage.url().match(/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/);
    const workspaceId = match ? match[1] : alicePage.url().split('/ide/').pop()!.split('/')[0];
    await waitForBootComplete(alicePage);
    await createFile(alicePage, 'index.js');
    await waitForEditorModel(alicePage, 'index.js');
    await inviteUser(alicePage, `Bob_${timestamp}`, 'editor');
    await bobPage.goto(`${APP_URL}/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('index.js').click();
    await waitForEditorModel(bobPage, 'index.js');
    await focusEditor(alicePage);
    await alicePage.keyboard.type('// Alice writes first\n', { delay: 20 });
    await expect(async () => {
      const bobText = await getEditorValue(bobPage);
      expect(bobText).toContain('Alice writes first');
    }).toPass({ timeout: 25000, intervals: [1000] });
  });

  test('2. synchronizes file tree live and handles active file deletion gracefully', async ({ page, context, request }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();
    await loginUser(alicePage, request, `Alice_Sync_${timestamp}`);
    await loginUser(bobPage, request, `Bob_Sync_${timestamp}`);
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Sync_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const workspaceId = extractWorkspaceId(alicePage.url());
    await waitForBootComplete(alicePage);
    await inviteUser(alicePage, `Bob_Sync_${timestamp}`, 'editor');
    await bobPage.goto(`${APP_URL}/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await createFile(alicePage, 'shared-data.json');
    const bobFileSelector = bobPage.locator('.ide-scrollbar').getByText('shared-data.json');
    await expect(bobFileSelector).toBeVisible({ timeout: 20000 });
    await bobFileSelector.click();
    await waitForEditorModel(bobPage, 'shared-data.json');
    const aliceFileRow = alicePage.locator('.ide-scrollbar .group', { hasText: 'shared-data.json' });
    await aliceFileRow.hover();
    await aliceFileRow.locator('button[title="Delete File"]').click();
    const confirmButton = alicePage.locator('button:has-text("Confirm"), button:has-text("Delete")');
    if (await confirmButton.isVisible()) await confirmButton.click();
    await expect(bobFileSelector).toBeHidden({ timeout: 15000 });
    await expect(bobPage.locator('text=Select a file from the explorer to begin.')).toBeVisible();
  });

  test('3. tracks user presence and cleans up cursors when users leave', async ({ page, context, request }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();
    await loginUser(alicePage, request, `Alice_Pres_${timestamp}`);
    await loginUser(bobPage, request, `Bob_Pres_${timestamp}`);
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Pres_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const workspaceId = extractWorkspaceId(alicePage.url());
    await waitForBootComplete(alicePage);
    await inviteUser(alicePage, `Bob_Pres_${timestamp}`, 'editor');
    await createFile(alicePage, 'presence.js');
    await waitForEditorModel(alicePage, 'presence.js');
    await bobPage.goto(`${APP_URL}/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('presence.js').click();
    await waitForEditorModel(bobPage, 'presence.js');
    const bobAvatar = alicePage.locator(`header [title*="Bob_Pres_${timestamp}"]`);
    await expect(bobAvatar).toBeVisible({ timeout: 20000 });
    await focusEditor(bobPage);
    await bobPage.waitForTimeout(1000);
    await bobPage.keyboard.type('// Bob is here');
    const remoteCursor = alicePage.locator('[class*="yRemoteSelectionHead-"]').first();
    await expect(remoteCursor).toBeVisible({ timeout: 20000 });
    await bobPage.close();
    await expect(bobAvatar).toBeHidden({ timeout: 20000 });
    await expect(remoteCursor).toBeHidden({ timeout: 20000 });
  });

  test('5. resolves simultaneous conflicting edits without data corruption', async ({ page, context, request }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();
    await loginUser(alicePage, request, `Alice_Simul_${timestamp}`);
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Simul_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const workspaceId = extractWorkspaceId(alicePage.url());
    await waitForBootComplete(alicePage);
    await createFile(alicePage, 'conflict.js');
    await waitForEditorModel(alicePage, 'conflict.js');
    await loginUser(bobPage, request, `Bob_Simul_${timestamp}`);
    await inviteUser(alicePage, `Bob_Simul_${timestamp}`, 'editor');
    await bobPage.goto(`${APP_URL}/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('conflict.js').click();
    await waitForEditorModel(bobPage, 'conflict.js');
    await focusEditor(alicePage);
    await alicePage.keyboard.type('ALICE_WAS_HERE\n');
    await focusEditor(bobPage);
    await bobPage.keyboard.type('BOB_WAS_HERE\n');
    await expect(async () => {
      const aContent = await getEditorValue(alicePage);
      const bContent = await getEditorValue(bobPage);
      expect(aContent).toContain('ALICE_WAS_HERE');
      expect(aContent).toContain('BOB_WAS_HERE');
      expect(aContent).toEqual(bContent);
    }).toPass({ timeout: 25000, intervals: [1000] });
  });

  test('6. syncs file renames live while other users are actively editing without breaking the socket', async ({ page, context, request }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();
    await loginUser(alicePage, request, `Alice_Rename_${timestamp}`);
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Rename_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const workspaceId = extractWorkspaceId(alicePage.url());
    await waitForBootComplete(alicePage);
    await createFile(alicePage, 'old-name.js');
    await waitForEditorModel(alicePage, 'old-name.js');
    await loginUser(bobPage, request, `Bob_Rename_${timestamp}`);
    await inviteUser(alicePage, `Bob_Rename_${timestamp}`, 'editor');
    await bobPage.goto(`${APP_URL}/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('old-name.js').click();
    await waitForEditorModel(bobPage, 'old-name.js');
    await focusEditor(bobPage);
    await bobPage.keyboard.type('// before rename\n');
    await expect(async () => {
      expect(await getEditorValue(alicePage)).toContain('before rename');
    }).toPass({ timeout: 20000, intervals: [1000] });
    const aliceTerminalTextarea = alicePage.locator('.xterm-helper-textarea');
    await expect(alicePage.locator('.xterm')).toContainText('sandbox:~#', { timeout: 30000 });
    await aliceTerminalTextarea.focus();
    await alicePage.keyboard.type('mv old-name.js new-name.js', { delay: 10 });
    await alicePage.keyboard.press('Enter');
    await expect(bobPage.locator('.ide-scrollbar').getByText('new-name.js')).toBeVisible({ timeout: 20000 });
    await bobPage.waitForTimeout(2000);
    await alicePage.locator('.ide-scrollbar').getByText('new-name.js').click();
    await waitForEditorModel(alicePage, 'new-name.js');
    await bobPage.locator('.ide-scrollbar').getByText('new-name.js').click();
    await waitForEditorModel(bobPage, 'new-name.js');
    await bobPage.waitForTimeout(1500);
    await focusEditor(bobPage);
    await bobPage.keyboard.type('// AFTER rename');
    await expect(async () => {
      expect(await getEditorValue(alicePage)).toContain('AFTER rename');
    }).toPass({ timeout: 20000, intervals: [1000] });
  });

  test('7. late-joining user sees exact content once — no duplication or data loss', async ({ page, context, request }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();
    const SENTINEL = `UNIQUE_SENTINEL_${timestamp}`;
    await loginUser(alicePage, request, `Alice_Late_${timestamp}`);
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Late_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const workspaceId = extractWorkspaceId(alicePage.url());
    await waitForBootComplete(alicePage);
    await createFile(alicePage, 'late.js');
    await waitForEditorModel(alicePage, 'late.js');
    await focusEditor(alicePage);
    await alicePage.keyboard.type(`console.log("${SENTINEL}");`, { delay: 10 });
    await alicePage.waitForTimeout(5000);
    await loginUser(bobPage, request, `Bob_Late_${timestamp}`);
    await inviteUser(alicePage, `Bob_Late_${timestamp}`, 'editor');
    await bobPage.goto(`${APP_URL}/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('late.js').click();
    await waitForEditorModel(bobPage, 'late.js');
    await expect(async () => {
      const bobEditorText = await getEditorValue(bobPage);
      expect(bobEditorText).toContain(SENTINEL);
      expect(bobEditorText.split(SENTINEL).length - 1).toBe(1);
    }).toPass({ timeout: 25000, intervals: [1000] });
  });

  test('8. reconnecting user sees correct content once without duplication', async ({ page, context, request }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();
    const SENTINEL = `RECONNECT_${timestamp}`;
    await loginUser(alicePage, request, `Alice_Reconn_${timestamp}`);
    await loginUser(bobPage, request, `Bob_Reconn_${timestamp}`);
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Reconn_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const workspaceId = extractWorkspaceId(alicePage.url());
    await waitForBootComplete(alicePage);
    await inviteUser(alicePage, `Bob_Reconn_${timestamp}`, 'editor');
    await createFile(alicePage, 'reconnect.js');
    await waitForEditorModel(alicePage, 'reconnect.js');
    await focusEditor(alicePage);
    await alicePage.keyboard.type(`const x = "${SENTINEL}";`);
    await alicePage.waitForTimeout(5000);
    await bobPage.goto(`${APP_URL}/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('reconnect.js').click();
    await waitForEditorModel(bobPage, 'reconnect.js');
    await bobPage.goto(`${APP_URL}/dashboard`);
    await bobPage.waitForURL(/\/dashboard/);
    await bobPage.waitForTimeout(2000);
    await bobPage.goto(`${APP_URL}/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('reconnect.js').click();
    await waitForEditorModel(bobPage, 'reconnect.js');
    await expect(async () => {
      const reconnectText = await getEditorValue(bobPage);
      expect(reconnectText).toContain(SENTINEL);
      expect(reconnectText.split(SENTINEL).length - 1).toBe(1);
    }).toPass({ timeout: 25000, intervals: [1000] });
  });

  test('9. clicking a member avatar jumps to their cursor position in the editor', async ({ page, context, request }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();
    await loginUser(alicePage, request, `Alice_Jump_${timestamp}`);
    await loginUser(bobPage, request, `Bob_Jump_${timestamp}`);
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Jump_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const workspaceId = extractWorkspaceId(alicePage.url());
    await waitForBootComplete(alicePage);
    await createFile(alicePage, 'jump.js');
    await waitForEditorModel(alicePage, 'jump.js');
    await inviteUser(alicePage, `Bob_Jump_${timestamp}`, 'editor');
    await focusEditor(alicePage);
    await alicePage.keyboard.type('// line 1\n// line 2\n// line 3\n// line 4\n// line 5\n', { delay: 10 });
    await bobPage.goto(`${APP_URL}/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('jump.js').click();
    await waitForEditorModel(bobPage, 'jump.js');
    await expect(async () => {
      const text = await getEditorValue(bobPage);
      expect(text).toContain('line 5');
    }).toPass({ timeout: 25000, intervals: [1000] });
    await bobPage.waitForTimeout(1000);
    await bobPage.evaluate(() => {
      const editors = (window as any).monaco?.editor?.getEditors();
      if (editors && editors[0]) editors[0].setPosition({ lineNumber: 1, column: 1 });
    });
    const bobCursorBefore = await bobPage.evaluate(() => {
      const editors = (window as any).monaco?.editor?.getEditors();
      return editors && editors[0] ? editors[0].getPosition() : null;
    });
    expect(bobCursorBefore?.lineNumber).toBeLessThanOrEqual(1);
    const aliceAvatarTitle = `Jump to Alice_Jump_${timestamp}'s cursor`;
    const aliceAvatar = bobPage.locator(`[title="${aliceAvatarTitle}"]`);
    await expect(aliceAvatar).toBeVisible({ timeout: 15000 });
    await aliceAvatar.click();
    await expect(async () => {
      const bobCursorAfter = await bobPage.evaluate(() => {
        const editors = (window as any).monaco?.editor?.getEditors();
        return editors && editors[0] ? editors[0].getPosition() : null;
      });
      expect(bobCursorAfter?.lineNumber).toBeGreaterThanOrEqual(5);
    }).toPass({ timeout: 10000, intervals: [500] });
  });
});

test.describe('Collab - Advanced Sync', () => {
  test('9. rapid file switches do not leak content between files or duplicate on rejoin', async ({ page, context, request }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();
    const FILE_A_CONTENT = `FILE_A_${timestamp}`;
    const FILE_B_CONTENT = `FILE_B_${timestamp}`;
    try {
      await loginUser(alicePage, request, `Alice_Switch_${timestamp}`);
      await loginUser(bobPage, request, `Bob_Switch_${timestamp}`);
      await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Switch_WS_${timestamp}`);
      await alicePage.click('button:has-text("Create Now")');
      await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
      const workspaceId = extractWorkspaceId(alicePage.url());
      await waitForBootComplete(alicePage);
      await inviteUser(alicePage, `Bob_Switch_${timestamp}`, 'editor');
      await createFile(alicePage, 'file-a.js');
      await waitForEditorModel(alicePage, 'file-a.js');
      await focusEditor(alicePage);
      await alicePage.keyboard.type(`console.log("${FILE_A_CONTENT}");`);
      await alicePage.waitForTimeout(4000);
      await createFile(alicePage, 'file-b.js');
      await waitForEditorModel(alicePage, 'file-b.js');
      await focusEditor(alicePage);
      await alicePage.keyboard.type(`console.log("${FILE_B_CONTENT}");`);
      await alicePage.waitForTimeout(4000);
      await bobPage.goto(`${APP_URL}/${workspaceId}`);
      await waitForBootComplete(bobPage);
      for (let i = 0; i < 2; i++) {
        await bobPage.locator('.ide-scrollbar').getByText('file-a.js').click();
        await waitForEditorModel(bobPage, 'file-a.js');
        await bobPage.locator('.ide-scrollbar').getByText('file-b.js').click();
        await waitForEditorModel(bobPage, 'file-b.js');
      }
      await bobPage.locator('.ide-scrollbar').getByText('file-b.js').click();
      await waitForEditorModel(bobPage, 'file-b.js');
      await expect(async () => {
        const bobFileBText = await getEditorValue(bobPage);
        expect(bobFileBText).toContain(FILE_B_CONTENT);
        expect(bobFileBText).not.toContain(FILE_A_CONTENT);
      }).toPass({ timeout: 20000, intervals: [1000] });
      await bobPage.locator('.ide-scrollbar').getByText('file-a.js').click();
      await waitForEditorModel(bobPage, 'file-a.js');
      await expect(async () => {
        const modelText = await getEditorValue(bobPage);
        expect(modelText).toContain(FILE_A_CONTENT);
        expect(modelText).not.toContain(FILE_B_CONTENT);
      }).toPass({ timeout: 20000, intervals: [1000] });
    } finally {
      await bobContext.close();
    }
  });

  test('10. content persists through full server doc eviction and reloads correctly for new users', async ({ page, context, request }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();
    const PERSIST_SENTINEL = `PERSISTED_${timestamp}`;
    try {
      await loginUser(alicePage, request, `Alice_Persist_${timestamp}`);
      await loginUser(bobPage, request, `Bob_Persist_${timestamp}`);
      await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Persist_WS_${timestamp}`);
      await alicePage.click('button:has-text("Create Now")');
      await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
      const workspaceId = extractWorkspaceId(alicePage.url());
      await waitForBootComplete(alicePage);
      await inviteUser(alicePage, `Bob_Persist_${timestamp}`, 'editor');
      await createFile(alicePage, 'persist-test.js');
      await waitForEditorModel(alicePage, 'persist-test.js');
      await focusEditor(alicePage);
      await alicePage.keyboard.type(`const sentinel = "${PERSIST_SENTINEL}";\n`);
      await alicePage.waitForTimeout(4000);
      await alicePage.goto(`${APP_URL}/dashboard`);
      await alicePage.waitForURL(/\/dashboard/);
      await alicePage.waitForTimeout(5000);
      await bobPage.goto(`${APP_URL}/${workspaceId}`);
      await waitForBootComplete(bobPage);
      await bobPage.locator('.ide-scrollbar').getByText('persist-test.js').click();
      await waitForEditorModel(bobPage, 'persist-test.js');
      await expect(async () => {
        const bobText = await getEditorValue(bobPage);
        expect(bobText).toContain(PERSIST_SENTINEL);
        expect(bobText.split(PERSIST_SENTINEL).length - 1).toBe(1);
      }).toPass({ timeout: 25000, intervals: [1000] });
    } finally {
      await bobContext.close();
    }
  });

  test('11. maintains isolated undo/redo stacks per user without affecting peer edits', async ({ page, context, request }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();
    try {
      await loginUser(alicePage, request, `Alice_Undo_${timestamp}`);
      await loginUser(bobPage, request, `Bob_Undo_${timestamp}`);
      await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Undo_WS_${timestamp}`);
      await alicePage.click('button:has-text("Create Now")');
      await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
      const workspaceId = extractWorkspaceId(alicePage.url());
      await waitForBootComplete(alicePage);
      await inviteUser(alicePage, `Bob_Undo_${timestamp}`, 'editor');
      await createFile(alicePage, 'undo-test.js');
      await waitForEditorModel(alicePage, 'undo-test.js');
      await bobPage.goto(`${APP_URL}/${workspaceId}`);
      await waitForBootComplete(bobPage);
      await bobPage.locator('.ide-scrollbar').getByText('undo-test.js').click();
      await waitForEditorModel(bobPage, 'undo-test.js');
      await Promise.all([
        waitForSocketConnect(alicePage),
        waitForSocketConnect(bobPage),
      ]);
      await focusEditor(alicePage);
      await alicePage.keyboard.type('// Alice Edit 1\n');
      await alicePage.waitForTimeout(500);
      await focusEditor(bobPage);
      await bobPage.keyboard.type('// Bob Edit 1\n');
      await bobPage.waitForTimeout(500);
      await focusEditor(alicePage);
      await alicePage.keyboard.type('X');
      await expect(async () => {
        const bobText = await getEditorValue(bobPage);
        expect(bobText).toContain('Alice Edit 1');
        expect(bobText).toContain('Bob Edit 1');
        expect(bobText).toContain('X');
      }).toPass({ timeout: 20000, intervals: [1000] });
      await alicePage.waitForTimeout(2000);
      await alicePage.evaluate(() => {
        const ed = (window as any).monaco.editor.getEditors()[0];
        if (ed) { ed.focus(); ed.trigger('keyboard', 'undo', null); }
      });
      await expect(async () => {
        const aliceText = await getEditorValue(alicePage);
        expect(aliceText).toContain('Alice Edit 1');
        expect(aliceText).toContain('Bob Edit 1');
        expect(aliceText).not.toContain('X');
      }).toPass({ timeout: 20000, intervals: [1000] });
    } finally {
      await bobContext.close();
    }
  });

  test('12. synchronizes correctly after a network partition without data loss', async ({ page, context, request }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();
    try {
      await loginUser(alicePage, request, `Alice_Offline_${timestamp}`);
      await loginUser(bobPage, request, `Bob_Offline_${timestamp}`);
      await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Offline_WS_${timestamp}`);
      await alicePage.click('button:has-text("Create Now")');
      await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
      const workspaceId = extractWorkspaceId(alicePage.url());
      await waitForBootComplete(alicePage);
      await waitForSocketConnect(alicePage);
      await inviteUser(alicePage, `Bob_Offline_${timestamp}`, 'editor');
      await createFile(alicePage, 'partition.js');
      await waitForEditorModel(alicePage, 'partition.js');
      await bobPage.goto(`${APP_URL}/${workspaceId}`);
      await waitForBootComplete(bobPage);
      await waitForSocketConnect(bobPage);
      await bobPage.locator('.ide-scrollbar').getByText('partition.js').click();
      await waitForEditorModel(bobPage, 'partition.js');
      await focusEditor(alicePage);
      await alicePage.keyboard.type('// Baseline\n');
      await expect(async () => {
        expect(await getEditorValue(bobPage)).toContain('Baseline');
      }).toPass({ timeout: 20000, intervals: [1000] });
      await bobContext.setOffline(true);
      await bobPage.waitForTimeout(1500);
      await focusEditor(bobPage);
      await bobPage.keyboard.type('// Bob offline edit\n');
      await focusEditor(alicePage);
      await alicePage.keyboard.type('// Alice online edit\n');
      await bobContext.setOffline(false);
      await expect(async () => {
        const aliceFinal = await getEditorValue(alicePage);
        const bobFinal = await getEditorValue(bobPage);
        expect(aliceFinal).toContain('Bob offline edit');
        expect(aliceFinal).toContain('Alice online edit');
        expect(aliceFinal).toEqual(bobFinal);
      }).toPass({ timeout: 25000, intervals: [1000] });
    } finally {
      await bobContext.close();
    }
  });

  test('13. late-joining user receives the fully updated file tree and file contents', async ({ page, context, request }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();
    const CONTENT_1 = `ALPHA_DATA_${timestamp}`;
    const CONTENT_2 = `BETA_DATA_${timestamp}`;
    try {
      await loginUser(alicePage, request, `Alice_LateTree_${timestamp}`);
      await loginUser(bobPage, request, `Bob_LateTree_${timestamp}`);
      await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `LateTree_WS_${timestamp}`);
      await alicePage.click('button:has-text("Create Now")');
      await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
      const workspaceId = extractWorkspaceId(alicePage.url());
      await waitForBootComplete(alicePage);
      await createFile(alicePage, 'file-alpha.js');
      await waitForEditorModel(alicePage, 'file-alpha.js');
      await focusEditor(alicePage);
      await alicePage.keyboard.type(`const a = "${CONTENT_1}";`);
      await createFile(alicePage, 'file-beta.js');
      await waitForEditorModel(alicePage, 'file-beta.js');
      await focusEditor(alicePage);
      await alicePage.keyboard.type(`const b = "${CONTENT_2}";`);
      await alicePage.waitForTimeout(5000);
      await inviteUser(alicePage, `Bob_LateTree_${timestamp}`, 'editor');
      await bobPage.goto(`${APP_URL}/${workspaceId}`);
      await waitForBootComplete(bobPage);
      const bobFileAlpha = bobPage.locator('.ide-scrollbar').getByText('file-alpha.js');
      const bobFileBeta = bobPage.locator('.ide-scrollbar').getByText('file-beta.js');
      await expect(bobFileAlpha).toBeVisible({ timeout: 20000 });
      await expect(bobFileBeta).toBeVisible({ timeout: 20000 });
      await bobFileAlpha.click();
      await waitForEditorModel(bobPage, 'file-alpha.js');
      await expect(async () => {
        const val = await getEditorValue(bobPage);
        expect(val).toContain(CONTENT_1);
      }).toPass({ timeout: 25000, intervals: [1000] });
      await bobFileBeta.click();
      await waitForEditorModel(bobPage, 'file-beta.js');
      await expect(async () => {
        const val = await getEditorValue(bobPage);
        expect(val).toContain(CONTENT_2);
      }).toPass({ timeout: 25000, intervals: [1000] });
    } finally {
      await bobContext.close();
    }
  });

  test('14. newly created files sync live to peers and initialize collaborative editor without freezing', async ({ page, context, request }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();
    try {
      await loginUser(alicePage, request, `Alice_LiveFile_${timestamp}`);
      await loginUser(bobPage, request, `Bob_LiveFile_${timestamp}`);
      await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `LiveFile_WS_${timestamp}`);
      await alicePage.click('button:has-text("Create Now")');
      await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
      const workspaceId = extractWorkspaceId(alicePage.url());
      await waitForBootComplete(alicePage);
      await inviteUser(alicePage, `Bob_LiveFile_${timestamp}`, 'editor');
      await bobPage.goto(`${APP_URL}/${workspaceId}`);
      await waitForBootComplete(bobPage);
      await waitForSocketConnect(bobPage);
      const LIVE_FILENAME = `dynamic-${timestamp}.js`;
      await createFile(alicePage, LIVE_FILENAME);
      await waitForEditorModel(alicePage, LIVE_FILENAME);
      const bobFileNode = bobPage.locator('.ide-scrollbar').getByText(LIVE_FILENAME);
      await expect(bobFileNode).toBeVisible({ timeout: 20000 });
      await bobFileNode.click();
      await waitForEditorModel(bobPage, LIVE_FILENAME);
      await setEditorValue(alicePage, '// Alice testing live file\n');
      await expect(async () => {
        const val = await getEditorValue(bobPage);
        expect(val).toContain('Alice testing live file');
      }).toPass({ timeout: 25000, intervals: [1000] });
      await setEditorValue(bobPage, '// Alice testing live file\n// Bob responding on live file\n');
      await expect(async () => {
        const val = await getEditorValue(alicePage);
        expect(val).toContain('Bob responding on live file');
      }).toPass({ timeout: 25000, intervals: [1000] });
    } finally {
      await bobContext.close();
    }
  });

  test('15. does not duplicate content on slow network connections', async ({ page, context, request }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();
    const CONTENT = `LATENCY_TEST_${timestamp}`;
    try {
      await loginUser(alicePage, request, `Alice_Slow_${timestamp}`);
      await loginUser(bobPage, request, `Bob_Slow_${timestamp}`);
      await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Slow_WS_${timestamp}`);
      await alicePage.click('button:has-text("Create Now")');
      await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
      const workspaceId = extractWorkspaceId(alicePage.url());
      await waitForBootComplete(alicePage);
      await inviteUser(alicePage, `Bob_Slow_${timestamp}`, 'editor');
      await createFile(alicePage, 'latency.js');
      await waitForEditorModel(alicePage, 'latency.js');
      await focusEditor(alicePage);
      await alicePage.keyboard.type(`const data = "${CONTENT}";`);
      await alicePage.waitForTimeout(4000);
      await bobPage.goto(`${APP_URL}/${workspaceId}`);
      await waitForBootComplete(bobPage);
      const bobCDP = await bobPage.context().newCDPSession(bobPage);
      await bobCDP.send('Network.enable');
      await bobCDP.send('Network.emulateNetworkConditions', {
        offline: false, downloadThroughput: 50 * 1024 / 8, uploadThroughput: 50 * 1024 / 8, latency: 3500,
      });
      await bobPage.locator('.ide-scrollbar').getByText('latency.js').click();
      await waitForEditorModel(bobPage, 'latency.js');
      await bobCDP.send('Network.emulateNetworkConditions', {
        offline: false, downloadThroughput: -1, uploadThroughput: -1, latency: 0,
      });
      await expect(async () => {
        const bobText = await getEditorValue(bobPage);
        expect(bobText).toContain(CONTENT);
        expect(bobText.split(CONTENT).length - 1).toBe(1);
      }).toPass({ timeout: 30000, intervals: [1000] });
    } finally {
      await bobContext.close();
    }
  });

  test('16. maintains editor stability and sync during rapid intermittent network disconnects', async ({ page, context, request }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    const bobPage = await bobContext.newPage();
    const timestamp = Date.now();
    try {
      await loginUser(alicePage, request, `Alice_Flaky_${timestamp}`);
      await loginUser(bobPage, request, `Bob_Flaky_${timestamp}`);
      await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Flaky_WS_${timestamp}`);
      await alicePage.click('button:has-text("Create Now")');
      await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
      const workspaceId = extractWorkspaceId(alicePage.url());
      await waitForBootComplete(alicePage);
      await inviteUser(alicePage, `Bob_Flaky_${timestamp}`, 'editor');
      await createFile(alicePage, 'flaky.js');
      await waitForEditorModel(alicePage, 'flaky.js');
      await bobPage.goto(`${APP_URL}/${workspaceId}`);
      await waitForBootComplete(bobPage);
      await bobPage.locator('.ide-scrollbar').getByText('flaky.js').click();
      await waitForEditorModel(bobPage, 'flaky.js');
      await waitForSocketConnect(alicePage);
      await waitForSocketConnect(bobPage);
      await focusEditor(alicePage);
      await alicePage.keyboard.type('// Stable line\n');
      await expect(async () => {
        expect(await getEditorValue(bobPage)).toContain('Stable line');
      }).toPass({ timeout: 20000, intervals: [1000] });
      for (let i = 0; i < 3; i++) {
        await bobContext.setOffline(true);
        await bobPage.waitForTimeout(800);
        await focusEditor(bobPage);
        await bobPage.keyboard.type(`// Offline edit ${i}\n`);
        await bobContext.setOffline(false);
        await bobPage.waitForTimeout(4000);
      }
      await bobPage.waitForTimeout(4000);
      await expect(async () => {
        const aliceText = await getEditorValue(alicePage);
        const bobText = await getEditorValue(bobPage);
        expect(aliceText).toContain('Offline edit 0');
        expect(aliceText).toContain('Offline edit 1');
        expect(aliceText).toContain('Offline edit 2');
        expect(aliceText).toEqual(bobText);
      }).toPass({ timeout: 25000, intervals: [1000] });
    } finally {
      await bobContext.close();
    }
  });
});

test.describe('Collab - Git Merge Resolver', () => {
  test.setTimeout(120000);
  const timestamp = Date.now();
  let token: string;
  let wsId: string;
  let fileId: string;

  test.beforeEach(async ({ page, request }) => {
    token = await loginUser(page, request, `conflict_admin_${timestamp}`);
    const wsRes = await request.post(`${API_URL}/workspace`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'Brutal Merge Conflict Workspace' }
    });
    const ws = await wsRes.json();
    wsId = ws.id;
    const fileRes = await request.post(`${API_URL}/workspace/${wsId}/files`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'brutal_conflict.js', type: 'file' }
    });
    const file = await fileRes.json();
    fileId = file.id;
  });

  test.afterEach(async ({ request }) => {
    await request.delete(`${API_URL}/workspace/${wsId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  });

  test('Should handle multiple, empty, and CRLF-formatted conflicts gracefully', async ({ request }) => {
    const messyConflictContent =
      `function init() { \r\n` +
      `<<<<<<< HEAD\n` +
      `=======\r\n` +
      `  console.log("Only theirs exists");\n` +
      `>>>>>>> branch-a\n` +
      `  let active = true;\n` +
      `<<<<<<< HEAD\n` +
      `  runProcess(active);\n` +
      `=======\n` +
      `  execute(active);\n` +
      `>>>>>>> branch-b\n` +
      `}`;
    await request.put(`${API_URL}/workspace/${wsId}/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { content: messyConflictContent }
    });
    const parseRes = await request.get(`${API_URL}/workspace/${wsId}/files/${fileId}/conflicts`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(parseRes.ok()).toBeTruthy();
    const parseData = await parseRes.json();
    expect(parseData.hasConflicts).toBe(true);
    expect(parseData.conflicts.filter(c => c.type === 'conflict').length).toBe(2);
    expect(parseData.conflicts[1].ours.trim()).toBe('');
    expect(parseData.conflicts[1].theirs).toContain('Only theirs exists');
  });

  test('Should fail securely on malformed conflict markers', async ({ request }) => {
    const malformedContent = `<<<<<<< HEAD\nconsole.log("a");\n=======\nconsole.log("b");`;
    await request.put(`${API_URL}/workspace/${wsId}/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { content: malformedContent }
    });
    const parseRes = await request.get(`${API_URL}/workspace/${wsId}/files/${fileId}/conflicts`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect([200, 400, 422]).toContain(parseRes.status());
    if (parseRes.ok()) {
      const parseData = await parseRes.json();
      expect(parseData.hasConflicts).toBe(false); // Should not parse as a valid conflict
    }
  });

  test('Collaborative Real-time Resolution (Dual-Browser Sync)', async ({ browser, request }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const tokenA = await loginUser(pageA, request, `conflict_user_a_${timestamp}`);
    await loginUser(pageB, request, `conflict_user_b_${timestamp}`);
    await request.post(`${API_URL}/workspace/${wsId}/collaborators`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { usernameOrEmail: `conflict_user_a_${timestamp}`, role: 'editor' }
    });
    await request.post(`${API_URL}/workspace/${wsId}/collaborators`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { usernameOrEmail: `conflict_user_b_${timestamp}`, role: 'editor' }
    });
    await Promise.all([
      pageA.goto(`${APP_URL}/ide/${wsId}/${fileId}`),
      pageB.goto(`${APP_URL}/ide/${wsId}/${fileId}`)
    ]);
    await Promise.all([
      waitForBootComplete(pageA),
      waitForBootComplete(pageB)
    ]);
    const waitForEditor = async (page: Page) => {
      await page.waitForFunction(() => {
        return (window as any).monaco?.editor?.getEditors()?.length > 0;
      }, { timeout: 90000 });
    };
    await Promise.all([waitForEditor(pageA), waitForEditor(pageB)]);
    await Promise.all([
      waitForSocketConnect(pageA),
      waitForSocketConnect(pageB)
    ]);
    const conflictContent = `<<<<<<< HEAD\nUser A edits\n=======\nUser B edits\n>>>>>>> main`;
    await pageA.evaluate((content) => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      const model = editor.getModel();
      const fullRange = model.getFullModelRange();
      editor.executeEdits('test-inject', [{
        range: fullRange,
        text: content,
        forceMoveMarkers: true
      }]);
      editor.pushUndoStop();
    }, conflictContent);
    await pageB.waitForFunction((expected) => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      const normalize = (s: string) => s.replace(/\r\n/g, '\n');
      return normalize(editor.getValue()) === normalize(expected);
    }, conflictContent, { timeout: 15000 });
    const resolvedContent = `Merged edits`;
    const resolveRes = await request.post(`${API_URL}/workspace/${wsId}/files/${fileId}/conflicts/resolve`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { resolvedContent }
    });
    expect(resolveRes.ok()).toBeTruthy();
    await pageB.waitForFunction((expected) => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      const normalize = (s: string) => s.replace(/\r\n/g, '\n');
      return normalize(editor.getValue()) === normalize(expected);
    }, resolvedContent, { timeout: 10000 });
    const finalContentB = await pageB.evaluate(() => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      return editor.getValue();
    });
    expect(finalContentB).toBe(resolvedContent);
    await contextA.close();
    await contextB.close();
  });

  test('Race Condition: User types in Monaco while conflict is being resolved via API', async ({ page, request }) => {
    const conflictContent = `<<<<<<< HEAD\nvar x = 1;\n=======\nvar x = 2;\n>>>>>>> main`;
    await page.goto(`${APP_URL}/ide/${wsId}/${fileId}`);
    await waitForBootComplete(page);
    await waitForSocketConnect(page);
    await page.waitForFunction(() => {
      return (window as any).monaco?.editor?.getEditors()?.length > 0;
    }, { timeout: 90000 });
    await page.evaluate((content) => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      const model = editor.getModel();
      const fullRange = model.getFullModelRange();
      editor.executeEdits('test-inject', [{
        range: fullRange,
        text: content,
        forceMoveMarkers: true
      }]);
    }, conflictContent);
    await expect.poll(async () => {
      const res = await request.get(`${API_URL}/workspace/${wsId}/files/${fileId}/content`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok()) return '';
      const body = await res.json();
      return body.content || '';
    }, {
      intervals: [500, 1000, 2000],
      timeout: 15000
    }).toContain('<<<<<<< HEAD');
    const resolvedContent = `var x = 3; // resolved`;
    const resolvePromise = request.post(`${API_URL}/workspace/${wsId}/files/${fileId}/conflicts/resolve`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { resolvedContent }
    });
    await page.evaluate(() => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      const position = editor.getPosition();
      editor.executeEdits("test", [{
        range: new (window as any).monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
        text: "\n// User typing...",
        forceMoveMarkers: true
      }]);
    });
    const resolveRes = await resolvePromise;
    expect(resolveRes.ok()).toBeTruthy();
    await page.waitForTimeout(2000);
    const finalContent = await page.evaluate(() => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      return editor.getValue();
    });
    expect(finalContent).not.toContain('<<<<<<< HEAD');
    expect(finalContent).not.toContain('=======');
  });

  test('Brutal Scenario 1: Nested and False Positive Conflict Markers', async ({ request }) => {
    const nestedContent =
      `const codeString = "System marker: <<<<<<< HEAD";\n` +
      `<<<<<<< HEAD\n` +
      `const a = 1;\n` +
      `<<<<<<< HEAD\n` +
      `nested_a();\n` +
      `=======\n` +
      `nested_b();\n` +
      `>>>>>>> inner-branch\n` +
      `=======\n` +
      `const a = 2;\n` +
      `>>>>>>> outer-branch\n`;
    await request.put(`${API_URL}/workspace/${wsId}/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { content: nestedContent }
    });
    const parseRes = await request.get(`${API_URL}/workspace/${wsId}/files/${fileId}/conflicts`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(parseRes.ok()).toBeTruthy();
    const parseData = await parseRes.json();
    expect(parseData).toHaveProperty('hasConflicts');
  });

  test('Brutal Scenario 2: Thundering Herd Concurrent Resolution Requests', async ({ request }) => {
    const conflictContent = `<<<<<<< HEAD\nVersion Alpha\n=======\nVersion Beta\n>>>>>>> branch`;
    await request.put(`${API_URL}/workspace/${wsId}/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { content: conflictContent }
    });
    const resolveRequests = Array.from({ length: 5 }).map((_, index) =>
      request.post(`${API_URL}/workspace/${wsId}/files/${fileId}/conflicts/resolve`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { resolvedContent: `Resolved by Request #${index}` }
      })
    );
    const responses = await Promise.all(resolveRequests);
    responses.forEach(res => expect(res.ok()).toBeTruthy());
    const getRes = await request.get(`${API_URL}/workspace/${wsId}/files/${fileId}/content`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(getRes.ok()).toBeTruthy();
    const body = await getRes.json();
    expect(body.content).toMatch(/Resolved by Request #[0-4]/);
  });

  test('Brutal Scenario 3: Large File Payload Stress Test (5,000+ Lines)', async ({ request }) => {
    let largeContent = '';
    for (let i = 0; i < 500; i++) {
      if (i % 50 === 0) {
        largeContent += `<<<<<<< HEAD\n// Ours block ${i}\n` + 'console.log("ours");\n'.repeat(10) +
                        `=======\n// Theirs block ${i}\n` + 'console.log("theirs");\n'.repeat(10) +
                        `>>>>>>> branch-${i}\n`;
      } else {
        largeContent += `function fn_${i}() { return ${i}; }\n`;
      }
    }
    await request.put(`${API_URL}/workspace/${wsId}/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { content: largeContent }
    });
    const startTime = Date.now();
    const parseRes = await request.get(`${API_URL}/workspace/${wsId}/files/${fileId}/conflicts`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const parseTime = Date.now() - startTime;
    expect(parseRes.ok()).toBeTruthy();
    const parseData = await parseRes.json();
    expect(parseData.hasConflicts).toBe(true);
    expect(parseData.conflicts.filter((c: any) => c.type === 'conflict').length).toBe(10);
    expect(parseTime).toBeLessThan(1000);
    const resolvedContent = `// Resolved massive file\n` + 'function resolvedFn() {}\n'.repeat(500);
    const resolveRes = await request.post(`${API_URL}/workspace/${wsId}/files/${fileId}/conflicts/resolve`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { resolvedContent }
    });
    expect(resolveRes.ok()).toBeTruthy();
  });
});

test.describe('Monaco Editor Basic Functions', () => {
  test('1. verify monaco global type and instance structure', async ({ page, request }) => {
    await loginUser(page, request, 'testmonaco');
    await page.fill('input[placeholder="e.g. React-Sandbox"]', 'MonacoCheck');
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    await page.click('button[title="New File"]');
    await page.fill('.ide-scrollbar input', 'test.js');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.monaco-editor', { timeout: 15000 });
    const monacoType = await page.evaluate(() => typeof (window as any).monaco);
    expect(monacoType).toBe('object');
    const getEditors = await page.evaluate(() => typeof (window as any).monaco?.editor?.getEditors);
    expect(getEditors).toBe('function');
    const models = await page.evaluate(() => (window as any).monaco?.editor?.getModels()?.length);
    expect(models).toBeGreaterThan(0);
  });

  test('2. verify monaco edit undo history', async ({ page, request }) => {
    await loginUser(page, request, 'testundo');
    await page.fill('input[placeholder="e.g. React-Sandbox"]', 'MonacoUndo');
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    await page.click('button[title="New File"]');
    await page.fill('.ide-scrollbar input', 'test.js');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.monaco-editor', { timeout: 15000 });
    const editor = page.locator('.monaco-editor').first();
    await editor.click();
    await page.keyboard.type('Hello World', { delay: 10 });
    await page.waitForTimeout(500);
    const valBefore = await page.evaluate(() => (window as any).monaco.editor.getEditors()[0].getModel().getValue());
    expect(valBefore).toBe('Hello World');
    await page.evaluate(() => {
      const ed = (window as any).monaco.editor.getEditors()[0];
      ed.focus();
      ed.trigger('keyboard', 'undo', null);
    });
    await page.waitForTimeout(500);
    const valAfter = await page.evaluate(() => (window as any).monaco.editor.getEditors()[0].getModel().getValue());
    expect(valAfter).toBe('Hello');
  });

  test('3. verify monaco model URI paths', async ({ page, request }) => {
    await loginUser(page, request, 'testuri');
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
    expect(uris.length).toBe(2);
    expect(uris[1]).toBe('/file-alpha.js');
  });
});

test.describe('Collab - Security & RBAC', () => {
  test('1. resolves network partition split-brain and handles user presence cleanup', async ({ page, context, request }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();
    const aliceName = `Alice_Split_${timestamp}`;
    const bobName = `Bob_Split_${timestamp}`;
    await loginUser(alicePage, request, aliceName);
    await loginUser(bobPage, request, bobName);
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Split_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const workspaceId = extractWorkspaceId(alicePage.url());
    await waitForBootComplete(alicePage);
    await inviteUser(alicePage, bobName, 'editor');
    await bobPage.goto(`${APP_URL}/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await waitForSocketConnect(bobPage);
    await createFile(alicePage, 'conflict.txt');
    await alicePage.waitForTimeout(2000);
    await expect(bobPage.locator('.ide-scrollbar').getByText('conflict.txt')).toBeVisible({ timeout: 10000 });
    await bobPage.locator('.ide-scrollbar').getByText('conflict.txt').click();
    await waitForEditorModel(alicePage, 'conflict.txt');
    await focusEditor(alicePage);
    await alicePage.keyboard.type('Init', { delay: 10 });
    await alicePage.waitForTimeout(1000);
    await expect.poll(async () => await getEditorValue(bobPage), { timeout: 10000 }).toBe('Init');
    await alicePage.context().setOffline(true);
    await bobPage.context().setOffline(true);
    await focusEditor(alicePage);
    await alicePage.keyboard.press('End');
    await alicePage.keyboard.type(' Alice', { delay: 10 });
    await focusEditor(bobPage);
    await bobPage.keyboard.press('End');
    await bobPage.keyboard.type(' Bob', { delay: 10 });
    expect(await getEditorValue(alicePage)).toBe('Init Alice');
    expect(await getEditorValue(bobPage)).toBe('Init Bob');
    await alicePage.context().setOffline(false);
    await bobPage.context().setOffline(false);
    await expect.poll(async () => {
      const valAlice = await getEditorValue(alicePage);
      const valBob = await getEditorValue(bobPage);
      return valAlice === valBob && (valAlice.includes('Alice') && valAlice.includes('Bob'));
    }, { timeout: 15000 }).toBe(true);
    await expect(alicePage.locator('.flex.items-center.-space-x-2')).toContainText(bobName.slice(0, 2).toUpperCase());
    await bobPage.close();
    await expect(alicePage.locator('.flex.items-center.-space-x-2')).not.toContainText(bobName.slice(0, 2).toUpperCase(), { timeout: 15000 });
  });

  test('2. runs interactive bash scripts, handles Ctrl+C signal trapping, and sustains CPU load', async ({ page, request }) => {
    const timestamp = Date.now();
    await loginUser(page, request, `TermSec_${timestamp}`);
    await page.fill('input[placeholder="e.g. React-Sandbox"]', `TermSec_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    const terminalBody = page.locator('.xterm');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);
    await terminalTextarea.focus();
    await page.keyboard.type('read -p "Type input: " val; echo "Logged: $val"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('Type input:', { timeout: 5000 });
    await page.keyboard.type('SecurePTY', { delay: 50 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('Logged: SecurePTY', { timeout: 5000 });
    await page.keyboard.type('sleep 100', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);
    await page.keyboard.press('Control+C');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 5000 });
    await page.keyboard.type('node -e "let count = 0; setInterval(() => { count++; if(count > 50) process.exit(0); }, 50)" &', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    await page.keyboard.type('echo "PTY_ACTIVE"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('PTY_ACTIVE', { timeout: 5000 });
  });

  test('3. restricts viewer workspace access and blocks unauthorized WebSocket upgrades', async ({ page, context, request }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();
    const aliceName = `Alice_RBAC_${timestamp}`;
    const bobName = `Bob_RBAC_${timestamp}`;
    await loginUser(alicePage, request, aliceName);
    await loginUser(bobPage, request, bobName);
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `RBAC_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const workspaceId = extractWorkspaceId(alicePage.url());
    await waitForBootComplete(alicePage);
    await createFile(alicePage, 'viewer-test.js');
    await alicePage.waitForTimeout(2000);
    await inviteUser(alicePage, bobName, 'viewer');
    await bobPage.goto(`${APP_URL}/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('viewer-test.js').waitFor({ state: 'visible', timeout: 15000 });
    await bobPage.locator('.ide-scrollbar').getByText('viewer-test.js').click();
    await waitForEditorModel(bobPage, 'viewer-test.js');
    await expect(bobPage.locator('text=View Only')).toBeVisible({ timeout: 10000 });
    await expect(bobPage.locator('.xterm')).toContainText('sandbox:~#', { timeout: 25000 });
    const bobTerminalTextarea = bobPage.locator('.xterm-helper-textarea');
    await bobTerminalTextarea.focus();
    await bobPage.keyboard.type('cd ..', { delay: 10 });
    await bobPage.keyboard.press('Enter');
    await expect(bobPage.locator('.xterm')).toContainText('restricted', { timeout: 15000 });
    await bobTerminalTextarea.focus();
    await bobPage.keyboard.type('git status', { delay: 10 });
    await bobPage.keyboard.press('Enter');
    await expect(bobPage.locator('.xterm')).toContainText('command not found', { timeout: 15000 });
    await bobPage.locator('.ide-scrollbar').getByText('viewer-test.js').click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });
    const bobMonaco = bobPage.locator('.monaco-editor').first();
    await bobMonaco.click();
    await bobPage.keyboard.type('Cannot write', { delay: 10 });
    await bobPage.waitForTimeout(1000);
    expect(await getEditorValue(bobPage)).toBe('');
  });

  test('4. handles active file deletion while another peer is rapidly typing', async ({ page, context, request }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();
    await loginUser(alicePage, request, `Alice_RugPull_${timestamp}`);
    await loginUser(bobPage, request, `Bob_RugPull_${timestamp}`);
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `RugPull_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const workspaceId = extractWorkspaceId(alicePage.url());
    await waitForBootComplete(alicePage);
    await inviteUser(alicePage, `Bob_RugPull_${timestamp}`, 'editor');
    await createFile(alicePage, 'doomed.js');
    await alicePage.waitForTimeout(2000);
    await bobPage.goto(`${APP_URL}/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('doomed.js').waitFor({ state: 'visible', timeout: 15000 });
    await bobPage.locator('.ide-scrollbar').getByText('doomed.js').click();
    await waitForEditorModel(bobPage, 'doomed.js');
    await bobPage.evaluate(() => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      (window as any).rugPullInterval = setInterval(() => {
        editor.executeEdits('test', [{
          range: editor.getModel().getFullModelRange(),
          text: editor.getModel().getValue() + '\nSPAM',
          forceMoveMarkers: true
        }]);
      }, 50);
    });
    await alicePage.waitForTimeout(1000);
    const fileRow = alicePage.locator('.ide-scrollbar .group', { hasText: 'doomed.js' });
    await fileRow.hover();
    await fileRow.locator('button[title="Delete File"]').click();
    await expect(bobPage.locator('.ide-scrollbar').getByText('doomed.js')).toBeHidden({ timeout: 10000 });
    await bobPage.evaluate(() => clearInterval((window as any).rugPullInterval));
    const emptyState = bobPage.locator('text=Select a file from the explorer to begin.');
    await expect(emptyState).toBeVisible({ timeout: 10000 });
  });

  test('5. survives massive copy-paste payload bombs without crashing the CRDT or WebSocket', async ({ page, context, request }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();
    await loginUser(alicePage, request, `Alice_Bomb_${timestamp}`);
    await loginUser(bobPage, request, `Bob_Bomb_${timestamp}`);
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Bomb_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const workspaceId = extractWorkspaceId(alicePage.url());
    await waitForBootComplete(alicePage);
    await inviteUser(alicePage, `Bob_Bomb_${timestamp}`, 'editor');
    await createFile(alicePage, 'payload.js');
    await waitForEditorModel(alicePage, 'payload.js');
    await bobPage.goto(`${APP_URL}/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('payload.js').waitFor({ state: 'visible', timeout: 15000 });
    await bobPage.locator('.ide-scrollbar').getByText('payload.js').click();
    await waitForEditorModel(bobPage, 'payload.js');
    const massiveString = "const data = 'X';\n".repeat(1000);
    await alicePage.evaluate((payload) => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      editor.executeEdits('paste', [{
        range: editor.getModel().getFullModelRange(),
        text: payload,
        forceMoveMarkers: true
      }]);
    }, massiveString);
    await expect.poll(async () => {
      const bobText = await getEditorValue(bobPage);
      const normalizedBob = bobText.replace(/\r/g, '');
      const normalizedExpected = massiveString.replace(/\r/g, '');
      return normalizedBob.length === normalizedExpected.length;
    }, { timeout: 20000 }).toBe(true);
  });

  test('6. prevents terminal background processes from overwriting actively edited Yjs documents', async ({ page, request }) => {
    const timestamp = Date.now();
    await loginUser(page, request, `Race_${timestamp}`);
    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Race_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(page.locator('.xterm')).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);
    await createFile(page, 'race.js');
    await waitForEditorModel(page, 'race.js');
    const editor = page.locator('.monaco-editor').first();
    await editor.click();
    await page.keyboard.type('YJS_OWNS_THIS', { delay: 10 });
    await page.waitForTimeout(1000);
    await terminalTextarea.focus();
    await page.keyboard.type('echo "TERMINAL_ATTACK" > race.js\n', { delay: 10 });
    await page.waitForTimeout(5000);
    const finalVal = await getEditorValue(page);
    expect(finalVal).toContain('YJS_OWNS_THIS');
    expect(finalVal).not.toContain('TERMINAL_ATTACK');
  });

  test('7. prevents viewer from bypassing UI to execute destructive REST API calls', async ({ page, context, request }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();
    await loginUser(alicePage, request, `Alice_API_${timestamp}`);
    await loginUser(bobPage, request, `Bob_API_${timestamp}`);
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `API_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const workspaceId = extractWorkspaceId(alicePage.url());
    await waitForBootComplete(alicePage);
    await inviteUser(alicePage, `Bob_API_${timestamp}`, 'viewer');
    await bobPage.goto(`${APP_URL}/${workspaceId}`);
    await waitForBootComplete(bobPage);
    const apiResponseStatus = await bobPage.evaluate(async (wsId) => {
      const token = localStorage.getItem('token');
      try {
        const res = await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/files`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ name: 'hacked.js', type: 'file' })
        });
        return res.status;
      } catch (err) {
        return 500;
      }
    }, workspaceId);
    expect(apiResponseStatus).toBe(403);
  });

  test('8. enforces snapshot RBAC, persists history, delivers diff data, and restores correctly', async ({ page, context, request }) => {
    test.setTimeout(90000);
    const alicePage = page; // admin (owner)
    const bobPage   = await context.browser()!.newContext().then(c => c.newPage()); // editor
    const evePage   = await context.browser()!.newContext().then(c => c.newPage()); // viewer
    const timestamp = Date.now();
    const aliceName = `Alice_Snap_${timestamp}`;
    const bobName   = `Bob_Snap_${timestamp}`;
    const eveName   = `Eve_Snap_${timestamp}`;
    await loginUser(alicePage, request, aliceName);
    await loginUser(bobPage, request, bobName);
    await loginUser(evePage, request, eveName);
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Snap_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const workspaceId = extractWorkspaceId(alicePage.url());
    await waitForBootComplete(alicePage);
    await createFile(alicePage, 'history.js');
    await waitForEditorModel(alicePage, 'history.js');
    console.log(1);
    await setEditorValue(alicePage, '// version 1');
    await alicePage.waitForTimeout(3000); // debounce save
    await inviteUser(alicePage, bobName, 'editor');
    await inviteUser(alicePage, eveName, 'viewer');
    const token = {
      alice: await alicePage.evaluate(() => localStorage.getItem('token')),
      bob:   await bobPage.evaluate(() => localStorage.getItem('token')),
      eve:   await evePage.evaluate(() => localStorage.getItem('token')),
    };
    await bobPage.goto(`${APP_URL}/${workspaceId}`);
    await evePage.goto(`${APP_URL}/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await waitForBootComplete(evePage);
    const bobToken = await bobPage.evaluate(() => localStorage.getItem('token'));
    const eveToken = await evePage.evaluate(() => localStorage.getItem('token'));
    const aliceToken = await alicePage.evaluate(() => localStorage.getItem('token'));
    const bobCreateStatus = await bobPage.evaluate(async (wsId) => {
      const res = await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ label: 'bob-attempt' }),
      });
      return res.status;
    }, workspaceId);
    expect(bobCreateStatus).toBe(403);
    const eveCreateStatus = await evePage.evaluate(async (wsId) => {
      const res = await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ label: 'eve-attempt' }),
      });
      return res.status;
    }, workspaceId);
    expect(eveCreateStatus).toBe(403);
    const createResult = await alicePage.evaluate(async (wsId) => {
      const res = await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ label: 'v1-baseline' }),
      });
      return { status: res.status, body: await res.json() };
    }, workspaceId);
    expect(createResult.status).toBe(201);
    expect(createResult.body.label).toBe('v1-baseline');
    const snapshotId = createResult.body.id as string;
    expect(snapshotId).toBeTruthy();
    const aliceList = await alicePage.evaluate(async (wsId) => {
      const res = await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/snapshots`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return { status: res.status, body: await res.json() };
    }, workspaceId);
    expect(aliceList.status).toBe(200);
    expect(Array.isArray(aliceList.body)).toBe(true);
    expect(aliceList.body.length).toBe(1);
    expect(aliceList.body[0].label).toBe('v1-baseline');
    expect(aliceList.body[0].created_by).toBe(aliceName);
    const bobList = await bobPage.evaluate(async (wsId) => {
      const res = await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/snapshots`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return res.status;
    }, workspaceId);
    expect(bobList).toBe(200);
    const eveList = await evePage.evaluate(async (wsId) => {
      const res = await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/snapshots`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return res.status;
    }, workspaceId);
    expect(eveList).toBe(200);
    await setEditorValue(alicePage, '// version 2\nconsole.log("changed");');
    await alicePage.waitForTimeout(3000); // debounce save
    await alicePage.waitForTimeout(1500);
    const diffResult = await alicePage.evaluate(async ({ wsId, snapId }) => {
      const res = await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/snapshots/${snapId}/files`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return { status: res.status, body: await res.json() };
    }, { wsId: workspaceId, snapId: snapshotId });
    expect(diffResult.status).toBe(200);
    const historyFile = diffResult.body.find((f: any) => f.path === 'history.js');
    expect(historyFile).toBeTruthy();
    expect(historyFile.snapshot_content).toContain('version 1');
    expect(historyFile.live_content).toContain('version 2');
    const eveDiffStatus = await evePage.evaluate(async ({ wsId, snapId }) => {
      const res = await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/snapshots/${snapId}/files`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return res.status;
    }, { wsId: workspaceId, snapId: snapshotId });
    expect(eveDiffStatus).toBe(200);
    const bobRestoreStatus = await bobPage.evaluate(async ({ wsId, snapId }) => {
      const res = await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/snapshots/${snapId}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return res.status;
    }, { wsId: workspaceId, snapId: snapshotId });
    expect(bobRestoreStatus).toBe(403);
    const eveRestoreStatus = await evePage.evaluate(async ({ wsId, snapId }) => {
      const res = await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/snapshots/${snapId}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return res.status;
    }, { wsId: workspaceId, snapId: snapshotId });
    expect(eveRestoreStatus).toBe(403);
    await bobPage.close();
    await evePage.close();
    await alicePage.waitForTimeout(1500);
    const restoreResult = await alicePage.evaluate(async ({ wsId, snapId }) => {
      const res = await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/snapshots/${snapId}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return { status: res.status, body: await res.json() };
    }, { wsId: workspaceId, snapId: snapshotId });
    expect(restoreResult.status).toBe(200);
    expect(restoreResult.body.success).toBe(true);
    expect(restoreResult.body.restored_files).toBeGreaterThan(0);
    const filesRes = await page.request.get(`${APP_URL}/api/workspace/${workspaceId}/files`, {
      headers: { Authorization: `Bearer ${token.alice}` }
    });
    const fileListRes = await filesRes.json();
    const historyFileId = fileListRes.find((f: any) => f.name === 'history.js')?.id;
    const dbContentRes = await page.request.get(`${APP_URL}/api/workspace/${workspaceId}/files/${historyFileId}/content`, {
      headers: { Authorization: `Bearer ${token.alice}` }
    }).then(r => r.json());
    expect(dbContentRes.content).toContain('version 1');
    expect(dbContentRes.content).not.toContain('version 2');
    await alicePage.waitForTimeout(2500);
    await waitForBootComplete(alicePage);
    await alicePage.locator('.ide-scrollbar').getByText('history.js').click();
    await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });
    await alicePage.waitForTimeout(2000);
    const restoredContent = await getEditorValue(alicePage);
    expect(restoredContent).toContain('version 1');
    expect(restoredContent).not.toContain('version 2');
    console.log(15);
    for (let i = 2; i <= 11; i++) {
      const r = await alicePage.evaluate(async ({ wsId, i }) => {
        const res = await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/snapshot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
          body: JSON.stringify({ label: `auto-snap-${i}` }),
        });
        return res.status;
      }, { wsId: workspaceId, i });
      expect(r).toBe(201);
    }
    const finalList = await alicePage.evaluate(async (wsId) => {
      const res = await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/snapshots`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return res.json();
    }, workspaceId);
    expect(finalList.length).toBeLessThanOrEqual(10);
    const labels = finalList.map((s: any) => s.label);
    expect(labels).not.toContain('v1-baseline');
    expect(labels).toContain('auto-snap-11');
    console.log(16);
  });

  test.skip('Edge Case: Handles concurrent editor typing during restore mutation', async ({ page, context, request }) => {
  const alicePage = page;
  const bobPage = await context.browser()!.newContext().then(c => c.newPage());
  const timestamp = Date.now();
  await loginUser(alicePage, request, `Alice_Race_${timestamp}`);
  await loginUser(bobPage, request, `Bob_Race_${timestamp}`);
  await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Race_WS_${timestamp}`);
  await alicePage.click('button:has-text("Create Now")');
  await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
  const workspaceId = extractWorkspaceId(alicePage.url());
  await waitForBootComplete(alicePage);
  await createFile(alicePage, 'race.js');
  await alicePage.waitForTimeout(2000);
  await setEditorValue(alicePage, '// Baseline');
  await alicePage.waitForTimeout(2000);
  const snapRes = await alicePage.evaluate(async (wsId) => {
    const res = await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    return res.json();
  }, workspaceId);
  const snapshotId = snapRes.id;
  await inviteUser(alicePage, `Bob_Race_${timestamp}`, 'editor');
  await bobPage.goto(`${APP_URL}/${workspaceId}`);
  await waitForBootComplete(bobPage);
  await bobPage.locator('.ide-scrollbar').getByText('race.js').click();
  await waitForEditorModel(bobPage, 'race.js');
  const bobTypingPromise = bobPage.evaluate(async () => {
    const ed = (window as any).monaco.editor.getEditors()[0];
    for (let i = 0; i < 20; i++) {
      ed.getModel().setValue(`// Bob edit ${i}`);
      await new Promise(r => setTimeout(r, 50));
    }
  });
  const aliceRestorePromise = alicePage.evaluate(async ({ wsId, snapId }) => {
    await new Promise(r => setTimeout(r, 300)); // wait a bit so Bob is mid-typing
    return fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/snapshots/${snapId}/restore`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
  }, { wsId: workspaceId, snapId: snapshotId });
  await Promise.all([bobTypingPromise, aliceRestorePromise]);
  await alicePage.waitForTimeout(2000);
  const dbContent = await alicePage.evaluate(async (wsId) => {
    const filesRes = await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/files`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    const files = await filesRes.json();
    const fileId = files.find((f: any) => f.name === 'race.js').id;
    const contentRes = await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/files/${fileId}/content`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    return (await contentRes.json()).content;
  }, workspaceId);
  expect(dbContent).toContain('Baseline');
  expect(dbContent).not.toContain('Bob edit');
});

 test('Edge Case: Handles taking and restoring snapshots of an empty workspace', async ({ page, request }) => {
  const timestamp = Date.now();
  await loginUser(page, request, `Alice_Empty_${timestamp}`);
  await page.fill('input[placeholder="e.g. React-Sandbox"]', `Empty_WS_${timestamp}`);
  await page.click('button:has-text("Create Now")');
  await page.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
  const workspaceId = extractWorkspaceId(page.url());
  await waitForBootComplete(page);
  const snapRes = await page.evaluate(async (wsId) => {
    const res = await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: JSON.stringify({ label: 'Empty State' }),
    });
    return res.json();
  }, workspaceId);
  expect(snapRes.id).toBeTruthy();
  await createFile(page, 'temp.js');
  await page.waitForTimeout(1000);
  const restoreStatus = await page.evaluate(async ({ wsId, snapId }) => {
    const res = await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/snapshots/${snapId}/restore`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });
    return res.status;
  }, { wsId: workspaceId, snapId: snapRes.id });
  expect(restoreStatus).toBe(200);
});
  test('12. snapshot diff identifies NEW, DEL, MOD states, preserves paths, and handles large files', async ({ page, request }) => {
    const timestamp = Date.now();
    await loginUser(page, request, `Alice_Diff_${timestamp}`);
    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Diff_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const workspaceId = extractWorkspaceId(page.url());
    await waitForBootComplete(page);
    const largeContent = "const data = 'A';\n".repeat(600);
    await page.evaluate(async ({ wsId, payload }) => {
      const token = localStorage.getItem('token');
      await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'src/components/mod.js', type: 'file' })
      });
      await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'del.js', type: 'file' })
      });
      const files = await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/files`, {
        headers: { Authorization: `Bearer ${token}` }
      }).then(r => r.json());
      const modFile = files.find((f: any) => f.name === 'src/components/mod.js');
      const delFile = files.find((f: any) => f.name === 'del.js');
      await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/files/${modFile.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: payload })
      });
      await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/files/${delFile.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: '// to be deleted' })
      });
    }, { wsId: workspaceId, payload: largeContent });
    await page.waitForTimeout(2000); // Give DB a moment to settle
    const snapRes = await page.evaluate(async (wsId) => {
      const res = await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ label: 'Baseline' }),
      });
      return res.json();
    }, workspaceId);
    const snapshotId = snapRes.id;
    await page.evaluate(async ({ wsId, payload }) => {
      const token = localStorage.getItem('token');
      const files = await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/files`, {
        headers: { Authorization: `Bearer ${token}` }
      }).then(r => r.json());
      const modFile = files.find((f: any) => f.name === 'src/components/mod.js');
      const delFile = files.find((f: any) => f.name === 'del.js');
      await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/files/${modFile.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: payload + '\n// NEW LINE' })
      });
      await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/files/${delFile.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const newFile = await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'new.js', type: 'file' })
      }).then(r => r.json());
      await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/files/${newFile.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: '// brand new' })
      });
    }, { wsId: workspaceId, payload: largeContent });
    await page.waitForTimeout(1000);
    const diffFiles = await page.evaluate(async ({ wsId, snapId }) => {
      const res = await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/snapshots/${snapId}/files`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      return res.json();
    }, { wsId: workspaceId, snapId: snapshotId });
    const modDiff = diffFiles.find((f: any) => f.path === 'src/components/mod.js' || f.name === 'src/components/mod.js');
    const delDiff = diffFiles.find((f: any) => f.path === 'del.js' || f.name === 'del.js');
    const newDiff = diffFiles.find((f: any) => f.path === 'new.js' || f.name === 'new.js');
    expect(modDiff).toBeDefined();
    expect(modDiff.snapshot_content).toBe(largeContent);
    expect(modDiff.live_content).toBe(largeContent + '\n// NEW LINE');
    expect(delDiff).toBeDefined();
    expect(delDiff.snapshot_content).toBe('// to be deleted');
    expect(delDiff.live_content).toBeFalsy();
    expect(newDiff).toBeDefined();
    expect(newDiff.snapshot_content).toBeFalsy();
    expect(newDiff.live_content).toBe('// brand new');
  });

  test('13. correctly saves labels, creator username, and returns list in newest-first order', async ({ page, request }) => {
    const timestamp = Date.now();
    const username = `Alice_Meta_${timestamp}`;
    await loginUser(page, request, username);
    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Meta_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const workspaceId = extractWorkspaceId(page.url());
    await waitForBootComplete(page);
    await page.evaluate(async (wsId) => {
      await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ label: 'First Snapshot' })
      });
    }, workspaceId);
    await page.waitForTimeout(1000);
    await page.evaluate(async (wsId) => {
      await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ label: 'Second Snapshot' })
      });
    }, workspaceId);
    const snapshots = await page.evaluate(async (wsId) => {
      const res = await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/snapshots`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      return res.json();
    }, workspaceId);
    expect(snapshots.length).toBe(2);
    expect(snapshots[0].label).toBe('Second Snapshot');
    expect(snapshots[1].label).toBe('First Snapshot');
    expect(snapshots[0].created_by).toBe(username);
    expect(snapshots[1].created_by).toBe(username);
  });

  test('14. broadcasts snapshot-restored event for seamless sync and resets yjs_state to prevent CRDT ghosting', async ({ page, context, request }) => {
    const alicePage = page;
    let bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();
    await loginUser(alicePage, request, `Alice_Sync_${timestamp}`);
    await loginUser(bobPage, request, `Bob_Sync_${timestamp}`);
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Sync_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const workspaceId = extractWorkspaceId(alicePage.url());
    await waitForBootComplete(alicePage);
    await createFile(alicePage, 'live.js');
    await waitForEditorModel(alicePage, 'live.js');
    await setEditorValue(alicePage, '// BASELINE DATA');
    await alicePage.waitForTimeout(3000);

    const fileId = await alicePage.evaluate(async (wsId) => {
      const token = localStorage.getItem('nexus_ide_token') || localStorage.getItem('token');
      const res = await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/files`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const files = await res.json();
      return files.find((f: any) => f.name === 'live.js')?.id;
    }, workspaceId);

    const snapRes = await alicePage.evaluate(async (wsId) => {
      const token = localStorage.getItem('nexus_ide_token') || localStorage.getItem('token');
      const res = await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ label: 'Base' })
      });
      return res.json();
    }, workspaceId);
    await inviteUser(alicePage, `Bob_Sync_${timestamp}`, 'editor');
    await bobPage.goto(`${APP_URL}/ide/${workspaceId}/${fileId}`);
    await waitForBootComplete(bobPage);
    await waitForEditorModel(bobPage, 'live.js');
    await setEditorValue(alicePage, '// MISTAKE DATA');
    await expect.poll(async () => await getEditorValue(bobPage), { timeout: 25000, intervals: [1000] }).toBe('// MISTAKE DATA');
    await alicePage.evaluate(async ({ wsId, snapId }) => {
      const token = localStorage.getItem('nexus_ide_token') || localStorage.getItem('token');
      await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/snapshots/${snapId}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
    }, { wsId: workspaceId, snapId: snapRes.id });
    await bobPage.waitForURL(/\/ide\/[a-f0-9-]+/, { timeout: 20000 }).catch(() => {});
    await waitForBootComplete(bobPage);
    await waitForEditorModel(bobPage, 'live.js');
    await expect.poll(async () => await getEditorValue(bobPage), { timeout: 25000, intervals: [1000] }).toBe('// BASELINE DATA');
    await bobPage.close();
    bobPage = await context.browser()!.newContext().then(c => c.newPage());
    await loginUser(bobPage, request, `Bob_Sync_${timestamp}`);
    await bobPage.goto(`${APP_URL}/ide/${workspaceId}/${fileId}`);
    await waitForBootComplete(bobPage);
    await waitForEditorModel(bobPage, 'live.js');
    await expect.poll(async () => await getEditorValue(bobPage), { timeout: 25000, intervals: [1000] }).toBe('// BASELINE DATA');
  });

  test('15. cascades workspace deletion to wipe associated snapshots from the database', async ({ page, request }) => {
    const timestamp = Date.now();
    await loginUser(page, request, `Alice_Cascade_${timestamp}`);
    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Cascade_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const workspaceId = extractWorkspaceId(page.url());
    await waitForBootComplete(page);
    const snapRes = await page.evaluate(async (wsId) => {
      const token = localStorage.getItem('nexus_ide_token') || localStorage.getItem('token');
      const apiPrefix = window.location.pathname.startsWith('/ide') ? '/ide/api' : '/api';
      const res = await fetch(`${apiPrefix}/workspace/${wsId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ label: 'Doomed Snapshot' })
      });
      return res.json();
    }, workspaceId);
    expect(snapRes.id).toBeTruthy();
    const deleteRes = await page.evaluate(async (wsId) => {
      const token = localStorage.getItem('nexus_ide_token') || localStorage.getItem('token');
      const apiPrefix = window.location.pathname.startsWith('/ide') ? '/ide/api' : '/api';
      const res = await fetch(`${apiPrefix}/workspace/${wsId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      return res.status;
    }, workspaceId);
    expect(deleteRes).toBe(200); // Or 204 depending on your API standard
    const postDeleteSnapshots = await page.evaluate(async (wsId) => {
      const token = localStorage.getItem('nexus_ide_token') || localStorage.getItem('token');
      const apiPrefix = window.location.pathname.startsWith('/ide') ? '/ide/api' : '/api';
      const res = await fetch(`${apiPrefix}/workspace/${wsId}/snapshots`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return res.status;
    }, workspaceId);
    expect([403, 404]).toContain(postDeleteSnapshots);
  });

  test('16. snapshot restore recreates deleted files/folders and syncs contents to container', async ({ page, request }) => {
    const timestamp = Date.now();
    await loginUser(page, request, `Alice_Restore_${timestamp}`);
    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Restore_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const workspaceId = extractWorkspaceId(page.url());
    await waitForBootComplete(page);
    await page.evaluate(async (wsId) => {
      const token = localStorage.getItem('token');
      const createRes = await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'src/components/button.js', type: 'file' })
      }).then(r => r.json());
      await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/files/${createRes.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: '// button v1' })
      });
    }, workspaceId);
    await page.waitForTimeout(2000); // Allow Yjs debounced save and db write
    const snapRes = await page.evaluate(async (wsId) => {
      const res = await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ label: 'Snapshot V1' }),
      });
      return res.json();
    }, workspaceId);
    const snapshotId = snapRes.id;
    await page.evaluate(async (wsId) => {
      const token = localStorage.getItem('token');
      const files = await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/files`, {
        headers: { Authorization: `Bearer ${token}` }
      }).then(r => r.json());
      const file = files.find((f: any) => f.name.includes('button.js'));
      if (file) {
        await fetch(`${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '/api' : '/ide/api'}/workspace/${wsId}/files/${file.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` }
        });
      }
    }, workspaceId);

    test.setTimeout(90000);
    const token = await page.evaluate(() => localStorage.getItem('token'));
    const filesList1 = await page.request.get(`${APP_URL}/api/workspace/${workspaceId}/files`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json());
    expect(filesList1.some((f: any) => f.name.includes('button.js'))).toBe(false);
    const restoreRes = await page.request.post(`${APP_URL}/api/workspace/${workspaceId}/snapshots/${snapshotId}/restore`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json());
    expect(restoreRes.success).toBe(true);
    await page.waitForTimeout(2000);
    const filesList2 = await page.request.get(`${APP_URL}/api/workspace/${workspaceId}/files`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json());
    const restoredFile = filesList2.find((f: any) => f.name === 'button.js' || f.name === 'src/components/button.js');
    expect(restoredFile).toBeDefined();
    const cacheContent = await page.request.get(`${APP_URL}/api/workspace/${workspaceId}/files/${restoredFile.id}/content`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json());
    expect(cacheContent.content).toContain('// button v1');
  });

  test.skip('17. blame engine maps Yjs client IDs to persistent user profiles across reconnects', async ({ page, context, request }) => {
    const timestamp = Date.now();
    const aliceName = `Alice_Blame_${timestamp}`;
    await loginUser(page, request, aliceName);
    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Blame_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const workspaceId = extractWorkspaceId(page.url());
    await waitForBootComplete(page);
    await createFile(page, 'blame.js');
    await waitForEditorModel(page, 'blame.js');
    await focusEditor(page);
    await page.keyboard.type('// line written by Alice');
    await page.waitForTimeout(2000); // Wait for Yjs debounced save to persist authorMap to DB

    test.setTimeout(90000);
    const token = await page.evaluate(() => localStorage.getItem('token'));
    const filesList = await page.request.get(`${APP_URL}/api/workspace/${workspaceId}/files`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json());
    const blameFile = filesList.find((f: any) => f.name === 'blame.js');
    expect(blameFile).toBeDefined();
    const history = await page.request.get(`${APP_URL}/api/workspace/${workspaceId}/files/${blameFile.id}/history`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json());
    expect(Object.keys(history.authorMap).length).toBeGreaterThan(0);
    await page.close();
    const newPage = await context.newPage();
    await loginUser(newPage, request, aliceName);
    await newPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(newPage);
    await newPage.locator('.ide-scrollbar').getByText('blame.js').click();
    await waitForEditorModel(newPage, 'blame.js');
    await waitForEditorSync(newPage);
    await newPage.waitForTimeout(2000); // Give Yjs editor content sync and state resolution a moment to stabilize
    await newPage.click('button:has-text("Blame")');
    await newPage.locator('button:has-text("Hide Blame")').first().waitFor({ state: 'visible', timeout: 15000 });
    const usernameElement = newPage.locator('span.truncate.w-24').first();
    await expect(usernameElement).toContainText(aliceName, { timeout: 10000 });
    const tooltipText = await usernameElement.getAttribute('title');
    if (tooltipText) {
      expect(tooltipText).toContain(aliceName);
    }
    await newPage.close();
  });
})
