# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: timelapse.spec.ts >> Timelapse Full-Fidelity Replay >> keyboard shortcuts control playback
- Location: ../testing/e2e/timelapse.spec.ts:1283:7

# Error details

```
Error: expect(received).toBeLessThan(expected)

Expected: < 5
Received:   5
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e3]:
    - banner [ref=e4]:
      - generic [ref=e6] [cursor=pointer]:
        - img [ref=e8]
        - generic [ref=e10]:
          - generic [ref=e11]:
            - generic [ref=e12]: FullFidelity-1783450103363
            - 'generic "Status: connected" [ref=e13]'
          - generic [ref=e14]: admin workspace
      - generic [ref=e15]:
        - button "Join Voice" [ref=e16]:
          - img [ref=e17]
          - generic [ref=e20]: Join Voice
        - button "TE" [ref=e23]:
          - generic "Jump to testuser1's cursor" [ref=e25] [cursor=pointer]: TE
          - img [ref=e27]
        - generic [ref=e29]:
          - button "Share" [ref=e30]:
            - img [ref=e31]
            - text: Share
          - button "Export" [ref=e36]:
            - img [ref=e37]
            - text: Export
          - button "History" [ref=e40]:
            - img [ref=e41]
            - text: History
          - button "Logout" [ref=e45]:
            - img [ref=e46]
    - generic [ref=e49]:
      - generic [ref=e51]:
        - generic [ref=e52]:
          - generic [ref=e53]: Explorer
          - generic [ref=e54]:
            - button "Refresh Explorer" [ref=e55]:
              - img [ref=e56]
            - button "New File" [ref=e61]:
              - img [ref=e62]
            - button "New Folder" [ref=e65]:
              - img [ref=e66]
        - generic [ref=e70] [cursor=pointer]:
          - generic [ref=e72]:
            - img [ref=e74]
            - generic [ref=e77]: keys.js
          - button "Delete File" [ref=e79]:
            - img [ref=e80]
      - main [ref=e83]:
        - generic [ref=e84]:
          - generic [ref=e86]:
            - generic [ref=e89]:
              - img [ref=e90]
              - generic [ref=e93]: keys.js
            - button "Timelapse" [active] [ref=e94]:
              - img [ref=e95]
              - text: Timelapse
          - generic [ref=e101]:
            - generic [ref=e102]:
              - generic [ref=e103]:
                - img [ref=e104]
                - generic [ref=e108]: keys.js
                - generic [ref=e109]: CRDT Timelapse
              - button "Close timelapse" [ref=e110]:
                - img [ref=e111]
            - generic [ref=e114]:
              - generic [ref=e115]: "Authors:"
              - generic [ref=e118]: testuser1
            - code [ref=e122]:
              - generic [ref=e123]:
                - textbox "Editor content" [ref=e124]
                - textbox [ref=e125]
                - generic [ref=e130]: "1"
                - generic [ref=e136]: ABCDE
            - generic [ref=e138]:
              - generic [ref=e139]:
                - button "Back to start (Home)" [ref=e140]:
                  - img [ref=e141]
                - button "Step back (←)" [ref=e144]:
                  - img [ref=e145]
                - button "Play (space)" [ref=e147]:
                  - img [ref=e148]
                - button "Step forward (→)" [ref=e150]:
                  - img [ref=e151]
                - button "1x" [ref=e153]
                - slider [ref=e155] [cursor=pointer]: "1"
                - generic [ref=e156]: 1 / 1
              - generic [ref=e158]: space play/pause · ←/→ step · home/end jump
        - generic [ref=e159]:
          - generic [ref=e160]:
            - generic [ref=e161]:
              - img [ref=e162]
              - generic [ref=e165]: Sandbox
            - generic [ref=e166]:
              - button "Preview" [ref=e167]:
                - img [ref=e168]
                - text: Preview
              - button "Restart" [ref=e171]:
                - img [ref=e172]
                - text: Restart
          - generic [ref=e176]:
            - button "Clear Terminal" [ref=e178]:
              - img [ref=e179]
            - generic [ref=e186]:
              - textbox "Terminal input" [ref=e187]
              - generic:
                - generic:
                  - generic: sandbox
                  - generic: ":"
                  - generic: ~
                  - generic: "#"
  - generic [ref=e188]:
    - alert
    - alert
```

# Test source

