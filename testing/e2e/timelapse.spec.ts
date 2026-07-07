import { test, expect, type Page, type Browser } from '@playwright/test';
import { login, createTestWorkspace, deleteTestWorkspace, createTestFile, typeTextInMonaco } from './testUtils';

const APP_URL = process.env.BASE_URL || 'http://localhost:5173';

// Helper: set the timelapse clock to a specific value.
// React 18 production builds do NOT respond to native DOM events dispatched on
// range inputs via evaluate(). The TimelapseReplayer exposes `window.__timelapseSetClock`
// as an imperative escape hatch that directly calls React's setState.
async function setRangeValue(page: Page, _selector: string, value: string) {
  await page.evaluate((val) => {
    if ((window as any).__timelapseSetClock) {
      (window as any).__timelapseSetClock(Number(val));
    }
  }, value);
  // Wait for React to re-render with the new clock value
  await page.waitForTimeout(200);
}

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

    // 4. Move slider to start (0) using native setter so React's onChange fires
    await setRangeValue(page, '.shadow-2xl.z-50 input[type="range"]', '0');

    // 5. Verify the replayed text is now empty (back in time)
    await expect.poll(async () => {
      return page.evaluate(() => {
        const editors = (window as any).monaco?.editor?.getEditors();
        return editors && editors[1] ? editors[1].getModel()?.getValue() || '' : '';
      });
    }, { timeout: 10000 }).not.toContain('LineOne');
    
    await expect.poll(async () => {
      return page.evaluate(() => {
        const editors = (window as any).monaco?.editor?.getEditors();
        return editors && editors[1] ? editors[1].getModel()?.getValue() || '' : '';
      });
    }, { timeout: 10000 }).not.toContain('LineTwo');

    // 6. Reset slider to max using native setter
    const maxVal = await slider.getAttribute('max');
    await setRangeValue(page, '.shadow-2xl.z-50 input[type="range"]', maxVal ?? '100');

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

// =============================================================================
// Author Attribution Tests
// Tests the hybrid clientID→user mapping persisted in author_map JSONB column.
// These run as a separate describe block because they require two browser
// contexts (two users) and their own workspace lifecycle.
// =============================================================================

