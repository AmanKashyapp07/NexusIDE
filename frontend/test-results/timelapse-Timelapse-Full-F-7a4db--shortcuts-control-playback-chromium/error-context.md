# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: timelapse.spec.ts >> Timelapse Full-Fidelity Replay >> keyboard shortcuts control playback
- Location: ../testing/e2e/timelapse.spec.ts:1112:7

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
            - generic [ref=e12]: FullFidelity-1783424459320
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
  1038 |     // Must always have authorMap
  1039 |     expect(response.hasAuthorMap).toBe(true);
  1040 |   });
  1041 | 
  1042 |   // ── Test 2: Timelapse opens without crashing in either mode ─────────────────
  1043 |   // Whether in full-fidelity or legacy mode, the replayer should open successfully
  1044 |   // and show the final content at max position.
  1045 |   test('timelapse opens and displays content regardless of replay mode', async ({ page }) => {
  1046 |     await createTestFile(page, 'no_badge.js');
  1047 |     await typeTextInMonaco(page, 'hello');
  1048 |     await page.waitForTimeout(3000);
  1049 | 
  1050 |     await page.getByRole('button', { name: 'Timelapse' }).click();
  1051 |     await expect(page.getByText('CRDT Timelapse')).toBeVisible({ timeout: 10000 });
  1052 | 
  1053 |     // Fix: Removed the invalid Node.js window reference outside evaluate()
  1054 |     await expect.poll(async () => {
  1055 |       return page.evaluate(() => {
  1056 |         const eds = (window as any).monaco?.editor?.getEditors();
  1057 |         return eds && eds[1] ? eds[1].getModel()?.getValue() ?? '' : '';
  1058 |       });
  1059 |     }, { timeout: 5000 }).toBe('hello');
  1060 | 
  1061 |     await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  1062 |   });
  1063 | 
  1064 |   // ── Test 3: Exact deletion replay — type, delete, retype ──────────────────
  1065 |   // With the updates stream, deletions are replayed at the exact moment they
  1066 |   // occurred, not approximated. At the midpoint "OLD" is visible and "NEW" isn't.
  1067 |   test('exact deletion replay shows deleted text at correct timeline position', async ({ page }) => {
  1068 |     await createTestFile(page, 'exact_del.js');
  1069 | 
  1070 |     await typeTextInMonaco(page, 'OLD');
  1071 |     await page.waitForTimeout(1500);
  1072 | 
  1073 |     await page.evaluate(() => {
  1074 |       const ed = (window as any).monaco.editor.getEditors()[0];
  1075 |       ed.executeEdits('del', [{ range: ed.getModel().getFullModelRange(), text: '', forceMoveMarkers: true }]);
  1076 |     });
  1077 |     await page.waitForTimeout(500);
  1078 | 
  1079 |     await typeTextInMonaco(page, 'NEW');
  1080 |     await page.waitForTimeout(3000);
  1081 | 
  1082 |     expect(await page.evaluate(() =>
  1083 |       (window as any).monaco.editor.getEditors()[0]?.getModel()?.getValue() ?? ''
  1084 |     )).toBe('NEW');
  1085 | 
  1086 |     await page.getByRole('button', { name: 'Timelapse' }).click();
  1087 |     await expect(page.getByText('CRDT Timelapse')).toBeVisible({ timeout: 10000 });
  1088 |     
  1089 |     const maxPos = await getSliderMax(page);
  1090 |     expect(maxPos).toBeGreaterThanOrEqual(2);
  1091 | 
  1092 |     // Fix: Dynamically scrub to find 'OLD'
  1093 |     let foundOld = false;
  1094 |     for (let i = 1; i < maxPos; i++) {
  1095 |       await setRangeValue(page, '', String(i));
  1096 |       const text = await getReplayerText(page);
  1097 |       if (text.includes('OLD') && !text.includes('NEW')) {
  1098 |         foundOld = true;
  1099 |         break;
  1100 |       }
  1101 |     }
  1102 |     expect(foundOld).toBe(true);
  1103 | 
  1104 |     await setRangeValue(page, '', String(maxPos));
  1105 |     await expect.poll(() => getReplayerText(page), { timeout: 5000 }).toBe('NEW');
  1106 | 
  1107 |     await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  1108 |   });
  1109 | 
  1110 |   // ── Test 4: Keyboard shortcuts ─────────────────────────────────────────────
  1111 |   // space = play/pause, arrows = step, home/end = jump
  1112 |   test('keyboard shortcuts control playback', async ({ page }) => {
  1113 |     await createTestFile(page, 'keys.js');
  1114 |     await typeTextInMonaco(page, 'ABCDE');
  1115 |     await page.waitForTimeout(3000);
  1116 | 
  1117 |     await page.getByRole('button', { name: 'Timelapse' }).click();
  1118 |     await expect(page.getByText('CRDT Timelapse')).toBeVisible({ timeout: 10000 });
  1119 |     await expect(page.locator('.shadow-2xl.z-50 input[type="range"]')).toBeVisible({ timeout: 10000 });
  1120 | 
  1121 |     // Home key → goes to 0
  1122 |     await page.keyboard.press('Home');
  1123 |     await page.waitForTimeout(200);
  1124 |     await expect.poll(() => getReplayerText(page), { timeout: 3000 }).toBe('');
  1125 | 
  1126 |     // End key → goes to max
  1127 |     await page.keyboard.press('End');
  1128 |     await page.waitForTimeout(200);
  1129 |     await expect.poll(() => getReplayerText(page), { timeout: 3000 }).toBe('ABCDE');
  1130 | 
  1131 |     // Go to start, then arrow right to step forward
  1132 |     await page.keyboard.press('Home');
  1133 |     await page.waitForTimeout(200);
  1134 |     await page.keyboard.press('ArrowRight');
  1135 |     await page.waitForTimeout(200);
  1136 |     const afterOneStep = await getReplayerText(page);
  1137 |     expect(afterOneStep.length).toBeGreaterThan(0);
> 1138 |     expect(afterOneStep.length).toBeLessThan(5);
       |                                 ^ Error: expect(received).toBeLessThan(expected)
  1139 | 
  1140 |     await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  1141 |   });
  1142 | 
  1143 |   // ── Test 5: Play speed toggle ──────────────────────────────────────────────
  1144 |   // Clicking the speed button cycles through 1x → 2x → 4x → 0.5x → 1x
  1145 |   test('speed toggle cycles through playback speeds', async ({ page }) => {
  1146 |     await createTestFile(page, 'speed.js');
  1147 |     await typeTextInMonaco(page, 'speed test');
  1148 |     await page.waitForTimeout(3000);
  1149 | 
  1150 |     await page.getByRole('button', { name: 'Timelapse' }).click();
  1151 |     await expect(page.getByText('CRDT Timelapse')).toBeVisible({ timeout: 10000 });
  1152 | 
  1153 |     // Initial speed is 1x
  1154 |     const speedBtn = page.locator('.shadow-2xl.z-50 button[title="Playback speed"]');
  1155 |     await expect(speedBtn).toContainText('1x');
  1156 | 
  1157 |     // Click to cycle: 1x → 2x
  1158 |     await speedBtn.click();
  1159 |     await expect(speedBtn).toContainText('2x');
  1160 | 
  1161 |     // Click again: 2x → 4x
  1162 |     await speedBtn.click();
  1163 |     await expect(speedBtn).toContainText('4x');
  1164 | 
  1165 |     // Click again: 4x → 0.5x
  1166 |     await speedBtn.click();
  1167 |     await expect(speedBtn).toContainText('0.5x');
  1168 | 
  1169 |     // Click again: 0.5x → 1x
  1170 |     await speedBtn.click();
  1171 |     await expect(speedBtn).toContainText('1x');
  1172 | 
  1173 |     await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  1174 |   });
  1175 | 
  1176 |   // ── Test 6: Edit-density heatmap is rendered ───────────────────────────────
  1177 |   // The scrubber area should contain heatmap bars showing edit density.
  1178 |   test('edit-density heatmap bars are rendered under the scrubber', async ({ page }) => {
  1179 |     await createTestFile(page, 'heatmap.js');
  1180 |     await typeTextInMonaco(page, 'some content here for heatmap');
  1181 |     await page.waitForTimeout(3000);
  1182 | 
  1183 |     await page.getByRole('button', { name: 'Timelapse' }).click();
  1184 |     await expect(page.getByText('CRDT Timelapse')).toBeVisible({ timeout: 10000 });
  1185 | 
  1186 |     // Heatmap bars are rendered as divs with bg-indigo-400/30
  1187 |     const heatmapBars = page.locator('.shadow-2xl.z-50 .bg-indigo-400\\/30');
  1188 |     const count = await heatmapBars.count();
  1189 |     expect(count).toBeGreaterThan(0);
  1190 | 
  1191 |     await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  1192 |   });
  1193 | 
  1194 |   // ── Test 7: Step buttons work correctly ────────────────────────────────────
  1195 |   // The < and > buttons should step one frame at a time.
  1196 |   test('step back and step forward buttons navigate one frame at a time', async ({ page }) => {
  1197 |     await createTestFile(page, 'steps.js');
  1198 |     
  1199 |     // Fix: Stagger typing to guarantee at least 2 playback frames
  1200 |     await typeTextInMonaco(page, 'X');
  1201 |     await page.waitForTimeout(1000);
  1202 |     await typeTextInMonaco(page, 'Y');
  1203 |     await page.waitForTimeout(3000);
  1204 | 
  1205 |     await page.getByRole('button', { name: 'Timelapse' }).click();
  1206 |     await expect(page.getByText('CRDT Timelapse')).toBeVisible({ timeout: 10000 });
  1207 |     await expect(page.locator('.shadow-2xl.z-50 input[type="range"]')).toBeVisible({ timeout: 10000 });
  1208 | 
  1209 |     await page.locator('.shadow-2xl.z-50 button[title="Back to start (Home)"]').click();
  1210 |     await page.waitForTimeout(200);
  1211 |     await expect.poll(() => getReplayerText(page), { timeout: 3000 }).toBe('');
  1212 | 
  1213 |     await page.locator('.shadow-2xl.z-50 button[title="Step forward (→)"]').click();
  1214 |     await page.waitForTimeout(200);
  1215 |     const afterStep1 = await getReplayerText(page);
  1216 |     expect(afterStep1.length).toBeGreaterThan(0);
  1217 | 
  1218 |     await page.locator('.shadow-2xl.z-50 button[title="Step forward (→)"]').click();
  1219 |     await page.waitForTimeout(200);
  1220 |     const afterStep2 = await getReplayerText(page);
  1221 |     expect(afterStep2.length).toBeGreaterThan(afterStep1.length);
  1222 | 
  1223 |     await page.locator('.shadow-2xl.z-50 button[title="Step back (←)"]').click();
  1224 |     await page.waitForTimeout(200);
  1225 |     const afterStepBack = await getReplayerText(page);
  1226 |     expect(afterStepBack).toBe(afterStep1);
  1227 | 
  1228 |     await page.locator('.shadow-2xl.z-50 button:has(svg.lucide-x)').click();
  1229 |   });
  1230 | });
  1231 | 
```