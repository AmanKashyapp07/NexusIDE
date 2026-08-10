import { test, expect } from '@playwright/test';
import {
  loginUser,
  inviteUser,
  createFile,
  waitForBootComplete,
  waitForEditorModel,
  typeTextInMonaco,
  getEditorValue,
  waitForTerminalText,
  extractWorkspaceId,
  APP_URL,
} from '../test-utils';

test.describe('File Rename Engine Suite', () => {
  test('syncs live file rename across collaborators without breaking WebSocket sync or CRDT state', async ({ page, context, request }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    
    try {
      const bobPage = await bobContext.newPage();
      const timestamp = Date.now();

      // 1. Authenticate Alice & Create Workspace
      await loginUser(alicePage, request, `Alice_Rename_${timestamp}`);
      await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Rename_WS_${timestamp}`);
      await alicePage.click('button:has-text("Create Now")');
      await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
      const workspaceId = extractWorkspaceId(alicePage.url());
      await waitForBootComplete(alicePage);

      // 2. Create original file
      await createFile(alicePage, 'original.js');
      await waitForEditorModel(alicePage, 'original.js');

      // 3. Authenticate Bob & Invite to Workspace
      await loginUser(bobPage, request, `Bob_Rename_${timestamp}`);
      await inviteUser(alicePage, `Bob_Rename_${timestamp}`, 'editor');
      await bobPage.goto(`${APP_URL}/${workspaceId}`);
      await waitForBootComplete(bobPage);

      // 4. Bob opens original.js and types pre-rename text
      await bobPage.locator('.ide-scrollbar').getByText('original.js').waitFor({ state: 'visible', timeout: 30000 });
      await bobPage.locator('.ide-scrollbar').getByText('original.js').click();
      await waitForEditorModel(bobPage, 'original.js');
      
      await typeTextInMonaco(bobPage, '// content before rename\n');

      // 5. Verify Alice receives initial content via Yjs WebSocket
      await alicePage.bringToFront();
      await expect.poll(async () => await getEditorValue(alicePage), { timeout: 25000, intervals: [1000] })
        .toContain('content before rename');

      // 6. Alice executes terminal rename `mv original.js renamed.js`
      const aliceTerminalTextarea = alicePage.locator('.xterm-helper-textarea');
      await aliceTerminalTextarea.waitFor({ state: 'attached', timeout: 30000 });
      await aliceTerminalTextarea.focus();
      await aliceTerminalTextarea.click({ force: true });
      await alicePage.keyboard.press('Enter');
      await waitForTerminalText(alicePage, 'sandbox:~#', 30000);
      await alicePage.keyboard.type('mv original.js renamed.js', { delay: 30 });
      await alicePage.keyboard.press('Enter');
      await waitForTerminalText(alicePage, 'sandbox:~#', 20000);

      // 7. Verify file tree updates for both clients
      await expect.poll(async () => {
        return await bobPage.locator('.ide-scrollbar').getByText('renamed.js').isVisible();
      }, { timeout: 35000, intervals: [1000] }).toBe(true);

      // 8. Select renamed file on Bob and type post-rename text
      await bobPage.bringToFront();
      await bobPage.locator('.ide-scrollbar').getByText('renamed.js').click();
      await typeTextInMonaco(bobPage, '// content AFTER rename\n');

      // 9. Verify Alice receives post-rename edits live
      await alicePage.bringToFront();
      await expect.poll(async () => await getEditorValue(alicePage), { timeout: 25000, intervals: [1000] })
        .toContain('content AFTER rename');

    } finally {
      await bobContext.close().catch(() => {});
    }
  });
});