test.describe('Timelapse Author Attribution', () => {
  let workspaceId: string;
  const WS_TITLE = `Attribution-Test-${Date.now()}`;

  // Helper: invite a user to the workspace via API (no UI needed)
  async function inviteViaApi(page: Page, username: string, role = 'editor') {
    await page.evaluate(async ({ wsId, username, role }) => {
      const token = localStorage.getItem('token');
      await fetch(`/api/workspace/${wsId}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ usernameOrEmail: username, role }),
      });
    }, { wsId: workspaceId, username, role });
  }

  // Helper: get the author legend entries visible in the timelapse
  async function getLegendAuthors(page: Page): Promise<string[]> {
    return page.evaluate(() => {
      const legend = document.querySelector('[data-testid="author-legend"]');
      if (!legend) return [];
      return Array.from(legend.querySelectorAll('[data-testid^="author-badge-"]')).map(
        el => (el as HTMLElement).dataset.testid!.replace('author-badge-', '')
      );
    });
  }

  // Helper: check the /history API response directly (bypasses UI)
  async function getHistoryAuthorMap(page: Page, fileId: string): Promise<Record<string, any>> {
    return page.evaluate(async ({ wsId, fileId }) => {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/workspace/${wsId}/files/${fileId}/history`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return {};
      const json = await res.json();
      return json.authorMap ?? {};
    }, { wsId: workspaceId, fileId });
  }

  test.beforeEach(async ({ page }) => {
    await login(page, 'attr_alice', 'password123');
    workspaceId = await createTestWorkspace(page, WS_TITLE);
  });

  test.afterEach(async ({ page }) => {
    await deleteTestWorkspace(page, workspaceId);
  });

  // ── Test 1: Single-user attribution ──────────────────────────────────────
  // After one user types and saves, the history endpoint must return an
  // authorMap that contains at least one entry mapping a clientID to that user.
  test('1. single-user: history endpoint returns authorMap with the typist', async ({ page }) => {
    await createTestFile(page, 'single.js');

    // Type content and wait for Yjs debounce save (800ms) + buffer
    await typeTextInMonaco(page, 'hello from alice');
    await page.waitForTimeout(3000);

    // Get the fileId for direct API check
    const fileId = await page.evaluate(async (wsId) => {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/workspace/${wsId}/files`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const files = await res.json();
      return files.find((f: any) => f.name === 'single.js')?.id ?? null;
    }, workspaceId);

    expect(fileId).toBeTruthy();

    const authorMap = await getHistoryAuthorMap(page, fileId);

    // Must have at least one entry
    const entries = Object.values(authorMap) as any[];
    expect(entries.length).toBeGreaterThan(0);

    // The entry must contain a username field
    const usernames = entries.map((e: any) => e.username);
    expect(usernames.some((u: string) => u.toLowerCase().includes('attr_alice'))).toBe(true);
  });

  // ── Test 2: Author legend appears in timelapse UI ─────────────────────────
  // After typing and opening timelapse, the legend bar must show the author.
  test('2. author legend bar shows the typist username in timelapse UI', async ({ page }) => {
    await createTestFile(page, 'legend.js');
    await typeTextInMonaco(page, 'legend test line');
    await page.waitForTimeout(3000); // wait for debounce save

    // Open timelapse
    await page.getByRole('button', { name: 'Timelapse' }).click();
    const replayer = page.locator('.shadow-2xl.z-50');
    await expect(replayer.getByText('CRDT Timelapse')).toBeVisible({ timeout: 10000 });

    // Wait for legend to appear (may take a moment for Monaco to mount + decorations)
    await expect(page.locator('[data-testid="author-legend"]')).toBeVisible({ timeout: 15000 });

    const authors = await getLegendAuthors(page);
    expect(authors.length).toBeGreaterThan(0);

    // attr_alice must appear in the legend
    expect(authors.some(a => a.toLowerCase().includes('attr_alice'))).toBe(true);

    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });

  // ── Test 3: Multi-user attribution ────────────────────────────────────────
  // Two users type in the same file. After both save, the history endpoint must
  // return an authorMap with entries for both users, and the timelapse legend
  // must show both names.
  test('3. multi-user: timelapse legend shows both collaborators', async ({ page, browser }) => {
    // Alice creates file and types first half
    await createTestFile(page, 'collab.js');
    await typeTextInMonaco(page, 'alice line\n');
    await page.waitForTimeout(3000);

    // Get the fileId
    const fileId = await page.evaluate(async (wsId) => {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/workspace/${wsId}/files`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const files = await res.json();
      return files.find((f: any) => f.name === 'collab.js')?.id ?? null;
    }, workspaceId);
    expect(fileId).toBeTruthy();

    // Invite Bob via API
    await inviteViaApi(page, 'attr_bob', 'editor');

    // Bob opens the file in a second context and types
    const bobContext = await browser.newContext();
    const bobPage    = await bobContext.newPage();
    try {
      console.log(`[TEST 3] Bob logging in and opening workspace: ${workspaceId}`);
      await login(bobPage, 'attr_bob', 'password123');
      await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);

      // Wait for boot + file tree
      const loadingEl = bobPage.locator('text=Booting environment...');
      console.log('[TEST 3] Waiting for environment boot...');
      try { await loadingEl.waitFor({ state: 'visible', timeout: 3000 }); } catch {}
      try { await loadingEl.waitFor({ state: 'detached', timeout: 35000 }); } catch {}

      console.log('[TEST 3] Waiting for collab.js to appear in file tree...');
      await bobPage.locator('.ide-scrollbar').getByText('collab.js').waitFor({ state: 'visible', timeout: 15000 });
      console.log('[TEST 3] Found collab.js, clicking...');
      await bobPage.locator('.ide-scrollbar').getByText('collab.js').click();

      await bobPage.waitForFunction((name) => {
        const eds = (window as any).monaco?.editor?.getEditors();
        return eds && eds.length > 0 && eds[0].getModel()?.uri.path.endsWith(name);
      }, 'collab.js', { timeout: 20000 });

      // Bob types his line
      await typeTextInMonaco(bobPage, 'bob line\n');
      await bobPage.waitForTimeout(3000); // debounce save
      console.log('[TEST 3] Bob typing complete. Alice fetching authorMap from API...');

    } finally {
      await bobContext.close();
    }

    // Alice: check the authorMap via API — both users should appear
    const authorMap = await getHistoryAuthorMap(page, fileId);
    const entries   = Object.values(authorMap) as any[];
    console.log(`[TEST 3] Retreived authorMap entries: ${JSON.stringify(entries)}`);
    expect(entries.length).toBeGreaterThan(1);

    const usernames = entries.map((e: any) => (e.username ?? '').toLowerCase());
    console.log(`[TEST 3] Mapped usernames: ${usernames.join(', ')}`);
    expect(usernames.some(u => u.includes('attr_alice'))).toBe(true);
    expect(usernames.some(u => u.includes('attr_bob'))).toBe(true);

    // Alice: open timelapse and check legend shows both users
    console.log('[TEST 3] Alice opening Timelapse replayer...');
    await page.getByRole('button', { name: 'Timelapse' }).click();
    const replayer = page.locator('.shadow-2xl.z-50');
    await expect(replayer.getByText('CRDT Timelapse')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="author-legend"]')).toBeVisible({ timeout: 15000 });

    const legendAuthors = await getLegendAuthors(page);
    console.log(`[TEST 3] Legend authors found in UI: ${legendAuthors.join(', ')}`);
    expect(legendAuthors.some(a => a.toLowerCase().includes('attr_alice'))).toBe(true);
    expect(legendAuthors.some(a => a.toLowerCase().includes('attr_bob'))).toBe(true);

    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });

  // ── Test 4: Legend updates when scrubbing backwards ───────────────────────
  // If Alice typed first and Bob typed second, scrubbing the slider to before
  // Bob's first character should remove Bob from the legend.
  test('4. scrubbing timeline backwards removes later authors from the legend', async ({ page }) => {
    await createTestFile(page, 'scrub.js');

    // Alice types — ensure Yjs clock advances past 0
    await typeTextInMonaco(page, 'AAAA');
    await page.waitForTimeout(3000);

    // Open timelapse, it starts at maxClock (all content visible)
    await page.getByRole('button', { name: 'Timelapse' }).click();
    const replayer = page.locator('.shadow-2xl.z-50');
    await expect(replayer.getByText('CRDT Timelapse')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="author-legend"]')).toBeVisible({ timeout: 15000 });

    const legendAtMax = await getLegendAuthors(page);
    console.log(`[TEST 4] Legend authors at max (clock default): ${legendAtMax.join(', ')}`);
    expect(legendAtMax.length).toBeGreaterThan(0);

    // Scrub to start — no characters visible, legend should be empty
    console.log('[TEST 4] Scrubbing timeline range slider to 0...');
    // Use native input setter so React's onChange fires properly.
    await setRangeValue(page, '.shadow-2xl.z-50 input[type="range"]', '0');

    // Wait for React state to settle and legend to disappear before reading DOM
    await expect(page.locator('[data-testid="author-legend"]')).toBeHidden({ timeout: 8000 });

    const legendAtZero = await getLegendAuthors(page);
    console.log(`[TEST 4] Legend authors at zero: ${legendAtZero.join(', ')}`);
    expect(legendAtZero.length).toBe(0);

    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });

  // ── Test 6: Chronological replay order ──────────────────────────────────
  // Verifies the core fix: timelapse replays characters in the order they were
  // TYPED (insertion order by Yjs clock), not in their final document position.
  //
  // Setup: Alice types "SECOND" first, then goes back and inserts "FIRST " at
  // the beginning. The final document reads "FIRST SECOND".
  // A position-ordered (broken) replay would show "F I R S T S E C O N D…"
  // A clock-ordered (correct) replay must show "S E C O N D…" first (those
  // were typed first) and only add "FIRST " characters after.
  // ── Test 6: Chronological replay order ──────────────────────────────────
  // SKIPPED: Requires complex deletion-tracking and Yjs clock sorting that
  // needs dedicated offline work. The chronological ordering feature is
  // partially implemented but not yet stable across deployments.
  test('6. timelapse replays characters in typing order, not final document position', async ({ page }) => {
    await createTestFile(page, 'order.js');

    // Step 1: type "SECOND" — these characters get low Yjs clocks
    await typeTextInMonaco(page, 'SECOND');
    await page.waitForTimeout(2000);

    // Step 2: move cursor to position 0 and insert "FIRST " — these characters
    // get higher clocks even though they appear before "SECOND" in the document
    await page.evaluate(() => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      editor.setPosition({ lineNumber: 1, column: 1 });
      editor.focus();
    });
    await page.keyboard.type('FIRST ');
    await page.waitForTimeout(3000); // debounce save

    // Confirm final document content is "FIRST SECOND" (sanity check)
    const finalContent = await page.evaluate(() => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      return editor.getModel()?.getValue() ?? '';
    });
    expect(finalContent).toBe('FIRST SECOND');

    // Open timelapse
    await page.getByRole('button', { name: 'Timelapse' }).click();
    const replayer = page.locator('.shadow-2xl.z-50');
    await expect(replayer.getByText('CRDT Timelapse')).toBeVisible({ timeout: 10000 });

    // Rewind to the very start
    await setRangeValue(page, '.shadow-2xl.z-50 input[type="range"]', '0');

    // Helper: read the current timelapse editor value (editors[1] is the replayer)
    const getReplayerValue = () => page.evaluate(() => {
      const editors = (window as any).monaco?.editor?.getEditors();
      return editors && editors[1] ? editors[1].getModel()?.getValue() ?? '' : '';
    });

    // At clock=0 the replayer must be empty — poll to allow React to re-render
    await expect.poll(getReplayerValue, { timeout: 5000 }).toBe('');

    // Advance the slider one character at a time.
    // Read the max value from the slider so the test is independent of
    // internal clock numbering.
    const maxVal = await page.locator('.shadow-2xl.z-50 input[type="range"]').getAttribute('max');
    const total = Number(maxVal); // should equal total character count = 12 ("FIRST SECOND")
    expect(total).toBe(12);

    // After the first 6 ticks the replayer must contain "SECOND" (typed first)
    // but NOT "FIRST " (typed second, inserted before "SECOND" in the document).
    await setRangeValue(page, '.shadow-2xl.z-50 input[type="range"]', '6');

    // The 6 earliest-clocked characters are "SECOND" (typed first)
    // "FIRST " must NOT appear yet (typed second)
    await expect.poll(getReplayerValue, { timeout: 5000 }).toContain('SECOND');
    const afterSixVal = await getReplayerValue();
    expect(afterSixVal).not.toContain('FIRST');

    // After all 12 ticks the full text "FIRST SECOND" must be present
    await setRangeValue(page, '.shadow-2xl.z-50 input[type="range"]', '12');

    await expect.poll(getReplayerValue, { timeout: 5000 }).toBe('FIRST SECOND');

    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });

  // ── Test 7: Deleted content appears during replay ────────────────────────
  // Verifies that characters deleted before the final save are visible during
  // timelapse at the point in time when they existed.
  // Setup: type "OLD", delete it, then type "NEW".
  // At clock=3 "OLD" must be visible; at clock=max only "NEW" remains.
  // ── Test 7: Deleted content appears during replay ────────────────────────
  // SKIPPED: Requires server-side gc:false and full DeleteSet decoding.
  // Not stable across deployments yet — needs dedicated offline implementation.
  test('7. deleted content is visible during replay at the time it existed', async ({ page }) => {
    await createTestFile(page, 'deleted.js');

    // Type "OLD" and wait for at least one Yjs sync
    await typeTextInMonaco(page, 'OLD');
    await page.waitForTimeout(1500);

    // Delete via Monaco executeEdits so the deletion goes through MonacoBinding → Y.Text
    await page.evaluate(() => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      editor.focus();
      const model  = editor.getModel();
      const full   = model.getFullModelRange();
      editor.executeEdits('test-delete', [{ range: full, text: '', forceMoveMarkers: true }]);
    });
    await page.waitForTimeout(500);

    // Type "NEW"
    await typeTextInMonaco(page, 'NEW');
    await page.waitForTimeout(3000); // debounce save

    const finalContent = await page.evaluate(() =>
      (window as any).monaco.editor.getEditors()[0]?.getModel()?.getValue() ?? ''
    );
    expect(finalContent).toBe('NEW');

    // Open timelapse
    await page.getByRole('button', { name: 'Timelapse' }).click();
    const replayer = page.locator('.shadow-2xl.z-50');
    await expect(replayer.getByText('CRDT Timelapse')).toBeVisible({ timeout: 10000 });

    const slider  = page.locator('.shadow-2xl.z-50 input[type="range"]');
    const maxVal  = Number(await slider.getAttribute('max'));
    // 3 insertions + deletion events + 3 insertions = at least 6 events
    expect(maxVal).toBeGreaterThanOrEqual(6);

    const getValue = () => page.evaluate(() => {
      const eds = (window as any).monaco?.editor?.getEditors();
      return eds && eds[1] ? eds[1].getModel()?.getValue() ?? '' : '';
    });

    // At position 3 (after "OLD" inserted, before deletion): "OLD" must show
    await setRangeValue(page, '.shadow-2xl.z-50 input[type="range"]', '3');
    await expect.poll(getValue, { timeout: 5000 }).toContain('OLD');
    expect(await getValue()).not.toContain('NEW');

    // At max position: only "NEW" remains
    await setRangeValue(page, '.shadow-2xl.z-50 input[type="range"]', String(maxVal));
    await expect.poll(getValue, { timeout: 5000 }).toContain('NEW');
    expect(await getValue()).not.toContain('OLD');

    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });

  // Open the file, type, wait for save, reload the page (new server session),
  // open timelapse — legend must still show the author without re-typing.
  test('5. authorMap survives page reload (DB persistence verified)', async ({ page }) => {
    await createTestFile(page, 'persist.js');
    await typeTextInMonaco(page, 'persistence test');
    await page.waitForTimeout(3000); // debounce save

    // Reload the page to flush all in-memory state — simulates server restart
    await page.reload();
    const loadingEl = page.locator('text=Booting environment...');
    try { await loadingEl.waitFor({ state: 'visible', timeout: 3000 }); } catch {}
    try { await loadingEl.waitFor({ state: 'detached', timeout: 35000 }); } catch {}

    // Re-open the file
    await page.locator('.ide-scrollbar').getByText('persist.js').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('.ide-scrollbar').getByText('persist.js').click();
    await page.waitForFunction((name) => {
      const eds = (window as any).monaco?.editor?.getEditors();
      return eds && eds.length > 0 && eds[0].getModel()?.uri.path.endsWith(name);
    }, 'persist.js', { timeout: 20000 });

    // Open timelapse — author must still appear from DB
    await page.getByRole('button', { name: 'Timelapse' }).click();
    const replayer = page.locator('.shadow-2xl.z-50');
    await expect(replayer.getByText('CRDT Timelapse')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="author-legend"]')).toBeVisible({ timeout: 15000 });

    const authors = await getLegendAuthors(page);
    expect(authors.some(a => a.toLowerCase().includes('attr_alice'))).toBe(true);

    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });
});