```ts
  1209 |     // Must always have authorMap
  1210 |     expect(response.hasAuthorMap).toBe(true);
  1211 |   });
  1212 | 
  1213 |   // ── Test 2: Timelapse opens without crashing in either mode ─────────────────
  1214 |   // Whether in full-fidelity or legacy mode, the replayer should open successfully
  1215 |   // and show the final content at max position.
  1216 |   test('timelapse opens and displays content regardless of replay mode', async ({ page }) => {
  1217 |     await createTestFile(page, 'no_badge.js');
  1218 |     await typeTextInMonaco(page, 'hello');
  1219 |     await page.waitForTimeout(3000);
  1220 | 
  1221 |     await page.getByRole('button', { name: 'Timelapse' }).click();
  1222 |     await expect(page.getByText('CRDT Timelapse')).toBeVisible({ timeout: 10000 });
  1223 | 
  1224 |     // Fix: Removed the invalid Node.js window reference outside evaluate()
  1225 |     await expect.poll(async () => {
  1226 |       return page.evaluate(() => {
  1227 |         const eds = (window as any).monaco?.editor?.getEditors();
  1228 |         return eds && eds[1] ? eds[1].getModel()?.getValue() ?? '' : '';
  1229 |       });
  1230 |     }, { timeout: 5000 }).toBe('hello');
  1231 | 
  1232 |     await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  1233 |   });
  1234 | 
  1235 |   // ── Test 3: Exact deletion replay — type, delete, retype ──────────────────
  1236 |   // With the updates stream, deletions are replayed at the exact moment they
  1237 |   // occurred, not approximated. At the midpoint "OLD" is visible and "NEW" isn't.
  1238 |   test('exact deletion replay shows deleted text at correct timeline position', async ({ page }) => {
  1239 |     await createTestFile(page, 'exact_del.js');
  1240 | 
  1241 |     await typeTextInMonaco(page, 'OLD');
  1242 |     await page.waitForTimeout(1500);
  1243 | 
  1244 |     await page.evaluate(() => {
  1245 |       const ed = (window as any).monaco.editor.getEditors()[0];
  1246 |       ed.executeEdits('del', [{ range: ed.getModel().getFullModelRange(), text: '', forceMoveMarkers: true }]);
  1247 |     });
  1248 |     await page.waitForTimeout(500);
  1249 | 
  1250 |     await typeTextInMonaco(page, 'NEW');
  1251 |     await page.waitForTimeout(3000);
  1252 | 
  1253 |     expect(await page.evaluate(() =>
  1254 |       (window as any).monaco.editor.getEditors()[0]?.getModel()?.getValue() ?? ''
  1255 |     )).toBe('NEW');
  1256 | 
  1257 |     await page.getByRole('button', { name: 'Timelapse' }).click();
  1258 |     await expect(page.getByText('CRDT Timelapse')).toBeVisible({ timeout: 10000 });
  1259 |     
  1260 |     const maxPos = await getSliderMax(page);
  1261 |     expect(maxPos).toBeGreaterThanOrEqual(2);
  1262 | 
  1263 |     // Fix: Dynamically scrub to find 'OLD'
  1264 |     let foundOld = false;
  1265 |     for (let i = 1; i < maxPos; i++) {
  1266 |       await setRangeValue(page, '', String(i));
  1267 |       const text = await getReplayerText(page);
  1268 |       if (text.includes('OLD') && !text.includes('NEW')) {
  1269 |         foundOld = true;
  1270 |         break;
  1271 |       }
  1272 |     }
  1273 |     expect(foundOld).toBe(true);
  1274 | 
  1275 |     await setRangeValue(page, '', String(maxPos));
  1276 |     await expect.poll(() => getReplayerText(page), { timeout: 5000 }).toBe('NEW');
  1277 | 
  1278 |     await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  1279 |   });
  1280 | 
  1281 |   // ── Test 4: Keyboard shortcuts ─────────────────────────────────────────────
  1282 |   // space = play/pause, arrows = step, home/end = jump
  1283 |   test('keyboard shortcuts control playback', async ({ page }) => {
  1284 |     await createTestFile(page, 'keys.js');
  1285 |     await typeTextInMonaco(page, 'ABCDE');
  1286 |     await page.waitForTimeout(3000);
  1287 | 
  1288 |     await page.getByRole('button', { name: 'Timelapse' }).click();
  1289 |     await expect(page.getByText('CRDT Timelapse')).toBeVisible({ timeout: 10000 });
  1290 |     await expect(page.locator('.shadow-2xl.z-50 input[type="range"]')).toBeVisible({ timeout: 10000 });
  1291 | 
  1292 |     // Home key → goes to 0
  1293 |     await page.keyboard.press('Home');
  1294 |     await page.waitForTimeout(200);
  1295 |     await expect.poll(() => getReplayerText(page), { timeout: 3000 }).toBe('');
  1296 | 
  1297 |     // End key → goes to max
  1298 |     await page.keyboard.press('End');
  1299 |     await page.waitForTimeout(200);
  1300 |     await expect.poll(() => getReplayerText(page), { timeout: 3000 }).toBe('ABCDE');
  1301 | 
  1302 |     // Go to start, then arrow right to step forward
  1303 |     await page.keyboard.press('Home');
  1304 |     await page.waitForTimeout(200);
  1305 |     await page.keyboard.press('ArrowRight');
  1306 |     await page.waitForTimeout(200);
  1307 |     const afterOneStep = await getReplayerText(page);
  1308 |     expect(afterOneStep.length).toBeGreaterThan(0);
> 1309 |     expect(afterOneStep.length).toBeLessThan(5);
       |                                 ^ Error: expect(received).toBeLessThan(expected)
  1310 | 
  1311 |     await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  1312 |   });
  1313 | 
  1314 |   // ── Test 5: Play speed toggle ──────────────────────────────────────────────
  1315 |   // Clicking the speed button cycles through 1x → 2x → 4x → 0.5x → 1x
  1316 |   test('speed toggle cycles through playback speeds', async ({ page }) => {
  1317 |     await createTestFile(page, 'speed.js');
  1318 |     await typeTextInMonaco(page, 'speed test');
  1319 |     await page.waitForTimeout(3000);
  1320 | 
  1321 |     await page.getByRole('button', { name: 'Timelapse' }).click();
  1322 |     await expect(page.getByText('CRDT Timelapse')).toBeVisible({ timeout: 10000 });
  1323 | 
  1324 |     // Initial speed is 1x
  1325 |     const speedBtn = page.locator('.shadow-2xl.z-50 button[title="Playback speed"]');
  1326 |     await expect(speedBtn).toContainText('1x');
  1327 | 
  1328 |     // Click to cycle: 1x → 2x
  1329 |     await speedBtn.click();
  1330 |     await expect(speedBtn).toContainText('2x');
  1331 | 
  1332 |     // Click again: 2x → 4x
  1333 |     await speedBtn.click();
  1334 |     await expect(speedBtn).toContainText('4x');
  1335 | 
  1336 |     // Click again: 4x → 0.5x
  1337 |     await speedBtn.click();
  1338 |     await expect(speedBtn).toContainText('0.5x');
  1339 | 
  1340 |     // Click again: 0.5x → 1x
  1341 |     await speedBtn.click();
  1342 |     await expect(speedBtn).toContainText('1x');
  1343 | 
  1344 |     await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  1345 |   });
  1346 | 
  1347 |   // ── Test 6: Edit-density heatmap is rendered ───────────────────────────────
  1348 |   // The scrubber area should contain heatmap bars showing edit density.
  1349 |   test('edit-density heatmap bars are rendered under the scrubber', async ({ page }) => {
  1350 |     await createTestFile(page, 'heatmap.js');
  1351 |     await typeTextInMonaco(page, 'some content here for heatmap');
  1352 |     await page.waitForTimeout(3000);
  1353 | 
  1354 |     await page.getByRole('button', { name: 'Timelapse' }).click();
  1355 |     await expect(page.getByText('CRDT Timelapse')).toBeVisible({ timeout: 10000 });
  1356 | 
  1357 |     // Heatmap bars are rendered as divs with bg-indigo-400/30
  1358 |     const heatmapBars = page.locator('.shadow-2xl.z-50 .bg-indigo-400\\/30');
  1359 |     const count = await heatmapBars.count();
  1360 |     expect(count).toBeGreaterThan(0);
  1361 | 
  1362 |     await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  1363 |   });
  1364 | 
  1365 |   // ── Test 7: Step buttons work correctly ────────────────────────────────────
  1366 |   // The < and > buttons should step one frame at a time.
  1367 |   test('step back and step forward buttons navigate one frame at a time', async ({ page }) => {
  1368 |     await createTestFile(page, 'steps.js');
  1369 |     
  1370 |     // Fix: Stagger typing to guarantee at least 2 playback frames
  1371 |     await typeTextInMonaco(page, 'X');
  1372 |     await page.waitForTimeout(1000);
  1373 |     await typeTextInMonaco(page, 'Y');
  1374 |     await page.waitForTimeout(3000);
  1375 | 
  1376 |     await page.getByRole('button', { name: 'Timelapse' }).click();
  1377 |     await expect(page.getByText('CRDT Timelapse')).toBeVisible({ timeout: 10000 });
  1378 |     await expect(page.locator('.shadow-2xl.z-50 input[type="range"]')).toBeVisible({ timeout: 10000 });
  1379 | 
  1380 |     await page.locator('.shadow-2xl.z-50 button[title="Back to start (Home)"]').click();
  1381 |     await page.waitForTimeout(200);
  1382 |     await expect.poll(() => getReplayerText(page), { timeout: 3000 }).toBe('');
  1383 | 
  1384 |     await page.locator('.shadow-2xl.z-50 button[title="Step forward (→)"]').click();
  1385 |     await page.waitForTimeout(200);
  1386 |     const afterStep1 = await getReplayerText(page);
  1387 |     expect(afterStep1.length).toBeGreaterThan(0);
  1388 | 
  1389 |     await page.locator('.shadow-2xl.z-50 button[title="Step forward (→)"]').click();
  1390 |     await page.waitForTimeout(200);
  1391 |     const afterStep2 = await getReplayerText(page);
  1392 |     expect(afterStep2.length).toBeGreaterThan(afterStep1.length);
  1393 | 
  1394 |     await page.locator('.shadow-2xl.z-50 button[title="Step back (←)"]').click();
  1395 |     await page.waitForTimeout(200);
  1396 |     const afterStepBack = await getReplayerText(page);
  1397 |     expect(afterStepBack).toBe(afterStep1);
  1398 | 
  1399 |     await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  1400 |   });
  1401 | });
  1402 | 
```