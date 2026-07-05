import { test, expect } from '@playwright/test';
import { login, createTestWorkspace, deleteTestWorkspace, createTestFile, typeTextInMonaco } from './testUtils';

test.describe('Yjs Session Timelapse Replay', () => {
  let workspaceId: string;
  const testWorkspaceTitle = `Timelapse-Test-${Date.now()}`;

  test.beforeEach(async ({ page }) => {
    await login(page, 'testuser1', 'password123');
    workspaceId = await createTestWorkspace(page, testWorkspaceTitle);
  });

  test.afterEach(async ({ page }) => {
    await deleteTestWorkspace(page, workspaceId);
  });

  test('should record keystrokes and play them back in timelapse mode', async ({ page }) => {
    // 1. Create a file
    await createTestFile(page, 'history_test.js');

    // 2. Type some code with slight delays so Yjs clocks advance distinctly
    await typeTextInMonaco(page, 'console.log("Hello");');
    
    // Allow time for debounced backend save
    await page.waitForTimeout(4000);
    
    // Type more code
    await page.keyboard.press('Enter');
    await typeTextInMonaco(page, 'const x = 42;');

    // Allow time for debounced backend save
    await page.waitForTimeout(4000);

    // 3. Open Timelapse Mode
    await expect(page.getByRole('button', { name: 'Timelapse' })).toBeVisible();
    await page.getByRole('button', { name: 'Timelapse' }).click();

    // 4. Verify Timelapse Replayer appears
    await expect(page.getByText('CRDT Timelapse')).toBeVisible();

    // Verify it loads with the latest content (slider is at max)
    const replayerContainer = page.locator('.shadow-2xl.z-50'); // Our TimelapseReplayer container
    await expect(replayerContainer.getByText('console.log("Hello");')).toBeVisible();
    await expect(replayerContainer.getByText('const x = 42;')).toBeVisible();

    // 5. Test Rewind
    await replayerContainer.getByTitle('Rewind to start').click();
    
    // 6. Test Playback
    // Wait for the text to appear gradually while playing
    await replayerContainer.getByTitle('Play').click();
    
    // We should see text appear
    await expect(replayerContainer.getByText('console.log("Hello");')).toBeVisible({ timeout: 10000 });
    await expect(replayerContainer.getByText('const x = 42;')).toBeVisible({ timeout: 10000 });
  });

  test('should handle empty files gracefully without crashing', async ({ page }) => {
    // 1. Create an empty file
    await createTestFile(page, 'empty.js');

    // 2. Open Timelapse Mode
    await expect(page.getByRole('button', { name: 'Timelapse' })).toBeVisible();
    await page.getByRole('button', { name: 'Timelapse' }).click();

    // 3. Verify Timelapse Replayer loads and shows no content
    const replayerContainer = page.locator('.shadow-2xl.z-50');
    await expect(replayerContainer.getByText('CRDT Timelapse')).toBeVisible();
    
    // Check Monaco Editor model value instead of DOM text
    const editorValue = await page.evaluate(() => {
      const editors = (window as any).monaco?.editor?.getEditors();
      return editors && editors[1] ? editors[1].getModel()?.getValue() || '' : '';
    });
    expect(editorValue.trim()).toBe('');

    // 4. Close Timelapse
    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
    await expect(replayerContainer).not.toBeVisible();
  });

  test('should track edits interactively when replayer is closed and reopened', async ({ page }) => {
    // 1. Create file and perform initial typing
    await createTestFile(page, 'interactive.js');
    await typeTextInMonaco(page, 'const first = 1;');
    await page.waitForTimeout(4000); // Wait for debounced save

    // 2. Open Timelapse and verify initial state
    await page.getByRole('button', { name: 'Timelapse' }).click();
    const replayerContainer = page.locator('.shadow-2xl.z-50');
    await expect(replayerContainer.getByText('const first = 1;')).toBeVisible();

    // 3. Close Timelapse
    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
    await expect(replayerContainer).not.toBeVisible();

    // 4. Add more content outside timelapse mode
    await page.locator('.monaco-editor').first().click();
    await page.keyboard.press('Enter');
    await typeTextInMonaco(page, 'const second = 2;');
    await page.waitForTimeout(4000); // Wait for debounced save

    // 5. Reopen Timelapse and verify it has the latest updates
    await page.getByRole('button', { name: 'Timelapse' }).click();
    await expect(replayerContainer.getByText('const first = 1;')).toBeVisible();
    await expect(replayerContainer.getByText('const second = 2;')).toBeVisible();

    // Close again
    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });

  test('should update the replayed text dynamically when dragging the timeline slider', async ({ page }) => {
    // 1. Create file and make sequential distinct edits
    await createTestFile(page, 'slider.js');
    await typeTextInMonaco(page, 'LineOne');
    await page.waitForTimeout(4000);
    
    await page.keyboard.press('Enter');
    await typeTextInMonaco(page, 'LineTwo');
    await page.waitForTimeout(4000);

    // 2. Open Timelapse
    await page.getByRole('button', { name: 'Timelapse' }).click();
    const replayerContainer = page.locator('.shadow-2xl.z-50');
    await expect(replayerContainer.getByText('LineOne')).toBeVisible();
    await expect(replayerContainer.getByText('LineTwo')).toBeVisible();

    // 3. Get the slider element
    const slider = page.locator('.shadow-2xl.z-50 input[type="range"]');
    await expect(slider).toBeVisible();

    // 4. Drag the slider to the start (value 0) using native mouse drag
    const box = await slider.boundingBox();
    if (box) {
      // Move to the right side of the slider (where the thumb is initially)
      await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2);
      await page.mouse.down();
      // Drag all the way to the left side
      await page.mouse.move(box.x + 5, box.y + box.height / 2);
      await page.mouse.up();
    }

    // 5. Verify the replayed text is now empty (back in time)
    await expect.poll(async () => {
      return page.evaluate(() => {
        const editors = (window as any).monaco?.editor?.getEditors();
        return editors && editors[1] ? editors[1].getModel()?.getValue() || '' : '';
      });
    }).not.toContain('LineOne');
    
    await expect.poll(async () => {
      return page.evaluate(() => {
        const editors = (window as any).monaco?.editor?.getEditors();
        return editors && editors[1] ? editors[1].getModel()?.getValue() || '' : '';
      });
    }).not.toContain('LineTwo');

    // 6. Reset slider to max value by dragging it back to the right
    if (box) {
      await page.mouse.move(box.x + 5, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2);
      await page.mouse.up();
    }

    // 7. Verify text is restored
    await expect.poll(async () => {
      return page.evaluate(() => {
        const editors = (window as any).monaco?.editor?.getEditors();
        return editors && editors[1] ? editors[1].getModel()?.getValue() || '' : '';
      });
    }).toContain('LineOne');

    await expect.poll(async () => {
      return page.evaluate(() => {
        const editors = (window as any).monaco?.editor?.getEditors();
        return editors && editors[1] ? editors[1].getModel()?.getValue() || '' : '';
      });
    }).toContain('LineTwo');

    // Close
    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });

  test('should show separate histories for separate files in timelapse mode', async ({ page }) => {
    // 1. Create file A and write text
    await createTestFile(page, 'docA.js');
    await typeTextInMonaco(page, 'console.log("A");');
    await page.waitForTimeout(4000);

    // 2. Create file B and write text
    await createTestFile(page, 'docB.js');
    await typeTextInMonaco(page, 'console.log("B");');
    await page.waitForTimeout(4000);

    // 3. Switch back to file A in explorer
    await page.locator('.ide-scrollbar').getByText('docA.js').click();
    await expect(page.locator('.monaco-editor').first()).toContainText('console.log("A");');

    // 4. Open Timelapse for file A and verify contents
    await page.getByRole('button', { name: 'Timelapse' }).click();
    const replayerContainer = page.locator('.shadow-2xl.z-50');
    await expect(replayerContainer.getByText('console.log("A");')).toBeVisible();
    await expect(replayerContainer.getByText('console.log("B");')).not.toBeVisible();
    
    // Close
    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();

    // 5. Switch to file B in explorer
    await page.locator('.ide-scrollbar').getByText('docB.js').click();
    await expect(page.locator('.monaco-editor').first()).toContainText('console.log("B");');

    // 6. Open Timelapse for file B and verify contents
    await page.getByRole('button', { name: 'Timelapse' }).click();
    await expect(replayerContainer.getByText('console.log("B");')).toBeVisible();
    await expect(replayerContainer.getByText('console.log("A");')).not.toBeVisible();

    // Close
    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });
});
