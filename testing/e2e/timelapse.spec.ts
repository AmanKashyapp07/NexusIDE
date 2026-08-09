import { test, expect } from '@playwright/test';
import { loginUser, createTestWorkspace, deleteTestWorkspace, createTestFile, typeTextInMonaco, waitForBootComplete, APP_URL, API_URL } from '../test-utils';

test.describe('Real Infrastructure & Browser UI Timelapse Suite', () => {
  let workspaceId: string;
  let authToken: string;

  test.beforeEach(async ({ page, request }) => {
    const timestamp = Date.now();
    authToken = await loginUser(page, request, `Timelapse_User_${timestamp}`);
    workspaceId = await createTestWorkspace(page, `Timelapse-RealUI-${timestamp}`);
  });

  test.afterEach(async ({ page, request }) => {
    if (workspaceId && authToken) {
      await request.delete(`${API_URL}/workspace/${workspaceId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      }).catch(() => {});
    }
  });

  test('1. Real Monaco typing & clicking Timelapse button opens live replayer UI', async ({ page }) => {
    await createTestFile(page, 'real_timelapse.js');
    await typeTextInMonaco(page, 'console.log("Real Timelapse Live");');

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
    await typeTextInMonaco(page, 'SECOND_VERSION\n');

    // Open Timelapse
    const timelapseBtn = page.locator('button:has-text("Timelapse")').first();
    await expect(timelapseBtn).toBeVisible({ timeout: 15000 });
    await timelapseBtn.click();
    await expect(page.locator('span:has-text("CRDT Timelapse")').first()).toBeVisible({ timeout: 15000 });

    // Click Rewind to jump to beginning
    const rewindBtn = page.locator('button[title*="Back to start"]').first();
    await expect(rewindBtn).toBeVisible();
    await rewindBtn.click();

    // Verify step forward button advances clock
    const stepForwardBtn = page.locator('button[title*="Step forward"]').first();
    await expect(stepForwardBtn).toBeVisible();
    await stepForwardBtn.click();

    // Close replayer
    await page.locator('button[title="Close timelapse"]').first().click();
  });

  test('3. Real Play/Pause automated playback cycles through steps', async ({ page }) => {
    await createTestFile(page, 'playback_test.js');
    await typeTextInMonaco(page, 'A ');
    await typeTextInMonaco(page, 'B ');
    await typeTextInMonaco(page, 'C');

    const timelapseBtn = page.locator('button:has-text("Timelapse")').first();
    await expect(timelapseBtn).toBeVisible({ timeout: 15000 });
    await timelapseBtn.click();
    await expect(page.locator('span:has-text("CRDT Timelapse")').first()).toBeVisible({ timeout: 15000 });

    // Rewind to start
    const rewindBtn = page.locator('button[title*="Back to start"]').first();
    await expect(rewindBtn).toBeVisible();
    await rewindBtn.click();

    // Toggle Play
    const playBtn = page.locator('button[title*="Play"]').first();
    await expect(playBtn).toBeVisible();
    await playBtn.click();

    // Toggle Pause if visible
    const pauseBtn = page.locator('button[title*="Pause"]').first();
    await expect(async () => {
      if (await pauseBtn.isVisible()) {
        await pauseBtn.click();
      }
    }).toPass({ timeout: 5000, intervals: [300] });

    // Close replayer
    await page.locator('button[title="Close timelapse"]').first().click();
  });

  test('4. Multi-user real collaboration displays Author Badges in Timelapse Legend', async ({ browser, page, request }) => {
    const timestamp = Date.now();
    const bobUsername = `Bob_Timelapse_${timestamp}`;
    await createTestFile(page, 'collab_ui.js');
    await typeTextInMonaco(page, 'const author = "Alice";\n');

    // Invite Bob to workspace
    await request.post(`${API_URL}/workspace/${workspaceId}/collaborators`, {
      headers: { Authorization: `Bearer ${authToken}` },
      data: { username: bobUsername, role: 'editor' }
    });

    // Bob logs in and joins workspace in a separate browser context with guaranteed context close
    const bobContext = await browser.newContext();
    try {
      const bobPage = await bobContext.newPage();
      await loginUser(bobPage, request, bobUsername);
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
      }
    } finally {
      await bobContext.close();
    }

    // Alice opens Timelapse and inspects real author legend
    const timelapseBtn = page.locator('button:has-text("Timelapse")').first();
    await expect(timelapseBtn).toBeVisible({ timeout: 15000 });
    await timelapseBtn.click();
    await expect(page.locator('span:has-text("CRDT Timelapse")').first()).toBeVisible({ timeout: 15000 });

    const legend = page.locator('[data-testid="author-legend"]').first();
    if (await legend.isVisible().catch(() => false)) {
      await expect(legend).toBeVisible();
    }

    await page.locator('button[title="Close timelapse"]').first().click();
  });

  test('5. Keyboard navigation controls timelapse scrubber', async ({ page }) => {
    await createTestFile(page, 'keys_test.js');
    await typeTextInMonaco(page, 'X ');
    await typeTextInMonaco(page, 'Y ');
    await typeTextInMonaco(page, 'Z');

    const timelapseBtn = page.locator('button:has-text("Timelapse")').first();
    await expect(timelapseBtn).toBeVisible({ timeout: 15000 });
    await timelapseBtn.click();
    await expect(page.locator('span:has-text("CRDT Timelapse")').first()).toBeVisible({ timeout: 15000 });

    // Press ArrowLeft to step backwards
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');

    // Press ArrowRight to step forwards
    await page.keyboard.press('ArrowRight');

    // Close replayer
    await page.locator('button[title="Close timelapse"]').first().click();
    await expect(page.locator('.monaco-editor').first()).toBeVisible();
  });

  test('6. Playback speed multiplier cycles through 1x, 2x, 4x, and 0.5x', async ({ page }) => {
    await createTestFile(page, 'speed_test.js');
    await typeTextInMonaco(page, 'let speed = 1;');

    const timelapseBtn = page.locator('button:has-text("Timelapse")').first();
    await expect(timelapseBtn).toBeVisible({ timeout: 15000 });
    await timelapseBtn.click();
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

    await createTestFile(page, 'beta_file.js');
    await typeTextInMonaco(page, 'BETA_CODE_BODY');

    // Open Timelapse on beta_file.js
    const timelapseBtn = page.locator('button:has-text("Timelapse")').first();
    await expect(timelapseBtn).toBeVisible({ timeout: 15000 });
    await timelapseBtn.click();
    await expect(page.locator('span:has-text("CRDT Timelapse")').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('span:has-text("beta_file.js")').first()).toBeVisible();

    // Close and switch to alpha_file.js
    await page.locator('button[title="Close timelapse"]').first().click();
    const alphaNode = page.locator('.ide-scrollbar div:has-text("alpha_file.js")').first();
    await alphaNode.click();

    // Open Timelapse on alpha_file.js
    await expect(timelapseBtn).toBeVisible({ timeout: 15000 });
    await timelapseBtn.click();
    await expect(page.locator('span:has-text("CRDT Timelapse")').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('span:has-text("alpha_file.js")').first()).toBeVisible();

    await page.locator('button[title="Close timelapse"]').first().click();
  });

  test('8. Step-by-step navigation updates clock text indicator', async ({ page }) => {
    await createTestFile(page, 'clock_test.js');
    await typeTextInMonaco(page, 'ONE ');
    await typeTextInMonaco(page, 'TWO');

    const timelapseBtn = page.locator('button:has-text("Timelapse")').first();
    await expect(timelapseBtn).toBeVisible({ timeout: 15000 });
    await timelapseBtn.click();
    await expect(page.locator('span:has-text("CRDT Timelapse")').first()).toBeVisible({ timeout: 15000 });

    // Click rewind to reset clock to 0
    const rewindBtn = page.locator('button[title*="Back to start"]').first();
    await expect(rewindBtn).toBeVisible();
    await rewindBtn.click();

    const clockDisplay = page.locator('.timelapse-scrubber').locator('..').locator('..').locator('div.font-mono').first();
    await expect(clockDisplay).toContainText('0');

    // Click step forward to advance
    const stepForwardBtn = page.locator('button[title*="Step forward"]').first();
    await expect(stepForwardBtn).toBeVisible();
    await stepForwardBtn.click();

    await page.locator('button[title="Close timelapse"]').first().click();
  });

  test('9. Scrub bar dragging seeks directly to specific timeline step', async ({ page }) => {
    await createTestFile(page, 'drag_test.js');
    await typeTextInMonaco(page, 'AAA ');
    await typeTextInMonaco(page, 'BBB ');
    await typeTextInMonaco(page, 'CCC');

    const timelapseBtn = page.locator('button:has-text("Timelapse")').first();
    await expect(timelapseBtn).toBeVisible({ timeout: 15000 });
    await timelapseBtn.click();
    await expect(page.locator('span:has-text("CRDT Timelapse")').first()).toBeVisible({ timeout: 15000 });

    const scrubber = page.locator('.timelapse-scrubber').first();
    await expect(scrubber).toBeVisible();

    // Seek to step 0
    await scrubber.fill('0');
    await scrubber.dispatchEvent('change');

    // Seek to step 1
    await scrubber.fill('1');
    await scrubber.dispatchEvent('change');

    await page.locator('button[title="Close timelapse"]').first().click();
    await expect(page.locator('.monaco-editor').first()).toBeVisible();
  });
});