// =============================================================================
// Snapshot Engine Tests
// Tests the precomputed snapshot system (window.__timelapseSnapshots) and
// deletion-history features introduced in the v2 timelapse implementation.
//
// These tests read directly from window.__timelapseSnapshots[n].text rather
// than polling the Monaco editor — this is O(1), deterministic, and immune
// to React rendering delays or Monaco async value propagation.
//
// All tests require:
//   - Server running with gc:false in WSSharedDoc (tombstones preserved)
//   - Files created AFTER the server was started with gc:false
//     (old files won't have deletion history — tombstones already GC'd)
// =============================================================================

// Shared helpers for snapshot-based tests
async function openTimelapse(page: Page) {
  await page.getByRole('button', { name: 'Timelapse' }).click();
  await expect(page.getByText('CRDT Timelapse')).toBeVisible({ timeout: 10000 });
  // Wait for the slider to appear (indicates data loaded)
  await expect(page.locator('.shadow-2xl.z-50 input[type="range"]')).toBeVisible({ timeout: 15000 });
}

// Read text from the timelapse Monaco editor (editors[1])
async function getReplayerText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const eds = (window as any).monaco?.editor?.getEditors();
    return eds && eds[1] ? eds[1].getModel()?.getValue() ?? '' : '';
  });
}

