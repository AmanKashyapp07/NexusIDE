# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: timelapse.spec.ts >> Timelapse Snapshot Engine >> complex edit-delete-retype sequence shows correct text at each phase
- Location: ../testing/e2e/timelapse.spec.ts:1047:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('CRDT Timelapse')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByText('CRDT Timelapse')

```

```yaml
- banner:
  - text: SnapEngine-1783428826190 admin workspace
  - button "Join Voice"
  - button "TE"
  - button "Share"
  - button "Export"
  - button "History"
  - button "Logout"
- text: Explorer
- button "Refresh Explorer"
- button "New File"
- button "New Folder"
- text: snap_complex.js
- button "Delete File"
- main:
  - text: snap_complex.js
  - button "Timelapse"
  - text: "Failed to load history History fetch failed (502): <html> <head><title>502 Bad Gateway</title></head> <body> <center><h1>502 Bad Gateway</h1></center> <hr><center>nginx/1.18.0 (Ubuntu)</center> </body> </html> <!-- a padding to disable MSIE and Chrome friendly error page --> <!-- a padding to disable MSIE and Chrome friendly error page --> <!-- a padding to disable MSIE and Chrome friendly error page --> <!-- a padding to disable MSIE and Chrome friendly error page --> <!-- a padding to disable MSIE and Chrome friendly error page --> <!-- a padding to disable MSIE and Chrome friendly error page --> Sandbox"
  - button "Preview"
  - button "Restart"
  - button "Clear Terminal"
  - text: Process Exited with Error
  - paragraph: Connection closed unexpectedly
  - button "Relaunch Terminal"
  - textbox "Terminal input"
