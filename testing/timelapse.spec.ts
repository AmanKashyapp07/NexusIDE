import { test, expect, type Page, type Browser } from '@playwright/test';
import { login, createTestWorkspace, deleteTestWorkspace, createTestFile, typeTextInMonaco, waitForBootComplete, waitForEditorModel, setRangeValue, getSliderMax } from './test-utils';
const APP_URL = process.env.NEXUS_BASE_URL || process.env.BASE_URL || 'http://localhost:5173';

test.describe('Timelapse - Replay Engine', () => {
  let workspaceId: string;
  const testWorkspaceTitle = `Timelapse-Test-${Date.now()}`;

  test.beforeEach(async ({ page }) => {
    await login(page, 'testuser1', 'password123');
    workspaceId = await createTestWorkspace(page, testWorkspaceTitle);
  });

  test.afterEach(async ({ page }) => {
    await deleteTestWorkspace(page, workspaceId);
  });

  test('1. Keystroke recording & playback', async ({ page }) => {
    await createTestFile(page, 'history_test.js');
    await typeTextInMonaco(page, 'console.log("Hello");');
    await page.waitForTimeout(4000);
    await page.keyboard.press('Enter');
    await typeTextInMonaco(page, 'const x = 42;');
    await page.waitForTimeout(4000);
    await expect(page.getByRole('button', { name: 'Timelapse' })).toBeVisible();
    await page.getByRole('button', { name: 'Timelapse' }).click();
    await expect(page.getByText('CRDT Timelapse')).toBeVisible();
    const replayerContainer = page.locator('.shadow-2xl.z-50'); // Our TimelapseReplayer container
    await expect(replayerContainer.getByText('console.log("Hello");')).toBeVisible();
    await expect(replayerContainer.getByText('const x = 42;')).toBeVisible();
    await replayerContainer.getByTitle('Back to start (Home)').click();
    await replayerContainer.getByTitle('Play (space)').click();
    await expect(replayerContainer.getByText('console.log("Hello");')).toBeVisible({ timeout: 10000 });
    await expect(replayerContainer.getByText('const x = 42;')).toBeVisible({ timeout: 10000 });
  });

  test('2. Interactive edit tracking', async ({ page }) => {
    await createTestFile(page, 'interactive.js');
    await typeTextInMonaco(page, 'const first = 1;');
    await page.waitForTimeout(4000); // Wait for debounced save
    await page.getByRole('button', { name: 'Timelapse' }).click();
    const replayerContainer = page.locator('.shadow-2xl.z-50');
    await expect(replayerContainer.getByText('const first = 1;')).toBeVisible();
    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
    await expect(replayerContainer).not.toBeVisible();
    await page.locator('.monaco-editor').first().click();
    await page.keyboard.press('Enter');
    await typeTextInMonaco(page, 'const second = 2;');
    await page.waitForTimeout(4000); // Wait for debounced save
    await page.getByRole('button', { name: 'Timelapse' }).click();
    await expect(replayerContainer.getByText('const first = 1;')).toBeVisible();
    await expect(replayerContainer.getByText('const second = 2;')).toBeVisible();
    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });

  test('3. Timeline slider scrubbing', async ({ page }) => {
    await createTestFile(page, 'slider.js');
    await typeTextInMonaco(page, 'LineOne');
    await page.waitForTimeout(4000);
    await page.keyboard.press('Enter');
    await typeTextInMonaco(page, 'LineTwo');
    await page.waitForTimeout(4000);
    await page.getByRole('button', { name: 'Timelapse' }).click();
    const replayerContainer = page.locator('.shadow-2xl.z-50');
    await expect(replayerContainer.getByText('LineOne')).toBeVisible();
    await expect(replayerContainer.getByText('LineTwo')).toBeVisible();
    const slider = page.locator('.shadow-2xl.z-50 input[type="range"]');
    await expect(slider).toBeVisible();
    await setRangeValue(page, '.shadow-2xl.z-50 input[type="range"]', '0');
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
    const maxVal = await slider.getAttribute('max');
    await setRangeValue(page, '.shadow-2xl.z-50 input[type="range"]', maxVal ?? '100');
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
    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });

  test('4. Multi-file history isolation', async ({ page }) => {
    await createTestFile(page, 'docA.js');
    await typeTextInMonaco(page, 'console.log("A");');
    await page.waitForTimeout(4000);
    await createTestFile(page, 'docB.js');
    await typeTextInMonaco(page, 'console.log("B");');
    await page.waitForTimeout(4000);
    await page.locator('.ide-scrollbar').getByText('docA.js').click();
    await expect(page.locator('.monaco-editor').first()).toContainText('console.log("A");');
    await page.getByRole('button', { name: 'Timelapse' }).click();
    const replayerContainer = page.locator('.shadow-2xl.z-50');
    await expect(replayerContainer.getByText('console.log("A");')).toBeVisible();
    await expect(replayerContainer.getByText('console.log("B");')).not.toBeVisible();
    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
    await page.locator('.ide-scrollbar').getByText('docB.js').click();
    await expect(page.locator('.monaco-editor').first()).toContainText('console.log("B");');
    await page.getByRole('button', { name: 'Timelapse' }).click();
    await expect(replayerContainer.getByText('console.log("B");')).toBeVisible();
    await expect(replayerContainer.getByText('console.log("A");')).not.toBeVisible();
    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });
});

