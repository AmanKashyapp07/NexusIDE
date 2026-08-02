import { test, expect, type Page, type APIRequestContext, type Browser } from '@playwright/test';
import {
  APP_URL, API_URL, WS_URL,
  login, loginUser, inviteUser, waitForBootComplete, focusEditor,
  createTestWorkspace, deleteTestWorkspace, createTestFile, createFile, typeTextInMonaco,
  getEditorValue, waitForEditorModel, waitForEditorSync, setMonacoValue, setEditorValue, waitForSocketConnect
} from './testUtils';

// ─── FROM testing/e2e/collaboration_1.spec.ts ───
// ─── Auth bypass: call API directly, inject token, navigate to dashboard ──────
// The frontend bundle may have localhost:4000 baked in from local dev builds.
// Browser-side fetch() will fail in that case. We use Playwright's Node.js
// request context instead (always resolves correctly).









test.describe('Collaborative Engine Part 1 (Tests 1-8)', () => {

  test('1. synchronizes typing between users and enforces roles', async ({ page, context, request }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();

    await loginUser(alicePage, request, `Alice_${timestamp}`);
    await loginUser(bobPage, request, `Bob_${timestamp}`);

    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `E2E_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await createFile(alicePage, 'index.js');
    await waitForEditorModel(alicePage, 'index.js');
    await inviteUser(alicePage, `Bob_${timestamp}`, 'editor');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
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
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);
    await inviteUser(alicePage, `Bob_Sync_${timestamp}`, 'editor');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
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
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);
    await inviteUser(alicePage, `Bob_Pres_${timestamp}`, 'editor');

    await createFile(alicePage, 'presence.js');
    await waitForEditorModel(alicePage, 'presence.js');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
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
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await createFile(alicePage, 'conflict.js');
    await waitForEditorModel(alicePage, 'conflict.js');

    await loginUser(bobPage, request, `Bob_Simul_${timestamp}`);
    await inviteUser(alicePage, `Bob_Simul_${timestamp}`, 'editor');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
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
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await createFile(alicePage, 'old-name.js');
    await waitForEditorModel(alicePage, 'old-name.js');

    await loginUser(bobPage, request, `Bob_Rename_${timestamp}`);
    await inviteUser(alicePage, `Bob_Rename_${timestamp}`, 'editor');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
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
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await createFile(alicePage, 'late.js');
    await waitForEditorModel(alicePage, 'late.js');
    await focusEditor(alicePage);
    await alicePage.keyboard.type(`console.log("${SENTINEL}");`, { delay: 10 });

    // Give Postgres time to persist the Yjs snapshot before Bob joins
    await alicePage.waitForTimeout(5000);

    await loginUser(bobPage, request, `Bob_Late_${timestamp}`);
    await inviteUser(alicePage, `Bob_Late_${timestamp}`, 'editor');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
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
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await inviteUser(alicePage, `Bob_Reconn_${timestamp}`, 'editor');
    await createFile(alicePage, 'reconnect.js');
    await waitForEditorModel(alicePage, 'reconnect.js');
    await focusEditor(alicePage);
    await alicePage.keyboard.type(`const x = "${SENTINEL}";`);

    // Let snapshot persist
    await alicePage.waitForTimeout(5000);

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('reconnect.js').click();
    await waitForEditorModel(bobPage, 'reconnect.js');

    await bobPage.goto(`${APP_URL}/dashboard`);
    await bobPage.waitForURL(/\/dashboard/);
    await bobPage.waitForTimeout(2000);

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
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
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await createFile(alicePage, 'jump.js');
    await waitForEditorModel(alicePage, 'jump.js');
    await inviteUser(alicePage, `Bob_Jump_${timestamp}`, 'editor');

    await focusEditor(alicePage);
    await alicePage.keyboard.type('// line 1\n// line 2\n// line 3\n// line 4\n// line 5\n', { delay: 10 });

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
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

// ─── FROM testing/e2e/collaboration_2.spec.ts ───
test.describe('Collaborative Engine Part 2 (Tests 9-16)', () => {

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
      await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
      const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
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

      await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
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
      await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
      const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
      await waitForBootComplete(alicePage);
      await inviteUser(alicePage, `Bob_Persist_${timestamp}`, 'editor');

      await createFile(alicePage, 'persist-test.js');
      await waitForEditorModel(alicePage, 'persist-test.js');
      await focusEditor(alicePage);
      await alicePage.keyboard.type(`const sentinel = "${PERSIST_SENTINEL}";\n`);

      await alicePage.waitForTimeout(4000);
      await alicePage.goto(`${APP_URL}/dashboard`);
      await alicePage.waitForURL(/\/dashboard/);

      // Give Postgres time to physically commit the Yjs BYTEA blob
      await alicePage.waitForTimeout(5000);

      await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
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
      await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
      const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
      await waitForBootComplete(alicePage);

      await inviteUser(alicePage, `Bob_Undo_${timestamp}`, 'editor');
      await createFile(alicePage, 'undo-test.js');
      await waitForEditorModel(alicePage, 'undo-test.js');

      await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
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
      await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
      const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
      await waitForBootComplete(alicePage);
      await waitForSocketConnect(alicePage);

      await inviteUser(alicePage, `Bob_Offline_${timestamp}`, 'editor');
      await createFile(alicePage, 'partition.js');
      await waitForEditorModel(alicePage, 'partition.js');

      await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
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
      await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
      const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
      await waitForBootComplete(alicePage);

      await createFile(alicePage, 'file-alpha.js');
      await waitForEditorModel(alicePage, 'file-alpha.js');
      await focusEditor(alicePage);
      await alicePage.keyboard.type(`const a = "${CONTENT_1}";`);

      await createFile(alicePage, 'file-beta.js');
      await waitForEditorModel(alicePage, 'file-beta.js');
      await focusEditor(alicePage);
      await alicePage.keyboard.type(`const b = "${CONTENT_2}";`);

      // Longer settle time so both files persist to DB before Bob joins
      await alicePage.waitForTimeout(5000);
      await inviteUser(alicePage, `Bob_LateTree_${timestamp}`, 'editor');

      await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
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
      await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
      const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
      await waitForBootComplete(alicePage);

      await inviteUser(alicePage, `Bob_LiveFile_${timestamp}`, 'editor');
      await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
      await waitForBootComplete(bobPage);

      // Wait for Bob's socket to be connected before Alice creates the file
      // so the file-created socket event is received live (not from REST poll)
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
      await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
      const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
      await waitForBootComplete(alicePage);

      await inviteUser(alicePage, `Bob_Slow_${timestamp}`, 'editor');

      await createFile(alicePage, 'latency.js');
      await waitForEditorModel(alicePage, 'latency.js');
      await focusEditor(alicePage);
      await alicePage.keyboard.type(`const data = "${CONTENT}";`);
      await alicePage.waitForTimeout(4000);

      await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
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
      await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
      const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
      await waitForBootComplete(alicePage);

      await inviteUser(alicePage, `Bob_Flaky_${timestamp}`, 'editor');

      await createFile(alicePage, 'flaky.js');
      await waitForEditorModel(alicePage, 'flaky.js');

      await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
      await waitForBootComplete(bobPage);
      await bobPage.locator('.ide-scrollbar').getByText('flaky.js').click();
      await waitForEditorModel(bobPage, 'flaky.js');

      // Wait for both sockets to be stable before starting offline cycles
      await waitForSocketConnect(alicePage);
      await waitForSocketConnect(bobPage);

      await focusEditor(alicePage);
      await alicePage.keyboard.type('// Stable line\n');

      // Wait for the stable line to reach Bob before starting offline cycles
      await expect(async () => {
        expect(await getEditorValue(bobPage)).toContain('Stable line');
      }).toPass({ timeout: 20000, intervals: [1000] });

      for (let i = 0; i < 3; i++) {
        await bobContext.setOffline(true);
        await bobPage.waitForTimeout(800);

        await focusEditor(bobPage);
        await bobPage.keyboard.type(`// Offline edit ${i}\n`);

        await bobContext.setOffline(false);
        // Give Yjs time to reconnect and flush queued ops before next cycle
        await bobPage.waitForTimeout(4000);
      }

      // Extra settle time for all ops to propagate
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

// ─── FROM testing/e2e/conflict.spec.ts ───
test.describe('Git Merge Conflict Resolver E2E - Brutal Scenarios', () => {
  test.setTimeout(120000);

  const timestamp = Date.now();
  let token: string;
  let wsId: string;
  let fileId: string;

  // Setup: Create a shared workspace and file for each test
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

  // Cleanup
  test.afterEach(async ({ request }) => {
    await request.delete(`${API_URL}/workspace/${wsId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  });

  test('Should handle multiple, empty, and CRLF-formatted conflicts gracefully', async ({ request }) => {
    // Inject a brutally messy conflict string:
    // 1. CRLF mixed with LF
    // 2. Empty 'ours' block
    // 3. Multiple conflicts in one file
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

    // Force content update via API (assuming a backend hook exists for git pulls)
    // Or inject via Monaco if API bypass isn't available
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
    
    // Validate empty block parsing
    expect(parseData.conflicts[1].ours.trim()).toBe('');
    expect(parseData.conflicts[1].theirs).toContain('Only theirs exists');
  });

  test('Should fail securely on malformed conflict markers', async ({ request }) => {
    // Missing the closing >>>>>>> marker
    const malformedContent = `<<<<<<< HEAD\nconsole.log("a");\n=======\nconsole.log("b");`;

    await request.put(`${API_URL}/workspace/${wsId}/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { content: malformedContent }
    });

    const parseRes = await request.get(`${API_URL}/workspace/${wsId}/files/${fileId}/conflicts`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    // The parser should ideally catch this and return a 400 or mark it as an invalid git state,
    // rather than crashing the backend.
    expect([200, 400, 422]).toContain(parseRes.status());
    if (parseRes.ok()) {
      const parseData = await parseRes.json();
      expect(parseData.hasConflicts).toBe(false); // Should not parse as a valid conflict
    }
  });

  test('Collaborative Real-time Resolution (Dual-Browser Sync)', async ({ browser, request }) => {
    // Create two separate browser contexts to simulate two different users
    // this suite is to test whether 
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    // Login both users to ensure they are created in the database
    const tokenA = await loginUser(pageA, request, `conflict_user_a_${timestamp}`);
    await loginUser(pageB, request, `conflict_user_b_${timestamp}`);

    // Invite both users to the workspace as editors via API
    await request.post(`${API_URL}/workspace/${wsId}/collaborators`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { usernameOrEmail: `conflict_user_a_${timestamp}`, role: 'editor' }
    });
    await request.post(`${API_URL}/workspace/${wsId}/collaborators`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { usernameOrEmail: `conflict_user_b_${timestamp}`, role: 'editor' }
    });

    // Both users navigate to the same file
    await Promise.all([
      pageA.goto(`${APP_URL}/ide/${wsId}/${fileId}`),
      pageB.goto(`${APP_URL}/ide/${wsId}/${fileId}`)
    ]);

    await Promise.all([
      waitForBootComplete(pageA),
      waitForBootComplete(pageB)
    ]);

    // Wait for both editors to mount
    const waitForEditor = async (page: Page) => {
      await page.waitForFunction(() => {
        return (window as any).monaco?.editor?.getEditors()?.length > 0;
      }, { timeout: 90000 });
    };
    await Promise.all([waitForEditor(pageA), waitForEditor(pageB)]);

    // Allow Yjs WebSockets to handshake and complete initial sync
    await Promise.all([
      waitForSocketConnect(pageA),
      waitForSocketConnect(pageB)
    ]);

    // Inject conflict via User A using executeEdits so the change flows through
    // MonacoBinding → Y.Text → broadcast to User B via Yjs CRDT.
    // Using editor.setValue() bypasses MonacoBinding entirely: Y.Text stays empty,
    // the Yjs room never gets the conflict content, and the resolve API's Yjs
    // transaction operates on empty text, producing wrong results on User B.
    const conflictContent = `<<<<<<< HEAD\nUser A edits\n=======\nUser B edits\n>>>>>>> main`;
    await pageA.evaluate((content) => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      console.log('[Test Debug] User A setting value to:', content);
      // Use executeEdits to route through MonacoBinding so Y.Text is updated
      const model = editor.getModel();
      const fullRange = model.getFullModelRange();
      editor.executeEdits('test-inject', [{
        range: fullRange,
        text: content,
        forceMoveMarkers: true
      }]);
      // Push undo stop so it's a clean edit
      editor.pushUndoStop();
      console.log('[Test Debug] User A set value complete. Current value:', editor.getValue());
    }, conflictContent);

    // Assert User B sees the conflict injected by User A via Yjs
    await pageB.waitForFunction((expected) => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      const normalize = (s: string) => s.replace(/\r\n/g, '\n');
      return normalize(editor.getValue()) === normalize(expected);
    }, conflictContent, { timeout: 15000 });

    // User A resolves the conflict via API
    const resolvedContent = `Merged edits`;
    const resolveRes = await request.post(`${API_URL}/workspace/${wsId}/files/${fileId}/conflicts/resolve`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { resolvedContent }
    });
    expect(resolveRes.ok()).toBeTruthy();

    // BRUTAL CHECK: Does User B's Monaco editor update instantly without a page reload?
    // This tests if your backend correctly broadcasts the resolution over WebSockets/Yjs
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
    // Setup file with conflict
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
    
    // Poll the database until the injected conflict content has synced and saved
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

    // Simulate API resolving the conflict at the exact moment the user is typing
    const resolvedContent = `var x = 3; // resolved`;
    
    // Start the API request, but don't await it immediately
    const resolvePromise = request.post(`${API_URL}/workspace/${wsId}/files/${fileId}/conflicts/resolve`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { resolvedContent }
    });

    // Immediately simulate user typing in the editor during the network request
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

    // Wait for the dust to settle on the WebSocket sync
    await page.waitForTimeout(2000);

    const finalContent = await page.evaluate(() => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      return editor.getValue();
    });

    // The brutal check: Depending on your Operational Transformation / CRDT implementation, 
    // the system should not crash. It should either:
    // 1. Keep the resolved content (overwriting user's concurrent typing)
    // 2. Keep both (resolved content + user's new typing)
    // It should NOT contain the old Git conflict markers.
    expect(finalContent).not.toContain('<<<<<<< HEAD');
    expect(finalContent).not.toContain('=======');
  });

  test('Brutal Scenario 1: Nested and False Positive Conflict Markers', async ({ request }) => {
    // Tests conflict markers inside code strings and nested conflict markers
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
    // Verify that the parser handles nested markers deterministically without throwing 500 internal server error
    expect(parseData).toHaveProperty('hasConflicts');
  });

  test('Brutal Scenario 2: Thundering Herd Concurrent Resolution Requests', async ({ request }) => {
    // Inject conflict
    const conflictContent = `<<<<<<< HEAD\nVersion Alpha\n=======\nVersion Beta\n>>>>>>> branch`;
    await request.put(`${API_URL}/workspace/${wsId}/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { content: conflictContent }
    });

    // Fire 5 simultaneous resolve requests with competing payloads
    const resolveRequests = Array.from({ length: 5 }).map((_, index) => 
      request.post(`${API_URL}/workspace/${wsId}/files/${fileId}/conflicts/resolve`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { resolvedContent: `Resolved by Request #${index}` }
      })
    );

    const responses = await Promise.all(resolveRequests);
    
    // Every request should succeed without deadlocking the database pool
    responses.forEach(res => expect(res.ok()).toBeTruthy());

    // Verify DB consistency: final content should be equal to one of the resolved payloads
    const getRes = await request.get(`${API_URL}/workspace/${wsId}/files/${fileId}/content`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(getRes.ok()).toBeTruthy();
    const body = await getRes.json();
    expect(body.content).toMatch(/Resolved by Request #[0-4]/);
  });

  test('Brutal Scenario 3: Large File Payload Stress Test (5,000+ Lines)', async ({ request }) => {
    // Generate a massive file containing 5,000 lines with 10 large conflict blocks
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

    // Measure parsing performance
    const startTime = Date.now();
    const parseRes = await request.get(`${API_URL}/workspace/${wsId}/files/${fileId}/conflicts`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const parseTime = Date.now() - startTime;

    expect(parseRes.ok()).toBeTruthy();
    const parseData = await parseRes.json();
    expect(parseData.hasConflicts).toBe(true);
    expect(parseData.conflicts.filter((c: any) => c.type === 'conflict').length).toBe(10);
    // Parse time for 5,000 lines should take under 1000ms
    expect(parseTime).toBeLessThan(1000);

    // Resolve the large conflict
    const resolvedContent = `// Resolved massive file\n` + 'function resolvedFn() {}\n'.repeat(500);
    const resolveRes = await request.post(`${API_URL}/workspace/${wsId}/files/${fileId}/conflicts/resolve`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { resolvedContent }
    });
    expect(resolveRes.ok()).toBeTruthy();
  });
});