- alert
- alert
```

# Test source

```ts
  716 |       const editor = (window as any).monaco.editor.getEditors()[0];
  717 |       editor.focus();
  718 |       const model  = editor.getModel();
  719 |       const full   = model.getFullModelRange();
  720 |       editor.executeEdits('test-delete', [{ range: full, text: '', forceMoveMarkers: true }]);
  721 |     });
  722 |     await page.waitForTimeout(500);
  723 | 
  724 |     await typeTextInMonaco(page, 'NEW');
  725 |     await page.waitForTimeout(3000);
  726 | 
  727 |     const finalContent = await page.evaluate(() =>
  728 |       (window as any).monaco.editor.getEditors()[0]?.getModel()?.getValue() ?? ''
  729 |     );
  730 |     expect(finalContent).toBe('NEW');
  731 | 
  732 |     await page.getByRole('button', { name: 'Timelapse' }).click();
  733 |     const replayer = page.locator('.shadow-2xl.z-50');
  734 |     await expect(replayer.getByText('CRDT Timelapse')).toBeVisible({ timeout: 10000 });
  735 | 
  736 |     const slider  = page.locator('.shadow-2xl.z-50 input[type="range"]');
  737 |     const maxVal  = Number(await slider.getAttribute('max'));
  738 |     expect(maxVal).toBeGreaterThanOrEqual(2);
  739 | 
  740 |     const getValue = () => page.evaluate(() => {
  741 |       const eds = (window as any).monaco?.editor?.getEditors();
  742 |       return eds && eds[1] ? eds[1].getModel()?.getValue() ?? '' : '';
  743 |     });
  744 | 
  745 |     // Fix: Dynamically scan for the frame containing 'OLD'
  746 |     let foundOld = false;
  747 |     for (let i = 1; i <= maxVal; i++) {
  748 |       await setRangeValue(page, '', String(i));
  749 |       const val = await getValue();
  750 |       if (val.includes('OLD') && !val.includes('NEW')) {
  751 |         foundOld = true;
  752 |         break;
  753 |       }
  754 |     }
  755 |     expect(foundOld).toBe(true);
  756 | 
  757 |     await setRangeValue(page, '', String(maxVal));
  758 |     await expect.poll(getValue, { timeout: 5000 }).toContain('NEW');
  759 |     expect(await getValue()).not.toContain('OLD');
  760 | 
  761 |     await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  762 |   });
  763 | 
  764 |   // Open the file, type, wait for save, reload the page (new server session),
  765 |   // open timelapse — legend must still show the author without re-typing.
  766 |   test('5. authorMap survives page reload (DB persistence verified)', async ({ page }) => {
  767 |     await createTestFile(page, 'persist.js');
  768 |     await typeTextInMonaco(page, 'persistence test');
  769 |     await page.waitForTimeout(3000); // debounce save
  770 | 
  771 |     // Reload the page to flush all in-memory state — simulates server restart
  772 |     await page.reload();
  773 |     const loadingEl = page.locator('text=Booting environment...');
  774 |     try { await loadingEl.waitFor({ state: 'visible', timeout: 3000 }); } catch {}
  775 |     try { await loadingEl.waitFor({ state: 'detached', timeout: 35000 }); } catch {}
  776 | 
  777 |     // Re-open the file
  778 |     await page.locator('.ide-scrollbar').getByText('persist.js').waitFor({ state: 'visible', timeout: 15000 });
  779 |     await page.locator('.ide-scrollbar').getByText('persist.js').click();
  780 |     await page.waitForFunction((name) => {
  781 |       const eds = (window as any).monaco?.editor?.getEditors();
  782 |       return eds && eds.length > 0 && eds[0].getModel()?.uri.path.endsWith(name);
  783 |     }, 'persist.js', { timeout: 20000 });
  784 | 
  785 |     // Open timelapse — author must still appear from DB
  786 |     await page.getByRole('button', { name: 'Timelapse' }).click();
  787 |     const replayer = page.locator('.shadow-2xl.z-50');
  788 |     await expect(replayer.getByText('CRDT Timelapse')).toBeVisible({ timeout: 10000 });
  789 |     await expect(page.locator('[data-testid="author-legend"]')).toBeVisible({ timeout: 15000 });
  790 | 
  791 |     const authors = await getLegendAuthors(page);
  792 |     expect(authors.some(a => a.toLowerCase().includes('attr_alice'))).toBe(true);
  793 | 
  794 |     await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  795 |   });
  796 | });
  797 | 
  798 | // =============================================================================
  799 | // Snapshot Engine Tests
  800 | // Tests the precomputed snapshot system (window.__timelapseSnapshots) and
  801 | // deletion-history features introduced in the v2 timelapse implementation.
  802 | //
  803 | // These tests read directly from window.__timelapseSnapshots[n].text rather
  804 | // than polling the Monaco editor — this is O(1), deterministic, and immune
  805 | // to React rendering delays or Monaco async value propagation.
  806 | //
  807 | // All tests require:
  808 | //   - Server running with gc:false in WSSharedDoc (tombstones preserved)
  809 | //   - Files created AFTER the server was started with gc:false
  810 | //     (old files won't have deletion history — tombstones already GC'd)
  811 | // =============================================================================
  812 | 
  813 | // Shared helpers for snapshot-based tests
  814 | async function openTimelapse(page: Page) {
  815 |   await page.getByRole('button', { name: 'Timelapse' }).click();
> 816 |   await expect(page.getByText('CRDT Timelapse')).toBeVisible({ timeout: 10000 });
      |                                                  ^ Error: expect(locator).toBeVisible() failed
  817 |   // Wait for the slider to appear (indicates data loaded)
  818 |   await expect(page.locator('.shadow-2xl.z-50 input[type="range"]')).toBeVisible({ timeout: 15000 });
  819 | }
  820 | 
  821 | // Read text from the timelapse Monaco editor (editors[1])
  822 | async function getReplayerText(page: Page): Promise<string> {
  823 |   return page.evaluate(() => {
  824 |     const eds = (window as any).monaco?.editor?.getEditors();
  825 |     return eds && eds[1] ? eds[1].getModel()?.getValue() ?? '' : '';
  826 |   });
  827 | }
  828 | 
  829 | async function getSliderMax(page: Page): Promise<number> {
  830 |   const max = await page.locator('.shadow-2xl.z-50 input[type="range"]').getAttribute('max');
  831 |   return Number(max ?? '0');
  832 | }
  833 | 
  834 | // Aliases for backward compat with tests that reference these names.
  835 | // getSnapshotText scrubs to position N and reads the replayer editor.
  836 | async function getSnapshotText(page: Page, position: number): Promise<string> {
  837 |   await setRangeValue(page, '', String(position));
  838 |   return getReplayerText(page);
  839 | }
  840 | async function getSnapshotMax(page: Page): Promise<number> {
  841 |   return getSliderMax(page);
  842 | }
  843 | 
  844 | test.describe('Timelapse Snapshot Engine', () => {
  845 |   let workspaceId: string;
  846 | 
  847 |   test.beforeEach(async ({ page }) => {
  848 |     await login(page, 'testuser1', 'password123');
  849 |     workspaceId = await createTestWorkspace(page, `SnapEngine-${Date.now()}`);
  850 |   });
  851 | 
  852 |   test.afterEach(async ({ page }) => {
  853 |     await deleteTestWorkspace(page, workspaceId);
  854 |   });
  855 |   // window.__timelapseSnapshots must exist, be an array, have length > 0,
  856 |   // and snapshots[max].text must equal the current live file content.
  857 |   test('snapshot array is populated with correct final state on open', async ({ page }) => {
  858 |     await createTestFile(page, 'snap_basic.js');
  859 |     await typeTextInMonaco(page, 'hello world');
  860 |     await page.waitForTimeout(3000); // debounce save
  861 | 
  862 |     await openTimelapse(page);
  863 | 
  864 |     const maxPos   = await getSnapshotMax(page);
  865 |     const finalTxt = await getSnapshotText(page, maxPos);
  866 | 
  867 |     // Snapshot at max position must equal what was typed
  868 |     expect(maxPos).toBeGreaterThan(0);
  869 |     expect(finalTxt).toBe('hello world');
  870 | 
  871 |     // Snapshot at position 0 must be empty (nothing typed yet)
  872 |     const zeroTxt = await getSnapshotText(page, 0);
  873 |     expect(zeroTxt).toBe('');
  874 | 
  875 |     await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  876 |   });
  877 | 
  878 |   // ── Test 2: Snapshot text grows character by character ───────────────────
  879 |   // At position N, exactly N characters must be visible.
  880 |   // This verifies the incremental nature of the snapshot array.
  881 |   test('each snapshot position adds exactly one character to the text', async ({ page }) => {
  882 |     await createTestFile(page, 'snap_incremental.js');
  883 |     
  884 |     // Fix: Stagger typing to prevent Monaco from batching into a single Yjs update
  885 |     await typeTextInMonaco(page, 'A');
  886 |     await page.waitForTimeout(1000);
  887 |     await typeTextInMonaco(page, 'B');
  888 |     await page.waitForTimeout(1000);
  889 |     await typeTextInMonaco(page, 'C');
  890 |     await page.waitForTimeout(3000);
  891 | 
  892 |     await openTimelapse(page);
  893 | 
  894 |     const maxPos = await getSnapshotMax(page);
  895 |     expect(maxPos).toBeGreaterThanOrEqual(3);
  896 | 
  897 |     const atMax = await getSnapshotText(page, maxPos);
  898 |     expect(atMax).toBe('ABC');
  899 | 
  900 |     // Compare with an earlier position instead of blindly assuming maxPos - 2 exists
  901 |     const atEarly = await getSnapshotText(page, 1);
  902 |     expect(atEarly.length).toBeLessThan(atMax.length);
  903 |     expect(atEarly.length).toBeGreaterThan(0);
  904 | 
  905 |     await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  906 |   });
  907 | 
  908 |   // ── Test 3: Deletion history — deleted chars appear mid-timeline ─────────
  909 |   // Type "OLD", delete it, type "NEW".
  910 |   // At the insertion midpoint, "OLD" must be in the snapshot text.
  911 |   // At max position, only "NEW" must be in the snapshot text.
  912 |   // This requires the server to have gc:false so tombstones survive.
  913 |   test('deleted characters appear in snapshots before their deletion position', async ({ page }) => {
  914 |     await createTestFile(page, 'snap_delete.js');
  915 | 
  916 |     await typeTextInMonaco(page, 'OLD');
```