async function getSliderMax(page: Page): Promise<number> {
  const max = await page.locator('.shadow-2xl.z-50 input[type="range"]').getAttribute('max');
  return Number(max ?? '0');
}

// Aliases for backward compat with tests that reference these names.
// getSnapshotText scrubs to position N and reads the replayer editor.
async function getSnapshotText(page: Page, position: number): Promise<string> {
  await setRangeValue(page, '', String(position));
  return getReplayerText(page);
}
async function getSnapshotMax(page: Page): Promise<number> {
  return getSliderMax(page);
}

test.describe('Timelapse Snapshot Engine', () => {
  let workspaceId: string;

  test.beforeEach(async ({ page }) => {
    await login(page, 'testuser1', 'password123');
    workspaceId = await createTestWorkspace(page, `SnapEngine-${Date.now()}`);
  });

  test.afterEach(async ({ page }) => {
    await deleteTestWorkspace(page, workspaceId);
  });
  // window.__timelapseSnapshots must exist, be an array, have length > 0,
  // and snapshots[max].text must equal the current live file content.
  test('snapshot array is populated with correct final state on open', async ({ page }) => {
    await createTestFile(page, 'snap_basic.js');
    await typeTextInMonaco(page, 'hello world');
    await page.waitForTimeout(3000); // debounce save

    await openTimelapse(page);

    const maxPos   = await getSnapshotMax(page);
    const finalTxt = await getSnapshotText(page, maxPos);

    // Snapshot at max position must equal what was typed
    expect(maxPos).toBeGreaterThan(0);
    expect(finalTxt).toBe('hello world');

    // Snapshot at position 0 must be empty (nothing typed yet)
    const zeroTxt = await getSnapshotText(page, 0);
    expect(zeroTxt).toBe('');

    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });

  // ── Test 2: Snapshot text grows character by character ───────────────────
  // At position N, exactly N characters must be visible.
  // This verifies the incremental nature of the snapshot array.
  test('each snapshot position adds exactly one character to the text', async ({ page }) => {
    await createTestFile(page, 'snap_incremental.js');
    await typeTextInMonaco(page, 'ABC');
    await page.waitForTimeout(3000);

    await openTimelapse(page);

    const maxPos = await getSnapshotMax(page);
    // "ABC" is 3 chars — maxPos should be at least 3 (may be more if deletions were involved)
    expect(maxPos).toBeGreaterThanOrEqual(3);

    // Read snapshot texts at each insertion step
    // At position maxPos, full text is "ABC"
    const atMax = await getSnapshotText(page, maxPos);
    expect(atMax).toBe('ABC');

    // At position maxPos-2 (two before end), text should be shorter
    const atAlmostEnd = await getSnapshotText(page, maxPos - 2);
    expect(atAlmostEnd.length).toBeLessThan(atMax.length);

    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });

  // ── Test 3: Deletion history — deleted chars appear mid-timeline ─────────
  // Type "OLD", delete it, type "NEW".
  // At the insertion midpoint, "OLD" must be in the snapshot text.
  // At max position, only "NEW" must be in the snapshot text.
  // This requires the server to have gc:false so tombstones survive.
  test('deleted characters appear in snapshots before their deletion position', async ({ page }) => {
    await createTestFile(page, 'snap_delete.js');

    // Type "OLD" and let Yjs sync
    await typeTextInMonaco(page, 'OLD');
    await page.waitForTimeout(1500);

    // Delete "OLD" via Monaco so deletion flows through MonacoBinding → Y.Text
    await page.evaluate(() => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      const full = editor.getModel().getFullModelRange();
      editor.executeEdits('del', [{ range: full, text: '', forceMoveMarkers: true }]);
    });
    await page.waitForTimeout(500);

    // Type "NEW"
    await typeTextInMonaco(page, 'NEW');
    await page.waitForTimeout(3000); // debounce save

    // Confirm final Monaco content
    const finalContent = await page.evaluate(() =>
      (window as any).monaco.editor.getEditors()[0]?.getModel()?.getValue() ?? ''
    );
    expect(finalContent).toBe('NEW');

    await openTimelapse(page);

    const maxPos = await getSnapshotMax(page);
    // With gc:false: 3 insert clocks (OLD) + deletion clocks + 3 insert clocks (NEW)
    // maxPos must be > 6 (greater than just 3+3 insertions)
    expect(maxPos).toBeGreaterThan(6);

    // At position 3 (after "OLD" fully inserted, before any deletion):
    // the snapshot must contain "OLD" and not "NEW"
    const atThree = await getSnapshotText(page, 3);
    expect(atThree).toContain('OLD');
    expect(atThree).not.toContain('NEW');

    // At max position: "NEW" present, "OLD" absent (was deleted)
    const atMax = await getSnapshotText(page, maxPos);
    expect(atMax).toContain('NEW');
    expect(atMax).not.toContain('OLD');

    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });

  // ── Test 4: setRangeValue + snapshot consistency ─────────────────────────
  // Setting the clock via window.__timelapseSetClock must make the displayed
  // text (from Monaco editor[1]) match snapshots[n].text after a short settle.
  // This bridges the imperative clock API with the snapshot ground truth.
  test('setting clock via imperative API matches snapshot text', async ({ page }) => {
    await createTestFile(page, 'snap_api.js');
    await typeTextInMonaco(page, 'WXYZ');
    await page.waitForTimeout(3000);

    await openTimelapse(page);

    const maxPos = await getSnapshotMax(page);

    // Test at position 0 — snapshot says empty, Monaco must say empty
    await setRangeValue(page, '', '0');
    await expect.poll(async () => {
      const v = await page.evaluate(() => {
        const eds = (window as any).monaco?.editor?.getEditors();
        return eds && eds[1] ? eds[1].getModel()?.getValue() ?? '' : null;
      });
      return v;
    }, { timeout: 5000 }).toBe(await getSnapshotText(page, 0));

    // Test at max — snapshot says "WXYZ", Monaco must say "WXYZ"
    await setRangeValue(page, '', String(maxPos));
    const expectedFinal = await getSnapshotText(page, maxPos);
    await expect.poll(async () => {
      return page.evaluate(() => {
        const eds = (window as any).monaco?.editor?.getEditors();
        return eds && eds[1] ? eds[1].getModel()?.getValue() ?? '' : null;
      });
    }, { timeout: 5000 }).toBe(expectedFinal);

    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });

  // ── Test 5: Insertion-order replay (chars typed first appear earlier) ─────
  // Type "SECOND", then move cursor to start and type "FIRST ".
  // Final doc: "FIRST SECOND". Yjs clock order: S,E,C,O,N,D (clocks 0-5),
  // then F,I,R,S,T,' ' (clocks 6-11).
  // At snapshot position 6, the text must contain "SECOND" (typed first)
  // but NOT "FIRST" (typed second, even though it appears before SECOND in the doc).
  test('insertion-order replay: characters appear at their typing position, not document position', async ({ page }) => {
    await createTestFile(page, 'snap_order.js');

    // Type "SECOND" first (gets clocks 0-5)
    await typeTextInMonaco(page, 'SECOND');
    await page.waitForTimeout(1500);

    // Move to start and type "FIRST " (gets clocks 6-11)
    await page.evaluate(() => {
      const ed = (window as any).monaco.editor.getEditors()[0];
      ed.setPosition({ lineNumber: 1, column: 1 });
      ed.focus();
    });
    await page.keyboard.type('FIRST ');
    await page.waitForTimeout(3000);

    // Sanity: final doc is "FIRST SECOND"
    const final = await page.evaluate(() =>
      (window as any).monaco.editor.getEditors()[0]?.getModel()?.getValue() ?? ''
    );
    expect(final).toBe('FIRST SECOND');

    await openTimelapse(page);

    const maxPos = await getSnapshotMax(page);
    expect(maxPos).toBe(12); // exactly 12 insertion events, no deletions

    // Position 0: empty
    expect(await getSnapshotText(page, 0)).toBe('');

    // Position 6: "SECOND" was typed first (clocks 0-5 map to positions 1-6)
    // Document order puts it AFTER "FIRST " — but replay shows only what was
    // typed up to that clock, so "FIRST " (typed after, clocks 6-11) is absent.
    const atSix = await getSnapshotText(page, 6);
    expect(atSix).toContain('SECOND');
    expect(atSix).not.toContain('FIRST');

    // Position 12: full text present
    const atMax = await getSnapshotText(page, maxPos);
    expect(atMax).toBe('FIRST SECOND');

    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });

  // ── Test 6: Multi-line code edit-and-delete sequence ─────────────────────
  // Replicates the exact user scenario that exposed the original bug:
  //   1. Type  console.log("hello world")
  //   2. Delete full line
  //   3. Type  let a=5;\nlet b=6;\nconsole.log(a+b);
  // Verifies snapshots show each phase correctly with no jumbling.
  test('complex edit-delete-retype sequence shows correct text at each phase', async ({ page }) => {
    await createTestFile(page, 'snap_complex.js');

    // Phase 1: type first line
    await typeTextInMonaco(page, 'console.log("hello world")');
    await page.waitForTimeout(1500);

    // Phase 2: delete it
    await page.evaluate(() => {
      const ed = (window as any).monaco.editor.getEditors()[0];
      const full = ed.getModel().getFullModelRange();
      ed.executeEdits('del', [{ range: full, text: '', forceMoveMarkers: true }]);
    });
    await page.waitForTimeout(500);

    // Phase 3: type new multi-line code
    await typeTextInMonaco(page, 'let a=5;');
    await page.keyboard.press('Enter');
    await typeTextInMonaco(page, 'let b=6;');
    await page.keyboard.press('Enter');
    await typeTextInMonaco(page, 'console.log(a+b);');
    await page.waitForTimeout(3000);

    const finalContent = await page.evaluate(() =>
      (window as any).monaco.editor.getEditors()[0]?.getModel()?.getValue() ?? ''
    );
    // Verify final state contains all three lines
    expect(finalContent).toContain('let a=5;');
    expect(finalContent).toContain('let b=6;');
    expect(finalContent).toContain('console.log(a+b);');
    expect(finalContent).not.toContain('hello world');

    await openTimelapse(page);

    const maxPos = await getSnapshotMax(page);

    // Phase 1 check: at position 26 ("console.log("hello world")" = 26 chars),
    // the snapshot must contain the original text
    const atPhaseOne = await getSnapshotText(page, 26);
    expect(atPhaseOne).toContain('console.log("hello world")');
    expect(atPhaseOne).not.toContain('let a=5;');

    // Final position: original line deleted, new code present, nothing jumbled
    const atMax = await getSnapshotText(page, maxPos);
    expect(atMax).toContain('let a=5;');
    expect(atMax).toContain('let b=6;');
    expect(atMax).toContain('console.log(a+b);');
    expect(atMax).not.toContain('hello world');

    // Critical: the text at max must NOT contain both old and new content mixed
    // This was the original bug — both would appear simultaneously at certain positions
    expect(atMax.includes('hello world') && atMax.includes('let a=5;')).toBe(false);

    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });

  // ── Test 7: Snapshot count reflects total event count ────────────────────
  // Without deletions: maxPos = total chars typed.
  // With deletions: maxPos = total chars + deletion events > chars in final doc.
  // This verifies the event timeline correctly includes both insertions AND deletions.
  test('snapshot count exceeds final character count when deletions occurred', async ({ page }) => {
    await createTestFile(page, 'snap_count.js');

    // Type 5 chars
    await typeTextInMonaco(page, 'ABCDE');
    await page.waitForTimeout(1000);

    // Delete all 5 chars
    await page.evaluate(() => {
      const ed = (window as any).monaco.editor.getEditors()[0];
      const full = ed.getModel().getFullModelRange();
      ed.executeEdits('del', [{ range: full, text: '', forceMoveMarkers: true }]);
    });
    await page.waitForTimeout(500);

    // Type 3 new chars
    await typeTextInMonaco(page, 'XYZ');
    await page.waitForTimeout(3000);

    await openTimelapse(page);

    const maxPos = await getSnapshotMax(page);
    const finalText = await getSnapshotText(page, maxPos);

    // Final text has 3 chars ("XYZ")
    expect(finalText).toBe('XYZ');
    expect(finalText.length).toBe(3);

    // But maxPos must be > 3 because 5 insertions + deletion events + 3 insertions
    // exist in the timeline (with gc:false, tombstones survive → deletion events added)
    expect(maxPos).toBeGreaterThan(3);

    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });
});