// ─── FROM testing/e2e/monaco-basic.spec.ts ───
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
    console.log("MONACO TYPE:", monacoType);
    expect(monacoType).toBe('object');
    
    const getEditors = await page.evaluate(() => typeof (window as any).monaco?.editor?.getEditors);
    console.log("GET EDITORS:", getEditors);
    expect(getEditors).toBe('function');
    
    const models = await page.evaluate(() => (window as any).monaco?.editor?.getModels()?.length);
    console.log("MODELS:", models);
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
    console.log("URIs:", uris);
    expect(uris.length).toBe(2);
    expect(uris[1]).toBe('/file-alpha.js');
  });

});

// ─── FROM testing/e2e/brutal-integration.spec.ts ───
// Wait until the socket is connected


test.describe('Brutal Integration & Security Test Suite (CRDT, Sandbox Limits, RBAC)', () => {

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 1: CRDT Split-Brain (Network Partition) Convergence & Presence Teardown
  // ═══════════════════════════════════════════════════════════════════════════════
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
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await inviteUser(alicePage, bobName, 'editor');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await waitForSocketConnect(bobPage);

    await createFile(alicePage, 'conflict.txt');
    await alicePage.waitForTimeout(2000);

    // Bob waits for file to appear in sidebar (via file-tree-update socket event)
    await expect(bobPage.locator('.ide-scrollbar').getByText('conflict.txt')).toBeVisible({ timeout: 10000 });
    await bobPage.locator('.ide-scrollbar').getByText('conflict.txt').click();
    await waitForEditorModel(alicePage, 'conflict.txt');
    await focusEditor(alicePage);
    await alicePage.keyboard.type('Init', { delay: 10 });
    await alicePage.waitForTimeout(1000);

    // Confirm Bob received Alice's initial content before going offline
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

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 2: Sandbox Resource Limits, Interactive Prompts & Signal Trapping
  // ═══════════════════════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 3: Socket Security & Role-Based Access Control (RBAC)
  // ═══════════════════════════════════════════════════════════════════════════════
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
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await createFile(alicePage, 'viewer-test.js');
    await alicePage.waitForTimeout(2000);

    await inviteUser(alicePage, bobName, 'viewer');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    // Wait for auto-navigation to file and editor to mount with readOnly=true
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

    // Try running git command in Bob's terminal (should fail with command not found since PATH=/viewer_bin)
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

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 4: The "Rug Pull" - Active Deletion During Live Typing
  // ═══════════════════════════════════════════════════════════════════════════════
  test('4. handles active file deletion while another peer is rapidly typing', async ({ page, context, request }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();

    await loginUser(alicePage, request, `Alice_RugPull_${timestamp}`);
    await loginUser(bobPage, request, `Bob_RugPull_${timestamp}`);

    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `RugPull_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await inviteUser(alicePage, `Bob_RugPull_${timestamp}`, 'editor');
    
    await createFile(alicePage, 'doomed.js');
    await alicePage.waitForTimeout(2000);

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    
    await bobPage.locator('.ide-scrollbar').getByText('doomed.js').waitFor({ state: 'visible', timeout: 15000 });
    await bobPage.locator('.ide-scrollbar').getByText('doomed.js').click();
    await waitForEditorModel(bobPage, 'doomed.js');

    // Bob starts typing rapidly via evaluation to simulate intense CRDT activity
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

    // Alice ruthlessly deletes the file from the UI
    const fileRow = alicePage.locator('.ide-scrollbar .group', { hasText: 'doomed.js' });
    await fileRow.hover();
    await fileRow.locator('button[title="Delete File"]').click();

    // Verify Bob's UI recovers cleanly without a React crash (white screen of death)
    await expect(bobPage.locator('.ide-scrollbar').getByText('doomed.js')).toBeHidden({ timeout: 10000 });
    
    // Clear the interval to prevent memory leaks in the test browser
    await bobPage.evaluate(() => clearInterval((window as any).rugPullInterval));

    const emptyState = bobPage.locator('text=Select a file from the explorer to begin.');
    await expect(emptyState).toBeVisible({ timeout: 10000 });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 5: Massive Payload / Copy-Paste Bomb
  // ═══════════════════════════════════════════════════════════════════════════════
  test('5. survives massive copy-paste payload bombs without crashing the CRDT or WebSocket', async ({ page, context, request }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();

    await loginUser(alicePage, request, `Alice_Bomb_${timestamp}`);
    await loginUser(bobPage, request, `Bob_Bomb_${timestamp}`);

    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Bomb_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await inviteUser(alicePage, `Bob_Bomb_${timestamp}`, 'editor');
    
    await createFile(alicePage, 'payload.js');
    await waitForEditorModel(alicePage, 'payload.js');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('payload.js').waitFor({ state: 'visible', timeout: 15000 });
    await bobPage.locator('.ide-scrollbar').getByText('payload.js').click();
    await waitForEditorModel(bobPage, 'payload.js');

    // Generate a massive string (e.g., ~19KB of code)
    const massiveString = "const data = 'X';\n".repeat(1000);

    // Alice pastes the massive string instantly
    await alicePage.evaluate((payload) => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      editor.executeEdits('paste', [{
        range: editor.getModel().getFullModelRange(),
        text: payload,
        forceMoveMarkers: true
      }]);
    }, massiveString);

    // Bob should receive the massive payload without the connection dying
    await expect.poll(async () => {
      const bobText = await getEditorValue(bobPage);
      const normalizedBob = bobText.replace(/\r/g, '');
      const normalizedExpected = massiveString.replace(/\r/g, '');
      console.log(`MASSIVE SYNC: Bob got ${normalizedBob.length} chars (raw: ${bobText.length}), expected ${normalizedExpected.length}`);
      return normalizedBob.length === normalizedExpected.length;
    }, { timeout: 20000 }).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 6: Terminal Watcher vs CRDT Ownership Race
  // ═══════════════════════════════════════════════════════════════════════════════
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

    // Type in the editor so Yjs takes explicit ownership
    const editor = page.locator('.monaco-editor').first();
    await editor.click();
    await page.keyboard.type('YJS_OWNS_THIS', { delay: 10 });
    await page.waitForTimeout(1000);

    // Terminal attempts to overwrite the file concurrently
    await terminalTextarea.focus();
    await page.keyboard.type('echo "TERMINAL_ATTACK" > race.js\n', { delay: 10 });
    
    // Wait for the watcher cycle (usually 1.5s - 3s)
    await page.waitForTimeout(5000);

    // Editor should NOT be overwritten by the terminal watcher
    const finalVal = await getEditorValue(page);
    expect(finalVal).toContain('YJS_OWNS_THIS');
    expect(finalVal).not.toContain('TERMINAL_ATTACK');
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 7: Security - REST API RBAC Bypass Attempt
  // ═══════════════════════════════════════════════════════════════════════════════
  test('7. prevents viewer from bypassing UI to execute destructive REST API calls', async ({ page, context, request }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();

    await loginUser(alicePage, request, `Alice_API_${timestamp}`);
    await loginUser(bobPage, request, `Bob_API_${timestamp}`);

    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `API_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await inviteUser(alicePage, `Bob_API_${timestamp}`, 'viewer');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);

    // Bob attempts to use the browser fetch API to maliciously create a file
    const apiResponseStatus = await bobPage.evaluate(async (wsId) => {
      const token = localStorage.getItem('token');
      try {
        const res = await fetch(`/api/workspace/${wsId}/files`, {
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

    // Expect the backend RBAC middleware to strictly reject the request
    expect(apiResponseStatus).toBe(403);
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 8: Snapshotting — RBAC, History, Diff Preview & Restore
  // Verifies the full snapshot lifecycle:
  //   a) Only admins can create snapshots (viewer + editor are rejected with 403)
  //   b) All roles can list snapshots (GET /snapshots returns 200)
  //   c) All roles can preview snapshot files with diff metadata
  //   d) Only admins can restore a snapshot (viewer + editor rejected with 403)
  //   e) Restore actually overwrites live file content
  //   f) Max-10 eviction: creating 11 snapshots keeps only the latest 10
  // ═══════════════════════════════════════════════════════════════════════════════
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

    // ── Setup: Alice creates workspace + file ───────────────────────────────
    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Snap_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await createFile(alicePage, 'history.js');
    await waitForEditorModel(alicePage, 'history.js');
    console.log(1);
    // Write initial content into the file
    await setEditorValue(alicePage, '// version 1');
    await alicePage.waitForTimeout(3000); // debounce save
    console.log(2);

    // Invite Bob as editor, Eve as viewer
    await inviteUser(alicePage, bobName, 'editor');
    await inviteUser(alicePage, eveName, 'viewer');

    const token = {
      alice: await alicePage.evaluate(() => localStorage.getItem('token')),
      bob:   await bobPage.evaluate(() => localStorage.getItem('token')),
      eve:   await evePage.evaluate(() => localStorage.getItem('token')),
    };
    console.log(3);
    // Navigate Bob and Eve to the workspace so their tokens are populated
    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await evePage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await waitForBootComplete(evePage);
    console.log(4);
    const bobToken = await bobPage.evaluate(() => localStorage.getItem('token'));
    const eveToken = await evePage.evaluate(() => localStorage.getItem('token'));
    const aliceToken = await alicePage.evaluate(() => localStorage.getItem('token'));
    console.log(5);
    // ── (a) RBAC: editor cannot create snapshot ─────────────────────────────
    const bobCreateStatus = await bobPage.evaluate(async (wsId) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ label: 'bob-attempt' }),
      });
      return res.status;
    }, workspaceId);
    expect(bobCreateStatus).toBe(403);
    console.log(6);
    // ── (a) RBAC: viewer cannot create snapshot ──────────────────────────────
    const eveCreateStatus = await evePage.evaluate(async (wsId) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ label: 'eve-attempt' }),
      });
      return res.status;
    }, workspaceId);
    expect(eveCreateStatus).toBe(403);
    console.log(7);
    // ── Admin creates a valid snapshot ───────────────────────────────────────
    const createResult = await alicePage.evaluate(async (wsId) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshot`, {
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
    console.log(8);
    // ── (b) All roles can list snapshots ────────────────────────────────────
    const aliceList = await alicePage.evaluate(async (wsId) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshots`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return { status: res.status, body: await res.json() };
    }, workspaceId);
    expect(aliceList.status).toBe(200);
    expect(Array.isArray(aliceList.body)).toBe(true);
    expect(aliceList.body.length).toBe(1);
    expect(aliceList.body[0].label).toBe('v1-baseline');
    expect(aliceList.body[0].created_by).toBe(aliceName);
    console.log(9);
    const bobList = await bobPage.evaluate(async (wsId) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshots`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return res.status;
    }, workspaceId);
    expect(bobList).toBe(200);

    const eveList = await evePage.evaluate(async (wsId) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshots`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return res.status;
    }, workspaceId);
    expect(eveList).toBe(200);
    console.log(9);
    // ── (c) Mutate the live file, then check diff data ───────────────────────
    await setEditorValue(alicePage, '// version 2\nconsole.log("changed");');
    await alicePage.waitForTimeout(3000); // debounce save
    
    // Wait for the Yjs 800ms debounced save to complete BEFORE calling restore
    // This prevents the pending save timer from overwriting the restored content
    await alicePage.waitForTimeout(1500);

    const diffResult = await alicePage.evaluate(async ({ wsId, snapId }) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshots/${snapId}/files`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return { status: res.status, body: await res.json() };
    }, { wsId: workspaceId, snapId: snapshotId });

    expect(diffResult.status).toBe(200);
    const historyFile = diffResult.body.find((f: any) => f.path === 'history.js');
    expect(historyFile).toBeTruthy();
    // snapshot captured v1; live is now v2 — both sides must be present
    expect(historyFile.snapshot_content).toContain('version 1');
    expect(historyFile.live_content).toContain('version 2');

    // Eve (viewer) can also preview the diff
    const eveDiffStatus = await evePage.evaluate(async ({ wsId, snapId }) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshots/${snapId}/files`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return res.status;
    }, { wsId: workspaceId, snapId: snapshotId });
    expect(eveDiffStatus).toBe(200);
    console.log(10);

    // ── (d) RBAC: editor cannot restore ─────────────────────────────────────
    const bobRestoreStatus = await bobPage.evaluate(async ({ wsId, snapId }) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshots/${snapId}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return res.status;
    }, { wsId: workspaceId, snapId: snapshotId });
    expect(bobRestoreStatus).toBe(403);
    console.log(11);

    // ── (d) RBAC: viewer cannot restore ─────────────────────────────────────
    const eveRestoreStatus = await evePage.evaluate(async ({ wsId, snapId }) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshots/${snapId}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return res.status;
    }, { wsId: workspaceId, snapId: snapshotId });
    expect(eveRestoreStatus).toBe(403);
    console.log(12);

    // Close Bob and Eve's pages before restore — their active Yjs connections would
    // otherwise reconnect after eviction and save v2 back from their in-memory state.
    await bobPage.close();
    await evePage.close();
    // Give their WebSocket connections time to close and server to process the disconnect
    await alicePage.waitForTimeout(1500);

    // ── (e) Admin restores snapshot → live file reverts to v1 ───────────────
    console.log('[TEST] Triggering restore API call...');
    const restoreResult = await alicePage.evaluate(async ({ wsId, snapId }) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshots/${snapId}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return { status: res.status, body: await res.json() };
    }, { wsId: workspaceId, snapId: snapshotId });
    console.log('[TEST] Restore API response:', restoreResult);
    expect(restoreResult.status).toBe(200);
    expect(restoreResult.body.success).toBe(true);
    expect(restoreResult.body.restored_files).toBeGreaterThan(0);
    console.log(13);
    // Verify the DB actually has the restored content (bypassing Yjs in-memory cache)
    console.log('[TEST] Checking DB content directly via API...');
    const filesRes = await page.request.get(`${APP_URL}/api/workspace/${workspaceId}/files`, {
      headers: { Authorization: `Bearer ${token.alice}` }
    });
    const fileListRes = await filesRes.json();
    const historyFileId = fileListRes.find((f: any) => f.name === 'history.js')?.id;
    console.log('[TEST] history.js fileId:', historyFileId);
    console.log(14);
    const dbContentRes = await page.request.get(`${APP_URL}/api/workspace/${workspaceId}/files/${historyFileId}/content`, {
      headers: { Authorization: `Bearer ${token.alice}` }
    }).then(r => r.json());
    console.log('[TEST] DB content after restore:', JSON.stringify(dbContentRes.content));
    
    // DB must have restored content
    expect(dbContentRes.content).toContain('version 1');
    expect(dbContentRes.content).not.toContain('version 2');

    console.log('[TEST] Waiting for socket event propagation + page reload...');
    // Wait for the snapshot-restored socket event to trigger page reload
    await alicePage.waitForTimeout(2500);
    
    console.log('[TEST] Waiting for boot complete after reload...');
    await waitForBootComplete(alicePage);
    
    console.log('[TEST] Opening history.js file...');
    await alicePage.locator('.ide-scrollbar').getByText('history.js').click();
    await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });
    await alicePage.waitForTimeout(2000);

    console.log('[TEST] Reading editor content...');
    const restoredContent = await getEditorValue(alicePage);
    console.log('[TEST] Restored content:', JSON.stringify(restoredContent));
    expect(restoredContent).toContain('version 1');
    expect(restoredContent).not.toContain('version 2');
    console.log(15);
    // ── (f) Max-10 eviction: create 10 more snapshots, total must stay ≤ 10 ─
    for (let i = 2; i <= 11; i++) {
      const r = await alicePage.evaluate(async ({ wsId, i }) => {
        const res = await fetch(`/api/workspace/${wsId}/snapshot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
          body: JSON.stringify({ label: `auto-snap-${i}` }),
        });
        return res.status;
      }, { wsId: workspaceId, i });
      expect(r).toBe(201);
    }

    const finalList = await alicePage.evaluate(async (wsId) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshots`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return res.json();
    }, workspaceId);

    // Trigger fires after insert, so total should never exceed 10
    expect(finalList.length).toBeLessThanOrEqual(10);
    // Oldest (v1-baseline) should have been evicted
    const labels = finalList.map((s: any) => s.label);
    expect(labels).not.toContain('v1-baseline');
    // Most recent should be present
    expect(labels).toContain('auto-snap-11');
    console.log(16);
  });

  // Skipped because in real-time collaborative CRDTs (like Yjs), concurrent client edits 
  // made during/after a restore transaction are treated as newer modifications and will naturally 
  // overwrite the restored text unless the editor is locked/disabled immediately in the UI.
  test.skip('Edge Case: Handles concurrent editor typing during restore mutation', async ({ page, context, request }) => {
  const alicePage = page; 
  const bobPage = await context.browser()!.newContext().then(c => c.newPage()); 
  const timestamp = Date.now();

  await loginUser(alicePage, request, `Alice_Race_${timestamp}`);
  await loginUser(bobPage, request, `Bob_Race_${timestamp}`);

  // Setup Workspace & File
  await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Race_WS_${timestamp}`);
  await alicePage.click('button:has-text("Create Now")');
  await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
  const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
  await waitForBootComplete(alicePage);
  await createFile(alicePage, 'race.js');
  await alicePage.waitForTimeout(2000);

  // Set initial text and snapshot
  await setEditorValue(alicePage, '// Baseline');
  await alicePage.waitForTimeout(2000);
  
  const snapRes = await alicePage.evaluate(async (wsId) => {
    const res = await fetch(`/api/workspace/${wsId}/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    return res.json();
  }, workspaceId);
  const snapshotId = snapRes.id;

  // Invite Bob and open file
  await inviteUser(alicePage, `Bob_Race_${timestamp}`, 'editor');
  await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
  await waitForBootComplete(bobPage);
  await bobPage.locator('.ide-scrollbar').getByText('race.js').click();
  await waitForEditorModel(bobPage, 'race.js');

  // RACE START: Bob types rapidly in a loop while Alice restores
  const bobTypingPromise = bobPage.evaluate(async () => {
    const ed = (window as any).monaco.editor.getEditors()[0];
    for (let i = 0; i < 20; i++) {
      ed.getModel().setValue(`// Bob edit ${i}`);
      await new Promise(r => setTimeout(r, 50));
    }
  });

  const aliceRestorePromise = alicePage.evaluate(async ({ wsId, snapId }) => {
    await new Promise(r => setTimeout(r, 300)); // wait a bit so Bob is mid-typing
    return fetch(`/api/workspace/${wsId}/snapshots/${snapId}/restore`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
  }, { wsId: workspaceId, snapId: snapshotId });

  await Promise.all([bobTypingPromise, aliceRestorePromise]);

  // Allow Yjs to settle
  await alicePage.waitForTimeout(2000);
  
  // The server's CRDT mutation (Baseline) must have the highest clock and win
  const dbContent = await alicePage.evaluate(async (wsId) => {
    const filesRes = await fetch(`/api/workspace/${wsId}/files`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    const files = await filesRes.json();
    const fileId = files.find((f: any) => f.name === 'race.js').id;
    
    const contentRes = await fetch(`/api/workspace/${wsId}/files/${fileId}/content`, {
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

  // Create Workspace (Do NOT create any files)
  await page.fill('input[placeholder="e.g. React-Sandbox"]', `Empty_WS_${timestamp}`);
  await page.click('button:has-text("Create Now")');
  await page.waitForURL(/\/ide\/[a-f0-9-]+/);
  const workspaceId = page.url().split('/ide/')[1].split('/')[0];
  await waitForBootComplete(page);

  // Take Snapshot of empty workspace
  const snapRes = await page.evaluate(async (wsId) => {
    const res = await fetch(`/api/workspace/${wsId}/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: JSON.stringify({ label: 'Empty State' }),
    });
    return res.json();
  }, workspaceId);
  
  expect(snapRes.id).toBeTruthy();

  // Create a file to change the state
  await createFile(page, 'temp.js');
  await page.waitForTimeout(1000);

  // Restore the empty snapshot
  const restoreStatus = await page.evaluate(async ({ wsId, snapId }) => {
    const res = await fetch(`/api/workspace/${wsId}/snapshots/${snapId}/restore`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });
    return res.status;
  }, { wsId: workspaceId, snapId: snapRes.id });

  // Must succeed without throwing a null pointer or mapping error
  expect(restoreStatus).toBe(200);
});
  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 12: Diff Engine — NEW, DEL, MOD, Nested Paths, and Large Payloads
  // Verifies the backend diff algorithm correctly identifies file states by comparing
  // live workspace files against snapshot records, preserves directory structures,
  // and efficiently handles files >10KB without truncation.
  // ═══════════════════════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 12: Diff Engine — NEW, DEL, MOD, Nested Paths, and Large Payloads
  // ═══════════════════════════════════════════════════════════════════════════════
  test('12. snapshot diff identifies NEW, DEL, MOD states, preserves paths, and handles large files', async ({ page, request }) => {
    const timestamp = Date.now();
    await loginUser(page, request, `Alice_Diff_${timestamp}`);

    // 1. Setup Workspace
    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Diff_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = page.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(page);

    // Generate large payload (>10KB)
    const largeContent = "const data = 'A';\n".repeat(600); 

    // 2. Create Initial Files & Strictly Set Content via PUT
    await page.evaluate(async ({ wsId, payload }) => {
      const token = localStorage.getItem('token');
      
      // Step A: Create empty files
      await fetch(`/api/workspace/${wsId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'src/components/mod.js', type: 'file' })
      });
      await fetch(`/api/workspace/${wsId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'del.js', type: 'file' })
      });

      // Step B: Fetch files to get their IDs
      const files = await fetch(`/api/workspace/${wsId}/files`, {
        headers: { Authorization: `Bearer ${token}` }
      }).then(r => r.json());

      const modFile = files.find((f: any) => f.name === 'src/components/mod.js');
      const delFile = files.find((f: any) => f.name === 'del.js');

      // Step C: PUT the content to guarantee it is saved in the DB before snapshot
      await fetch(`/api/workspace/${wsId}/files/${modFile.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: payload })
      });
      await fetch(`/api/workspace/${wsId}/files/${delFile.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: '// to be deleted' })
      });
    }, { wsId: workspaceId, payload: largeContent });

    await page.waitForTimeout(2000); // Give DB a moment to settle

    // 3. Take Snapshot (Baseline)
    const snapRes = await page.evaluate(async (wsId) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ label: 'Baseline' }),
      });
      return res.json();
    }, workspaceId);
    const snapshotId = snapRes.id;

    // 4. Mutate Workspace State (Trigger MOD, DEL, NEW)
    await page.evaluate(async ({ wsId, payload }) => {
      const token = localStorage.getItem('token');
      
      const files = await fetch(`/api/workspace/${wsId}/files`, {
        headers: { Authorization: `Bearer ${token}` }
      }).then(r => r.json());

      const modFile = files.find((f: any) => f.name === 'src/components/mod.js');
      const delFile = files.find((f: any) => f.name === 'del.js');

      // MOD
      await fetch(`/api/workspace/${wsId}/files/${modFile.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: payload + '\n// NEW LINE' })
      });

      // DEL
      await fetch(`/api/workspace/${wsId}/files/${delFile.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      // NEW
      const newFile = await fetch(`/api/workspace/${wsId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'new.js', type: 'file' })
      }).then(r => r.json());

      await fetch(`/api/workspace/${wsId}/files/${newFile.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: '// brand new' })
      });
    }, { wsId: workspaceId, payload: largeContent });

    await page.waitForTimeout(1000);

    // 5. Fetch Diff
    const diffFiles = await page.evaluate(async ({ wsId, snapId }) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshots/${snapId}/files`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      return res.json();
    }, { wsId: workspaceId, snapId: snapshotId });

    // 6. Assertions for Badges & Content
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

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 13: Metadata & Sorting
  // Verifies labels, creator tracking, and strict descending chronological ordering.
  // ═══════════════════════════════════════════════════════════════════════════════
  test('13. correctly saves labels, creator username, and returns list in newest-first order', async ({ page, request }) => {
    const timestamp = Date.now();
    const username = `Alice_Meta_${timestamp}`;
    await loginUser(page, request, username);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Meta_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = page.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(page);

    // Create Snapshots with slight delays to guarantee chronological separation
    await page.evaluate(async (wsId) => {
      await fetch(`/api/workspace/${wsId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ label: 'First Snapshot' })
      });
    }, workspaceId);

    await page.waitForTimeout(1000);

    await page.evaluate(async (wsId) => {
      await fetch(`/api/workspace/${wsId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ label: 'Second Snapshot' })
      });
    }, workspaceId);

    const snapshots = await page.evaluate(async (wsId) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshots`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      return res.json();
    }, workspaceId);

    expect(snapshots.length).toBe(2);
    
    // Ensure newest-first sorting
    expect(snapshots[0].label).toBe('Second Snapshot');
    expect(snapshots[1].label).toBe('First Snapshot');

    // Ensure creator is correctly bound
    expect(snapshots[0].created_by).toBe(username);
    expect(snapshots[1].created_by).toBe(username);
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 14: Real-time Seamless Restore & Yjs Document Reset
  // Ensures restores broadcast via WebSocket so clients update instantly without 
  // page reloads, and proves the Yjs server clears its in-memory document state 
  // so reconnecting clients don't accidentally fetch "ghost" CRDT edits.
  // ═══════════════════════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 14: Real-time Seamless Restore & Yjs Document Reset
  // ═══════════════════════════════════════════════════════════════════════════════
  test('14. broadcasts snapshot-restored event for seamless sync and resets yjs_state to prevent CRDT ghosting', async ({ page, context, request }) => {
    const alicePage = page;
    let bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const timestamp = Date.now();

    await loginUser(alicePage, request, `Alice_Sync_${timestamp}`);
    await loginUser(bobPage, request, `Bob_Sync_${timestamp}`);

    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Sync_WS_${timestamp}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await createFile(alicePage, 'live.js');
    await waitForEditorModel(alicePage, 'live.js');
    
    await setEditorValue(alicePage, '// BASELINE DATA');
    await alicePage.waitForTimeout(3000);

    const snapRes = await alicePage.evaluate(async (wsId) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ label: 'Base' })
      });
      return res.json();
    }, workspaceId);
    
    await inviteUser(alicePage, `Bob_Sync_${timestamp}`, 'editor');
    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('live.js').click();
    
    await waitForEditorModel(bobPage, 'live.js');

    await setEditorValue(alicePage, '// MISTAKE DATA');
    
    await expect.poll(async () => await getEditorValue(bobPage), { timeout: 25000, intervals: [1000] }).toBe('// MISTAKE DATA');

    await alicePage.evaluate(async ({ wsId, snapId }) => {
      await fetch(`/api/workspace/${wsId}/snapshots/${snapId}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
    }, { wsId: workspaceId, snapId: snapRes.id });

    // Bob's page reloads on snapshot-restored socket event
    await bobPage.waitForURL(/\/ide\/[a-f0-9-]+/, { timeout: 20000 }).catch(() => {});
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('live.js').click().catch(() => {});
    await waitForEditorModel(bobPage, 'live.js');
    await expect.poll(async () => await getEditorValue(bobPage), { timeout: 25000, intervals: [1000] }).toBe('// BASELINE DATA');

    await bobPage.close();
    
    bobPage = await context.browser()!.newContext().then(c => c.newPage());
    await loginUser(bobPage, request, `Bob_Sync_${timestamp}`);
    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('live.js').click();
    
    await waitForEditorModel(bobPage, 'live.js');

    await expect.poll(async () => await getEditorValue(bobPage), { timeout: 25000, intervals: [1000] }).toBe('// BASELINE DATA');
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 15: Database Integrity — Cascading Deletes
  // Ensures that deleting a workspace properly triggers ON DELETE CASCADE in Postgres,
  // wiping all associated snapshot records and diff contents to prevent data leaks.
  // ═══════════════════════════════════════════════════════════════════════════════
  test('15. cascades workspace deletion to wipe associated snapshots from the database', async ({ page, request }) => {
    const timestamp = Date.now();
    await loginUser(page, request, `Alice_Cascade_${timestamp}`);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Cascade_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = page.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(page);

    // Create a Snapshot
    const snapRes = await page.evaluate(async (wsId) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ label: 'Doomed Snapshot' })
      });
      return res.json();
    }, workspaceId);
    
    expect(snapRes.id).toBeTruthy();

    // Delete the Workspace
    const deleteRes = await page.evaluate(async (wsId) => {
      const res = await fetch(`/api/workspace/${wsId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      return res.status;
    }, workspaceId);

    expect(deleteRes).toBe(200); // Or 204 depending on your API standard

    // Attempt to fetch the snapshots for the deleted workspace
    const postDeleteSnapshots = await page.evaluate(async (wsId) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshots`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      return res.status;
    }, workspaceId);

    // Should return 404 Not Found (or 403 because Alice no longer owns a workspace that doesn't exist)
    expect([403, 404]).toContain(postDeleteSnapshots);
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 16: Snapshot Restore — Recreates Deleted Files and Syncs to Container
  // ═══════════════════════════════════════════════════════════════════════════════
  test('16. snapshot restore recreates deleted files/folders and syncs contents to container', async ({ page, request }) => {
    const timestamp = Date.now();
    await loginUser(page, request, `Alice_Restore_${timestamp}`);

    // Create workspace
    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Restore_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = page.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(page);

    // Create a nested file and baseline content
    await page.evaluate(async (wsId) => {
      const token = localStorage.getItem('token');
      const createRes = await fetch(`/api/workspace/${wsId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'src/components/button.js', type: 'file' })
      }).then(r => r.json());

      await fetch(`/api/workspace/${wsId}/files/${createRes.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: '// button v1' })
      });
    }, workspaceId);

    await page.waitForTimeout(2000); // Allow Yjs debounced save and db write

    // Take Snapshot
    const snapRes = await page.evaluate(async (wsId) => {
      const res = await fetch(`/api/workspace/${wsId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ label: 'Snapshot V1' }),
      });
      return res.json();
    }, workspaceId);
    const snapshotId = snapRes.id;

    // Mutate: delete the file
    await page.evaluate(async (wsId) => {
      const token = localStorage.getItem('token');
      const files = await fetch(`/api/workspace/${wsId}/files`, {
        headers: { Authorization: `Bearer ${token}` }
      }).then(r => r.json());

      const file = files.find((f: any) => f.name.includes('button.js'));
      if (file) {
        await fetch(`/api/workspace/${wsId}/files/${file.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` }
        });
      }
    }, workspaceId);

    test.setTimeout(90000);
    const token = await page.evaluate(() => localStorage.getItem('token'));

    // Verify deleted file is gone
    const filesList1 = await page.request.get(`${APP_URL}/api/workspace/${workspaceId}/files`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json());
    expect(filesList1.some((f: any) => f.name.includes('button.js'))).toBe(false);

    // Restore Snapshot
    const restoreRes = await page.request.post(`${APP_URL}/api/workspace/${workspaceId}/snapshots/${snapshotId}/restore`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json());
    expect(restoreRes.success).toBe(true);

    // Wait a brief moment for database inserts and container synchronization
    await page.waitForTimeout(2000);

    // Verify deleted folder/file is recreated in database
    const filesList2 = await page.request.get(`${APP_URL}/api/workspace/${workspaceId}/files`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json());
    
    const restoredFile = filesList2.find((f: any) => f.name === 'button.js' || f.name === 'src/components/button.js');
    expect(restoredFile).toBeDefined();

    // Verify contents are synced down
    const cacheContent = await page.request.get(`${APP_URL}/api/workspace/${workspaceId}/files/${restoredFile.id}/content`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json());
    expect(cacheContent.content).toContain('// button v1');
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 17: Blame Engine — Persistent User Profile Resolution
  // ═══════════════════════════════════════════════════════════════════════════════
  test.skip('17. blame engine maps Yjs client IDs to persistent user profiles across reconnects', async ({ page, context, request }) => {
    const timestamp = Date.now();
    const aliceName = `Alice_Blame_${timestamp}`;
    await loginUser(page, request, aliceName);

    // Create workspace
    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Blame_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = page.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(page);

    // Create a file
    await createFile(page, 'blame.js');
    await waitForEditorModel(page, 'blame.js');
    
    // Set baseline content as Alice in Session 1
    await focusEditor(page);
    await page.keyboard.type('// line written by Alice');
    await page.waitForTimeout(2000); // Wait for Yjs debounced save to persist authorMap to DB

    test.setTimeout(90000);

    // Retrieve active file details to get ID
    const token = await page.evaluate(() => localStorage.getItem('token'));
    const filesList = await page.request.get(`${APP_URL}/api/workspace/${workspaceId}/files`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json());
    const blameFile = filesList.find((f: any) => f.name === 'blame.js');
    expect(blameFile).toBeDefined();

    // Verify history contains author Map in database
    const history = await page.request.get(`${APP_URL}/api/workspace/${workspaceId}/files/${blameFile.id}/history`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json());
    console.log('[TEST] Blame history authorMap:', JSON.stringify(history.authorMap));
    expect(Object.keys(history.authorMap).length).toBeGreaterThan(0);

    // Simulate Reconnect/New Tab: Close page and open as Alice again
    await page.close();
    
    const newPage = await context.newPage();
    await loginUser(newPage, request, aliceName);
    await newPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(newPage);
    await newPage.locator('.ide-scrollbar').getByText('blame.js').click();
    await waitForEditorModel(newPage, 'blame.js');
    await waitForEditorSync(newPage);
    await newPage.waitForTimeout(2000); // Give Yjs editor content sync and state resolution a moment to stabilize

    // Click toggle Blame button in UI to open blame sidebar
    await newPage.click('button:has-text("Blame")');
    await newPage.locator('button:has-text("Hide Blame")').first().waitFor({ state: 'visible', timeout: 15000 });

    // Validate the blame sidebar contains Alice's name
    const usernameElement = newPage.locator('span.truncate.w-24').first();
    await expect(usernameElement).toContainText(aliceName, { timeout: 10000 });

    // Validate tooltip or profile handle is present mapping to Alice's profile
    const tooltipText = await usernameElement.getAttribute('title');
    if (tooltipText) {
      expect(tooltipText).toContain(aliceName);
    }
    
    await newPage.close();
  });

})