test.describe('Timelapse - Attribution Engine', () => {
  let workspaceId: string;
  const WS_TITLE = `Attribution-Test-${Date.now()}`;
  async function inviteViaApi(page: Page, username: string, role = 'editor') {
    await page.evaluate(async ({ wsId, username, role }) => {
      const token = localStorage.getItem('nexus_ide_token') || localStorage.getItem('token');
      const apiBase = window.location.pathname.includes('/ide') ? '/ide/api' : '/api';
      await fetch(`${apiBase}/workspace/${wsId}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ usernameOrEmail: username, role }),
      });
    }, { wsId: workspaceId, username, role });
  }
  async function getLegendAuthors(page: Page): Promise<string[]> {
    return page.evaluate(() => {
      const legend = document.querySelector('[data-testid="author-legend"]');
      if (!legend) return [];
      return Array.from(legend.querySelectorAll('[data-testid^="author-badge-"]')).map(
        el => (el as HTMLElement).dataset.testid!.replace('author-badge-', '')
      );
    });
  }
  async function getHistoryAuthorMap(page: Page, fileId: string): Promise<Record<string, any>> {
    return page.evaluate(async ({ wsId, fileId }) => {
      const token = localStorage.getItem('nexus_ide_token') || localStorage.getItem('token');
      const apiBase = window.location.pathname.includes('/ide') ? '/ide/api' : '/api';
      const res = await fetch(`${apiBase}/workspace/${wsId}/files/${fileId}/history`, {
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

  test('5. Single-user author map', async ({ page }) => {
    await createTestFile(page, 'single.js');
    await typeTextInMonaco(page, 'hello from alice');
    await page.waitForTimeout(3000);
    const fileId = await page.evaluate(async (wsId) => {
      const token = localStorage.getItem('nexus_ide_token') || localStorage.getItem('token');
      const apiBase = window.location.pathname.includes('/ide') ? '/ide/api' : '/api';
      const res = await fetch(`${apiBase}/workspace/${wsId}/files`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const files = await res.json();
      return files.find((f: any) => f.name === 'single.js')?.id ?? null;
    }, workspaceId);
    expect(fileId).toBeTruthy();
    const authorMap = await getHistoryAuthorMap(page, fileId);
    const entries = Object.values(authorMap) as any[];
    expect(entries.length).toBeGreaterThan(0);
    const usernames = entries.map((e: any) => e.username);
    expect(usernames.some((u: string) => u.toLowerCase().includes('attr_alice'))).toBe(true);
  });

  test('6. Author legend UI bar', async ({ page }) => {
    await createTestFile(page, 'legend.js');
    await typeTextInMonaco(page, 'legend test line');
    await page.waitForTimeout(3000); // wait for debounce save
    await page.getByRole('button', { name: 'Timelapse' }).click();
    const replayer = page.locator('.shadow-2xl.z-50');
    await expect(replayer.getByText('CRDT Timelapse')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="author-legend"]')).toBeVisible({ timeout: 15000 });
    const authors = await getLegendAuthors(page);
    expect(authors.length).toBeGreaterThan(0);
    expect(authors.some(a => a.toLowerCase().includes('attr_alice'))).toBe(true);
    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });

  test('7. Multi-user author legend', async ({ page, browser }) => {
    await createTestFile(page, 'collab.js');
    await typeTextInMonaco(page, 'alice line\n');
    await page.waitForTimeout(3000);
    const fileId = await page.evaluate(async (wsId) => {
      const token = localStorage.getItem('nexus_ide_token') || localStorage.getItem('token');
      const apiBase = window.location.pathname.includes('/ide') ? '/ide/api' : '/api';
      const res = await fetch(`${apiBase}/workspace/${wsId}/files`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const files = await res.json();
      return files.find((f: any) => f.name === 'collab.js')?.id ?? null;
    }, workspaceId);
    expect(fileId).toBeTruthy();
    await inviteViaApi(page, 'attr_bob', 'editor');
    const bobContext = await browser.newContext();
    const bobPage    = await bobContext.newPage();
    try {
      await login(bobPage, 'attr_bob', 'password123');
      await bobPage.goto(`${APP_URL}/ide/${workspaceId}/${fileId}`);
      await waitForBootComplete(bobPage);
      await waitForEditorModel(bobPage, 'collab.js');
      await typeTextInMonaco(bobPage, 'bob line\n');
      await bobPage.waitForTimeout(3000); // debounce save
    } finally {
      await bobContext.close();
    }
    await expect.poll(async () => {
      const authorMap = await getHistoryAuthorMap(page, fileId);
      const entries = Object.values(authorMap) as any[];
      return entries.map((e: any) => (e.username ?? '').toLowerCase());
    }, { timeout: 15000, message: 'Waiting for authorMap to contain both Alice and Bob' }).toEqual(
      expect.arrayContaining([
        expect.stringContaining('attr_alice'),
        expect.stringContaining('attr_bob'),
      ])
    );
    await page.getByRole('button', { name: 'Timelapse' }).click();
    const replayer = page.locator('.shadow-2xl.z-50');
    await expect(replayer.getByText('CRDT Timelapse')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="author-legend"]')).toBeVisible({ timeout: 15000 });
    await expect.poll(async () => {
      const authors = await getLegendAuthors(page);
      return authors.map(a => a.toLowerCase());
    }, { timeout: 15000, message: 'Waiting for timelapse legend to display both Alice and Bob' }).toEqual(
      expect.arrayContaining([
        expect.stringContaining('attr_alice'),
        expect.stringContaining('attr_bob'),
      ])
    );
    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });

  test('8. Backwards scrubbing author legend', async ({ page }) => {
    await createTestFile(page, 'scrub.js');
    await typeTextInMonaco(page, 'AAAA');
    await page.waitForTimeout(3000);
    await page.getByRole('button', { name: 'Timelapse' }).click();
    const replayer = page.locator('.shadow-2xl.z-50');
    await expect(replayer.getByText('CRDT Timelapse')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="author-legend"]')).toBeVisible({ timeout: 15000 });
    const legendAtMax = await getLegendAuthors(page);
    expect(legendAtMax.length).toBeGreaterThan(0);
    await setRangeValue(page, '.shadow-2xl.z-50 input[type="range"]', '0');
    await expect(page.locator('[data-testid="author-legend"]')).toBeHidden({ timeout: 8000 });
    const legendAtZero = await getLegendAuthors(page);
    expect(legendAtZero.length).toBe(0);
    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });

  test('6. timelapse replays characters in typing order, not final document position', async ({ page }) => {
    await createTestFile(page, 'order.js');
    await typeTextInMonaco(page, 'SECOND');
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      editor.setPosition({ lineNumber: 1, column: 1 });
      editor.focus();
    });
    await page.keyboard.type('FIRST ');
    await page.waitForTimeout(3000); // debounce save
    const finalContent = await page.evaluate(() => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      return editor.getModel()?.getValue() ?? '';
    });
    expect(finalContent).toBe('FIRST SECOND');
    await page.getByRole('button', { name: 'Timelapse' }).click();
    const replayer = page.locator('.shadow-2xl.z-50');
    await expect(replayer.getByText('CRDT Timelapse')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.shadow-2xl.z-50 input[type="range"]')).toBeVisible({ timeout: 10000 });
    const getReplayerValue = () => page.evaluate(() => {
      const editors = (window as any).monaco?.editor?.getEditors();
      return editors && editors[1] ? editors[1].getModel()?.getValue() ?? '' : '';
    });
    const maxVal = await page.locator('.shadow-2xl.z-50 input[type="range"]').getAttribute('max');
    const total = Number(maxVal);
    expect(total).toBeGreaterThanOrEqual(2); // at least 2 updates (one per typing burst)
    await setRangeValue(page, '', '0');
    await expect.poll(getReplayerValue, { timeout: 5000 }).toBe('');
    const midPoint = Math.floor(total / 2);
    await setRangeValue(page, '', String(midPoint));
    await expect.poll(getReplayerValue, { timeout: 5000 }).toContain('SECOND');
    const afterMid = await getReplayerValue();
    expect(afterMid).not.toContain('FIRST');
    await setRangeValue(page, '', String(total));
    await expect.poll(getReplayerValue, { timeout: 5000 }).toBe('FIRST SECOND');
    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });

  test('7. deleted content is visible during replay at the time it existed', async ({ page }) => {
    await createTestFile(page, 'deleted.js');
    await typeTextInMonaco(page, 'OLD');
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      editor.focus();
      const model  = editor.getModel();
      const full   = model.getFullModelRange();
      editor.executeEdits('test-delete', [{ range: full, text: '', forceMoveMarkers: true }]);
    });
    await page.waitForTimeout(500);
    await typeTextInMonaco(page, 'NEW');
    await page.waitForTimeout(3000);
    const finalContent = await page.evaluate(() =>
      (window as any).monaco.editor.getEditors()[0]?.getModel()?.getValue() ?? ''
    );
    expect(finalContent).toBe('NEW');
    await page.getByRole('button', { name: 'Timelapse' }).click();
    const replayer = page.locator('.shadow-2xl.z-50');
    await expect(replayer.getByText('CRDT Timelapse')).toBeVisible({ timeout: 10000 });
    const slider  = page.locator('.shadow-2xl.z-50 input[type="range"]');
    const maxVal  = Number(await slider.getAttribute('max'));
    expect(maxVal).toBeGreaterThanOrEqual(2);
    const getValue = () => page.evaluate(() => {
      const eds = (window as any).monaco?.editor?.getEditors();
      return eds && eds[1] ? eds[1].getModel()?.getValue() ?? '' : '';
    });
    let foundOld = false;
    for (let i = 1; i <= maxVal; i++) {
      await setRangeValue(page, '', String(i));
      const val = await getValue();
      if (val.includes('OLD') && !val.includes('NEW')) {
        foundOld = true;
        break;
      }
    }
    expect(foundOld).toBe(true);
    await setRangeValue(page, '', String(maxVal));
    await expect.poll(getValue, { timeout: 5000 }).toContain('NEW');
    expect(await getValue()).not.toContain('OLD');
    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });

  test('5. authorMap survives page reload (DB persistence verified)', async ({ page }) => {
    await createTestFile(page, 'persist.js');
    await typeTextInMonaco(page, 'persistence test');
    await page.waitForTimeout(3000); // debounce save
    await page.reload();
    const loadingEl = page.locator('text=Booting environment...');
    try { await loadingEl.waitFor({ state: 'visible', timeout: 3000 }); } catch {}
    try { await loadingEl.waitFor({ state: 'detached', timeout: 35000 }); } catch {}
    await page.locator('.ide-scrollbar').getByText('persist.js').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('.ide-scrollbar').getByText('persist.js').click();
    await page.waitForFunction((name) => {
      const eds = (window as any).monaco?.editor?.getEditors();
      return eds && eds.length > 0 && eds[0].getModel()?.uri.path.endsWith(name);
    }, 'persist.js', { timeout: 20000 });
    await page.getByRole('button', { name: 'Timelapse' }).click();
    const replayer = page.locator('.shadow-2xl.z-50');
    await expect(replayer.getByText('CRDT Timelapse')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="author-legend"]')).toBeVisible({ timeout: 15000 });
    const authors = await getLegendAuthors(page);
    expect(authors.some(a => a.toLowerCase().includes('attr_alice'))).toBe(true);
    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });
});
async function openTimelapse(page: Page) {
  const btn = page.getByRole('button', { name: 'Timelapse' });
  await btn.waitFor({ state: 'visible', timeout: 15000 });
  await btn.click();
  await expect(page.getByText('CRDT Timelapse')).toBeVisible({ timeout: 15000 });
  const rangeInput = page.locator('.shadow-2xl.z-50 input[type="range"]');
  await expect(rangeInput).toBeVisible({ timeout: 15000 });
  await expect.poll(async () => {
    const max = await rangeInput.getAttribute('max');
    return parseInt(max || '0', 10);
  }, { timeout: 15000 }).toBeGreaterThan(0);
}
async function getReplayerText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const eds = (window as any).monaco?.editor?.getEditors();
    if (!eds || eds.length === 0) return '';
    const ed = eds.length > 1 ? eds[eds.length - 1] : eds[0];
    return ed.getModel()?.getValue() ?? '';
  });
}
async function getSnapshotText(page: Page, position: number): Promise<string> {
  await setRangeValue(page, '', String(position));
  await page.waitForTimeout(150);
  return getReplayerText(page);
}
async function getSnapshotMax(page: Page): Promise<number> {
  return getSliderMax(page);
}

test.describe.skip('Timelapse Snapshot Engine (Feature Disabled)', () => {
  let workspaceId: string;

  test.beforeEach(async ({ page }) => {
    await login(page, 'testuser1', 'password123');
    workspaceId = await createTestWorkspace(page, `SnapEngine-${Date.now()}`);
  });

  test.afterEach(async ({ page }) => {
    await deleteTestWorkspace(page, workspaceId);
  });
  test('snapshot array is populated with correct final state on open', async ({ page }) => {
    await createTestFile(page, 'snap_basic.js');
    await typeTextInMonaco(page, 'hello world');
    await page.waitForTimeout(3000); // debounce save
    await openTimelapse(page);
    const maxPos   = await getSnapshotMax(page);
    const finalTxt = await getSnapshotText(page, maxPos);
    expect(maxPos).toBeGreaterThan(0);
    expect(finalTxt).toBe('hello world');
    const zeroTxt = await getSnapshotText(page, 0);
    expect(zeroTxt).toBe('');
    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });

  test('each snapshot position adds exactly one character to the text', async ({ page }) => {
    await createTestFile(page, 'snap_incremental.js');
    await typeTextInMonaco(page, 'A');
    await page.waitForTimeout(1000);
    await typeTextInMonaco(page, 'B');
    await page.waitForTimeout(1000);
    await typeTextInMonaco(page, 'C');
    await page.waitForTimeout(3000);
    await openTimelapse(page);
    const maxPos = await getSnapshotMax(page);
    expect(maxPos).toBeGreaterThanOrEqual(3);
    const atMax = await getSnapshotText(page, maxPos);
    expect(atMax).toBe('ABC');
    const atEarly = await getSnapshotText(page, 1);
    expect(atEarly.length).toBeLessThan(atMax.length);
    expect(atEarly.length).toBeGreaterThan(0);
    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });

  test('deleted characters appear in snapshots before their deletion position', async ({ page }) => {
    await createTestFile(page, 'snap_delete.js');
    await typeTextInMonaco(page, 'OLD');
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      const full = editor.getModel().getFullModelRange();
      editor.executeEdits('del', [{ range: full, text: '', forceMoveMarkers: true }]);
    });
    await page.waitForTimeout(500);
    await typeTextInMonaco(page, 'NEW');
    await page.waitForTimeout(3000);
    const finalContent = await page.evaluate(() =>
      (window as any).monaco.editor.getEditors()[0]?.getModel()?.getValue() ?? ''
    );
    expect(finalContent).toBe('NEW');
    await openTimelapse(page);
    const maxPos = await getSnapshotMax(page);
    expect(maxPos).toBeGreaterThanOrEqual(2);
    let foundOld = false;
    for (let i = 1; i < maxPos; i++) {
      const text = await getSnapshotText(page, i);
      if (text.includes('OLD') && !text.includes('NEW')) {
        foundOld = true;
        break;
      }
    }
    expect(foundOld).toBe(true);
    const atMax = await getSnapshotText(page, maxPos);
    expect(atMax).toContain('NEW');
    expect(atMax).not.toContain('OLD');
    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });

  test('setting clock via imperative API matches snapshot text', async ({ page }) => {
    await createTestFile(page, 'snap_api.js');
    await typeTextInMonaco(page, 'WXYZ');
    await page.waitForTimeout(3000);
    await openTimelapse(page);
    const maxPos = await getSnapshotMax(page);
    await setRangeValue(page, '', '0');
    await expect.poll(async () => {
      const v = await page.evaluate(() => {
        const eds = (window as any).monaco?.editor?.getEditors();
        return eds && eds[1] ? eds[1].getModel()?.getValue() ?? '' : null;
      });
      return v;
    }, { timeout: 5000 }).toBe(await getSnapshotText(page, 0));
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

  test('insertion-order replay: characters appear at their typing position, not document position', async ({ page }) => {
    await createTestFile(page, 'snap_order.js');
    await typeTextInMonaco(page, 'SECOND');
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const ed = (window as any).monaco.editor.getEditors()[0];
      ed.setPosition({ lineNumber: 1, column: 1 });
      ed.focus();
    });
    await page.keyboard.type('FIRST ');
    await page.waitForTimeout(3000);
    const final = await page.evaluate(() =>
      (window as any).monaco.editor.getEditors()[0]?.getModel()?.getValue() ?? ''
    );
    expect(final).toBe('FIRST SECOND');
    await openTimelapse(page);
    const maxPos = await getSnapshotMax(page);
    expect(maxPos).toBeGreaterThanOrEqual(2); // at least 2 update entries
    expect(await getSnapshotText(page, 0)).toBe('');
    const midPos = Math.floor(maxPos / 2);
    const atMid = await getSnapshotText(page, midPos);
    expect(atMid).toContain('SECOND');
    expect(atMid).not.toContain('FIRST');
    const atMax = await getSnapshotText(page, maxPos);
    expect(atMax).toBe('FIRST SECOND');
    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });

  test('complex edit-delete-retype sequence shows correct text at each phase', async ({ page }) => {
    await createTestFile(page, 'snap_complex.js');
    await typeTextInMonaco(page, 'console.log("hello world")');
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const ed = (window as any).monaco.editor.getEditors()[0];
      const full = ed.getModel().getFullModelRange();
      ed.executeEdits('del', [{ range: full, text: '', forceMoveMarkers: true }]);
    });
    await page.waitForTimeout(500);
    await typeTextInMonaco(page, 'let a=5;');
    await page.keyboard.press('Enter');
    await typeTextInMonaco(page, 'let b=6;');
    await page.keyboard.press('Enter');
    await typeTextInMonaco(page, 'console.log(a+b);');
    await page.waitForTimeout(3000);
    const finalContent = await page.evaluate(() =>
      (window as any).monaco.editor.getEditors()[0]?.getModel()?.getValue() ?? ''
    );
    expect(finalContent).toContain('let a=5;');
    expect(finalContent).toContain('let b=6;');
    expect(finalContent).toContain('console.log(a+b);');
    expect(finalContent).not.toContain('hello world');
    await openTimelapse(page);
    const maxPos = await getSnapshotMax(page);
    const earlyPos = Math.max(1, Math.floor(maxPos / 4));
    const atPhaseOne = await getSnapshotText(page, earlyPos);
    expect(atPhaseOne).toContain('console');
    expect(atPhaseOne).not.toContain('let a=5;');
    const atMax = await getSnapshotText(page, maxPos);
    expect(atMax).toContain('let a=5;');
    expect(atMax).toContain('let b=6;');
    expect(atMax).toContain('console.log(a+b);');
    expect(atMax).not.toContain('hello world');
    expect(atMax.includes('hello world') && atMax.includes('let a=5;')).toBe(false);
    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });

  test('snapshot count exceeds final character count when deletions occurred', async ({ page }) => {
    await createTestFile(page, 'snap_count.js');
    await typeTextInMonaco(page, 'ABCDE');
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      const ed = (window as any).monaco.editor.getEditors()[0];
      const full = ed.getModel().getFullModelRange();
      ed.executeEdits('del', [{ range: full, text: '', forceMoveMarkers: true }]);
    });
    await page.waitForTimeout(500);
    await typeTextInMonaco(page, 'XYZ');
    await page.waitForTimeout(3000);
    await openTimelapse(page);
    const maxPos = await getSnapshotMax(page);
    const finalText = await getSnapshotText(page, maxPos);
    expect(finalText).toBe('XYZ');
    expect(finalText.length).toBe(3);
    expect(maxPos).toBeGreaterThan(3);
    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });
});

test.describe('Timelapse Full-Fidelity Replay', () => {
  let workspaceId: string;

  test.beforeEach(async ({ page }) => {
    await login(page, 'testuser1', 'password123');
    workspaceId = await createTestWorkspace(page, `FullFidelity-${Date.now()}`);
  });

  test.afterEach(async ({ page }) => {
    await deleteTestWorkspace(page, workspaceId);
  });
  const getReplayerText = (page: Page) => page.evaluate(() => {
    const eds = (window as any).monaco?.editor?.getEditors();
    return eds && eds[1] ? eds[1].getModel()?.getValue() ?? '' : '';
  });

  test('19. New file replay data', async ({ page }) => {
    await createTestFile(page, 'fidelity.js');
    await typeTextInMonaco(page, 'test');
    await page.waitForTimeout(3000); // debounce save
    const response = await page.evaluate(async (wsId) => {
      const token = localStorage.getItem('nexus_ide_token') || localStorage.getItem('token');
      const apiBase = window.location.pathname.includes('/ide') ? '/ide/api' : '/api';
      const filesRes = await fetch(`${apiBase}/workspace/${wsId}/files`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const files = await filesRes.json();
      const fileId = files.find((f: any) => f.name === 'fidelity.js')?.id;
      if (!fileId) return { hasUpdates: false, hasYjsState: false };
      const historyRes = await fetch(`${apiBase}/workspace/${wsId}/files/${fileId}/history`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await historyRes.json();
      return {
        hasUpdates:  Array.isArray(json.updates) && json.updates.length > 0,
        hasYjsState: !!json.yjsState,
        updateCount: json.updates?.length ?? 0,
        hasAuthorMap: !!json.authorMap,
      };
    }, workspaceId);
    expect(response.hasUpdates || response.hasYjsState).toBe(true);
    expect(response.hasAuthorMap).toBe(true);
  });

  test('20. Replay mode compatibility', async ({ page }) => {
    await createTestFile(page, 'no_badge.js');
    await typeTextInMonaco(page, 'hello');
    await page.waitForTimeout(3000);
    await page.getByRole('button', { name: 'Timelapse' }).click();
    await expect(page.getByText('CRDT Timelapse')).toBeVisible({ timeout: 10000 });
    await expect.poll(async () => {
      return page.evaluate(() => {
        const eds = (window as any).monaco?.editor?.getEditors();
        return eds && eds[1] ? eds[1].getModel()?.getValue() ?? '' : '';
      });
    }, { timeout: 5000 }).toBe('hello');
    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });

  test('21. Exact deletion timeline replay', async ({ page }) => {
    await createTestFile(page, 'exact_del.js');
    await typeTextInMonaco(page, 'OLD');
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const ed = (window as any).monaco.editor.getEditors()[0];
      ed.executeEdits('del', [{ range: ed.getModel().getFullModelRange(), text: '', forceMoveMarkers: true }]);
    });
    await page.waitForTimeout(500);
    await typeTextInMonaco(page, 'NEW');
    await page.waitForTimeout(3000);
    expect(await page.evaluate(() =>
      (window as any).monaco.editor.getEditors()[0]?.getModel()?.getValue() ?? ''
    )).toBe('NEW');
    await page.getByRole('button', { name: 'Timelapse' }).click();
    await expect(page.getByText('CRDT Timelapse')).toBeVisible({ timeout: 10000 });
    const maxPos = await getSliderMax(page);
    expect(maxPos).toBeGreaterThanOrEqual(2);
    let foundOld = false;
    for (let i = 1; i < maxPos; i++) {
      await setRangeValue(page, '', String(i));
      const text = await getReplayerText(page);
      if (text.includes('OLD') && !text.includes('NEW')) {
        foundOld = true;
        break;
      }
    }
    expect(foundOld).toBe(true);
    await setRangeValue(page, '', String(maxPos));
    await expect.poll(() => getReplayerText(page), { timeout: 5000 }).toBe('NEW');
    await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  });
});
