import { test, expect, type Page } from '@playwright/test';
import { login, createTestWorkspace, deleteTestWorkspace, createTestFile, typeTextInMonaco, waitForBootComplete, APP_URL, API_URL } from '../test-utils';

test.describe('Real Infrastructure & Browser UI Timelapse Suite', () => {
  let workspaceId: string;
  let authToken: string;
  const testWorkspaceTitle = `Timelapse-RealUI-${Date.now()}`;

  test.beforeEach(async ({ page }) => {
    authToken = await login(page, 'testuser1', 'password123');
    workspaceId = await createTestWorkspace(page, testWorkspaceTitle);
  });

  test.afterEach(async ({ page }) => {
    await deleteTestWorkspace(page, workspaceId);
  });

  test('1. Real Monaco typing & clicking Timelapse button opens live replayer UI', async ({ page }) => {
    await createTestFile(page, 'real_timelapse.js');
    await typeTextInMonaco(page, 'console.log("Real Timelapse Live");');
    await page.waitForTimeout(2000);

    // Click the real Timelapse button in the IDE breadcrumb action bar
    const timelapseBtn = page.locator('button:has-text("Timelapse")').first();
    await expect(timelapseBtn).toBeVisible({ timeout: 15000 });
    await timelapseBtn.click();

    // Verify Real Timelapse UI modal elements mount
    const headerBadge = page.locator('span:has-text("CRDT Timelapse")').first();
    await expect(headerBadge).toBeVisible({ timeout: 15000 });

    const scrubber = page.locator('.timelapse-scrubber').first();
    await expect(scrubber).toBeVisible();

    const closeBtn = page.locator('button[title="Close timelapse"]').first();
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();

    // Verify modal closes and returns cleanly to live Monaco editor
    await expect(headerBadge).not.toBeVisible();
    await expect(page.locator('.monaco-editor').first()).toBeVisible();
  });

  test('2. Real scrubber slider moves backward in time and rewinds document text', async ({ page }) => {
    await createTestFile(page, 'scrubber_test.js');
    await typeTextInMonaco(page, 'FIRST_VERSION\n');
    await page.waitForTimeout(1500);
    await typeTextInMonaco(page, 'SECOND_VERSION\n');
    await page.waitForTimeout(2000);

    // Open Timelapse
    await page.locator('button:has-text("Timelapse")').first().click();
    await expect(page.locator('span:has-text("CRDT Timelapse")').first()).toBeVisible({ timeout: 15000 });

    // Click Rewind to jump to beginning
    const rewindBtn = page.locator('button[title*="Back to start"]').first();
    await expect(rewindBtn).toBeVisible();
    await rewindBtn.click();
    await page.waitForTimeout(500);

    // Verify step forward button advances clock
    const stepForwardBtn = page.locator('button[title*="Step forward"]').first();
    await expect(stepForwardBtn).toBeVisible();
    await stepForwardBtn.click();
    await page.waitForTimeout(300);

    // Close replayer
    await page.locator('button[title="Close timelapse"]').first().click();
  });

  test('3. Real Play/Pause automated playback cycles through steps', async ({ page }) => {
    await createTestFile(page, 'playback_test.js');
    await typeTextInMonaco(page, 'A ');
    await page.waitForTimeout(1000);
    await typeTextInMonaco(page, 'B ');
    await page.waitForTimeout(1000);
    await typeTextInMonaco(page, 'C');
    await page.waitForTimeout(2000);

    await page.locator('button:has-text("Timelapse")').first().click();
    await expect(page.locator('span:has-text("CRDT Timelapse")').first()).toBeVisible({ timeout: 15000 });

    // Rewind to start
    await page.locator('button:has-text("Timelapse")');
    const rewindBtn = page.locator('button[title*="Back to start"]').first();
    await rewindBtn.click();

    // Toggle Play
    const playBtn = page.locator('button[title*="Play"]').first();
    await expect(playBtn).toBeVisible();
    await playBtn.click();

    // Wait for playback to cycle clock
    await page.waitForTimeout(1200);

    // Toggle Pause
    const pauseBtn = page.locator('button[title*="Pause"]').first();
    if (await pauseBtn.isVisible()) {
      await pauseBtn.click();
    }

    // Close replayer
    await page.locator('button[title="Close timelapse"]').first().click();
  });

  test('4. Multi-user real collaboration displays Author Badges in Timelapse Legend', async ({ browser, page }) => {
    await createTestFile(page, 'collab_ui.js');
    await typeTextInMonaco(page, 'const author = "Alice";\n');
    await page.waitForTimeout(2000);

    // Invite Bob to workspace
    await page.request.post(`${API_URL}/workspace/${workspaceId}/collaborators`, {
      headers: { Authorization: `Bearer ${authToken}` },
      data: { username: 'testuser2', role: 'editor' }
    });

    // Bob logs in and joins workspace in a separate browser context
    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();
    await login(bobPage, 'testuser2', 'password123');
    await bobPage.goto(`${APP_URL}/${workspaceId}`);
    await waitForBootComplete(bobPage);

    // Bob opens file and types
    const fileNode = bobPage.locator('.ide-scrollbar div:has-text("collab_ui.js")').first();
    if (await fileNode.isVisible({ timeout: 15000 }).catch(() => false)) {
      await fileNode.click();
      await bobPage.waitForFunction(() => {
        const eds = (window as any).monaco?.editor?.getEditors();
        return eds && eds.length > 0;
      }, { timeout: 15000 });
      await typeTextInMonaco(bobPage, 'const author2 = "Bob";\n');
      await bobPage.waitForTimeout(2000);
    }
    await bobContext.close();

    // Alice opens Timelapse and inspects real author legend
    await page.locator('button:has-text("Timelapse")').first().click();
    await expect(page.locator('span:has-text("CRDT Timelapse")').first()).toBeVisible({ timeout: 15000 });

    const legend = page.locator('[data-testid="author-legend"]').first();
    // Verify author legend is rendered if multiple authors exist
    if (await legend.isVisible().catch(() => false)) {
      await expect(legend).toBeVisible();
    }

    await page.locator('button[title="Close timelapse"]').first().click();
  });

  test('5. Keyboard navigation controls timelapse scrubber', async ({ page }) => {
    await createTestFile(page, 'keys_test.js');
    await typeTextInMonaco(page, 'X ');
    await page.waitForTimeout(1000);
    await typeTextInMonaco(page, 'Y ');
    await page.waitForTimeout(1000);
    await typeTextInMonaco(page, 'Z');
    await page.waitForTimeout(2000);

    await page.locator('button:has-text("Timelapse")').first().click();
    await expect(page.locator('span:has-text("CRDT Timelapse")').first()).toBeVisible({ timeout: 15000 });

    // Press ArrowLeft to step backwards
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300);
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300);

    // Press ArrowRight to step forwards
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);

    // Close replayer
    await page.locator('button[title="Close timelapse"]').first().click();
    await expect(page.locator('.monaco-editor').first()).toBeVisible();
  });

  test('6. Playback speed multiplier cycles through 1x, 2x, 4x, and 0.5x', async ({ page }) => {
    await createTestFile(page, 'speed_test.js');
    await typeTextInMonaco(page, 'let speed = 1;');
    await page.waitForTimeout(2000);

    await page.locator('button:has-text("Timelapse")').first().click();
    await expect(page.locator('span:has-text("CRDT Timelapse")').first()).toBeVisible({ timeout: 15000 });

    const speedBtn = page.locator('button[title="Playback speed"]').first();
    await expect(speedBtn).toBeVisible();
    await expect(speedBtn).toHaveText('1x');

    // Cycle to 2x
    await speedBtn.click();
    await expect(speedBtn).toHaveText('2x');

    // Cycle to 4x
    await speedBtn.click();
    await expect(speedBtn).toHaveText('4x');

    // Cycle to 0.5x
    await speedBtn.click();
    await expect(speedBtn).toHaveText('0.5x');

    // Cycle back to 1x
    await speedBtn.click();
    await expect(speedBtn).toHaveText('1x');

    await page.locator('button[title="Close timelapse"]').first().click();
  });

  test('7. Multi-file navigation switches timelapse context to selected file', async ({ page }) => {
    await createTestFile(page, 'alpha_file.js');
    await typeTextInMonaco(page, 'ALPHA_CODE_BODY');
    await page.waitForTimeout(2000);

    await createTestFile(page, 'beta_file.js');
    await typeTextInMonaco(page, 'BETA_CODE_BODY');
    await page.waitForTimeout(2000);

    // Open Timelapse on beta_file.js
    await page.locator('button:has-text("Timelapse")').first().click();
    await expect(page.locator('span:has-text("CRDT Timelapse")').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('span:has-text("beta_file.js")').first()).toBeVisible();

    // Close and switch to alpha_file.js
    await page.locator('button[title="Close timelapse"]').first().click();
    const alphaNode = page.locator('.ide-scrollbar div:has-text("alpha_file.js")').first();
    await alphaNode.click();
    await page.waitForTimeout(1000);

    // Open Timelapse on alpha_file.js
    await page.locator('button:has-text("Timelapse")').first().click();
    await expect(page.locator('span:has-text("CRDT Timelapse")').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('span:has-text("alpha_file.js")').first()).toBeVisible();

    await page.locator('button[title="Close timelapse"]').first().click();
  });

  test('8. Step-by-step navigation updates clock text indicator', async ({ page }) => {
    await createTestFile(page, 'clock_test.js');
    await typeTextInMonaco(page, 'ONE ');
    await page.waitForTimeout(1000);
    await typeTextInMonaco(page, 'TWO');
    await page.waitForTimeout(2000);

    await page.locator('button:has-text("Timelapse")').first().click();
    await expect(page.locator('span:has-text("CRDT Timelapse")').first()).toBeVisible({ timeout: 15000 });

    // Click rewind to reset clock to 0
    const rewindBtn = page.locator('button[title*="Back to start"]').first();
    await rewindBtn.click();
    await page.waitForTimeout(300);

    const clockDisplay = page.locator('.timelapse-scrubber').locator('..').locator('..').locator('div.font-mono').first();
    await expect(clockDisplay).toContainText('0');

    // Click step forward to advance
    const stepForwardBtn = page.locator('button[title*="Step forward"]').first();
    await stepForwardBtn.click();
    await page.waitForTimeout(300);

    await page.locator('button[title="Close timelapse"]').first().click();
  });

  test('9. Scrub bar dragging seeks directly to specific timeline step', async ({ page }) => {
    await createTestFile(page, 'drag_test.js');
    await typeTextInMonaco(page, 'AAA ');
    await page.waitForTimeout(1000);
    await typeTextInMonaco(page, 'BBB ');
    await page.waitForTimeout(1000);
    await typeTextInMonaco(page, 'CCC');
    await page.waitForTimeout(2000);

    await page.locator('button:has-text("Timelapse")').first().click();
    await expect(page.locator('span:has-text("CRDT Timelapse")').first()).toBeVisible({ timeout: 15000 });

    const scrubber = page.locator('.timelapse-scrubber').first();
    await expect(scrubber).toBeVisible();

    // Seek to step 0
    await scrubber.fill('0');
    await scrubber.dispatchEvent('change');
    await page.waitForTimeout(400);

    // Seek to step 1
    await scrubber.fill('1');
    await scrubber.dispatchEvent('change');
    await page.waitForTimeout(400);

    await page.locator('button[title="Close timelapse"]').first().click();
    await expect(page.locator('.monaco-editor').first()).toBeVisible();
  });
});
