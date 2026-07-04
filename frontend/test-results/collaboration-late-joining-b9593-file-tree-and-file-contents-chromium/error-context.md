# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: collaboration.spec.ts >> late-joining user receives the fully updated file tree and file contents
- Location: ../testing/e2e/collaboration.spec.ts:810:7

# Error details

```
Error: expect(received).toContain(expected) // indexOf

Expected substring: "BETA_DATA_1783158700771"
Received string:    ""

Call Log:
- Timeout 10000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e3]:
    - banner [ref=e4]:
      - generic [ref=e6] [cursor=pointer]:
        - img [ref=e8]
        - generic [ref=e10]:
          - generic [ref=e11]:
            - generic [ref=e12]: LateTree_WS_1783158700771
            - 'generic "Status: connected" [ref=e13]'
          - generic [ref=e14]: admin workspace
      - generic [ref=e15]:
        - button "Join Voice" [ref=e16]:
          - img [ref=e17]
          - generic [ref=e20]: Join Voice
        - button "AL BO" [ref=e23]:
          - generic [ref=e24]:
            - generic "Alice_LateTree_1783158700771" [ref=e25]: AL
            - generic "Bob_LateTree_1783158700771" [ref=e27]: BO
          - img [ref=e29]
        - generic [ref=e31]:
          - button "Share" [ref=e32]:
            - img [ref=e33]
            - text: Share
          - button "Export" [ref=e38]:
            - img [ref=e39]
            - text: Export
          - button "Logout" [ref=e42]:
            - img [ref=e43]
    - generic [ref=e46]:
      - generic [ref=e48]:
        - generic [ref=e49]:
          - generic [ref=e50]: Explorer
          - generic [ref=e51]:
            - button "Refresh Explorer" [ref=e52]:
              - img [ref=e53]
            - button "New File" [ref=e58]:
              - img [ref=e59]
            - button "New Folder" [ref=e62]:
              - img [ref=e63]
        - generic [ref=e65]:
          - generic [ref=e67] [cursor=pointer]:
            - generic [ref=e68]:
              - img [ref=e70]
              - generic [ref=e73]: file-alpha.js
            - button "Delete File" [ref=e75]:
              - img [ref=e76]
          - generic [ref=e80] [cursor=pointer]:
            - generic [ref=e82]:
              - img [ref=e84]
              - generic [ref=e87]: file-beta.js
            - button "Delete File" [ref=e89]:
              - img [ref=e90]
      - main [ref=e93]:
        - generic [ref=e94]:
          - generic [ref=e98]:
            - img [ref=e99]
            - generic [ref=e102]: file-beta.js
          - code [ref=e107]:
            - generic [ref=e108]:
              - textbox "Editor content" [ref=e109]
              - textbox [ref=e110]
              - generic [ref=e115]: "1"
        - generic [ref=e122]:
          - generic [ref=e123]:
            - generic [ref=e124]:
              - img [ref=e125]
              - generic [ref=e128]: Sandbox
            - generic [ref=e129]:
              - button "Preview" [ref=e130]:
                - img [ref=e131]
                - text: Preview
              - button "Restart" [ref=e134]:
                - img [ref=e135]
                - text: Restart
          - generic [ref=e139]:
            - button "Clear Terminal" [ref=e141]:
              - img [ref=e142]
            - generic [ref=e149]:
              - textbox "Terminal input" [ref=e150]
              - generic:
                - generic:
                  - generic: sandbox
                  - generic: ":"
                  - generic: ~
                  - generic: "#"
  - generic [ref=e151]:
    - alert
    - alert [ref=e152]: Cannot edit in read-only editor
```

# Test source

```ts
  771 |     // Bob types offline
  772 |     await focusEditor(bobPage);
  773 |     await bobPage.keyboard.type('// Bob offline edit\n');
  774 | 
  775 |     // Alice types online simultaneously
  776 |     await focusEditor(alicePage);
  777 |     await alicePage.keyboard.type('// Alice online edit\n');
  778 | 
  779 |     // Verify divergence (Alice doesn't see Bob's edit, Bob doesn't see Alice's)
  780 |     let aliceCurrent = await getEditorValue(alicePage);
  781 |     let bobCurrent = await getEditorValue(bobPage);
  782 |     expect(aliceCurrent).not.toContain('Bob offline edit');
  783 |     expect(bobCurrent).not.toContain('Alice online edit');
  784 | 
  785 |     // Simulate internet restoration
  786 |     await bobContext.setOffline(false);
  787 | 
  788 |     // Both edits must merge cleanly without wiping each other out
  789 |     await expect(async () => {
  790 |       const aliceFinal = await getEditorValue(alicePage);
  791 |       const bobFinal = await getEditorValue(bobPage);
  792 |       
  793 |       expect(aliceFinal).toContain('Bob offline edit');
  794 |       expect(aliceFinal).toContain('Alice online edit');
  795 |       expect(aliceFinal).toEqual(bobFinal);
  796 |     }).toPass({ timeout: 15000, intervals: [1000] });
  797 |   });
  798 | 
  799 | 
  800 | 
  801 |   // =============================================================================
  802 |   // TEST 13: Late Joiner Full Workspace State Sync
  803 |   //
  804 |   // THE BUG THIS CATCHES:
  805 |   //   A user joins a workspace that already has multiple files created and 
  806 |   //   modified by the host. The new user's file tree is empty, missing some 
  807 |   //   files, or clicking the files shows stale/empty content because the initial 
  808 |   //   REST fetch or WebSocket state sync failed to hydrate the current state.
  809 |   // =============================================================================
  810 |   test('late-joining user receives the fully updated file tree and file contents', async ({ page, context }) => {
  811 |     const alicePage = page;
  812 |     const bobContext = await context.browser()!.newContext();
  813 |     const bobPage = await bobContext.newPage();
  814 |     const timestamp = Date.now();
  815 |     const CONTENT_1 = `ALPHA_DATA_${timestamp}`;
  816 |     const CONTENT_2 = `BETA_DATA_${timestamp}`;
  817 | 
  818 |     await loginUser(alicePage, `Alice_LateTree_${timestamp}`);
  819 |     await loginUser(bobPage, `Bob_LateTree_${timestamp}`);
  820 | 
  821 |     await alicePage.goto('/dashboard');
  822 |     await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `LateTree_WS_${timestamp}`);
  823 |     await alicePage.click('button:has-text("Create Now")');
  824 |     await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
  825 |     const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
  826 |     await waitForBootComplete(alicePage);
  827 | 
  828 |     // 1. Alice creates File 1 and adds content
  829 |     await createFile(alicePage, 'file-alpha.js');
  830 |     await waitForEditorModel(alicePage, 'file-alpha.js');
  831 |     await focusEditor(alicePage);
  832 |     await alicePage.keyboard.type(`const a = "${CONTENT_1}";`, { delay: 10 });
  833 |     
  834 |     // 2. Alice creates File 2 and adds content
  835 |     await createFile(alicePage, 'file-beta.js');
  836 |     await waitForEditorModel(alicePage, 'file-beta.js');
  837 |     await focusEditor(alicePage);
  838 |     await alicePage.keyboard.type(`const b = "${CONTENT_2}";`, { delay: 10 });
  839 | 
  840 |     // CRITICAL: Wait for the autosave debounce to flush to DB/Server
  841 |     await alicePage.waitForTimeout(3000);
  842 | 
  843 |     // 3. Invite Bob *after* files are established
  844 |     await inviteUser(alicePage, `Bob_LateTree_${timestamp}`, 'editor');
  845 | 
  846 |     // 4. Bob joins the workspace
  847 |     await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
  848 |     await waitForBootComplete(bobPage);
  849 | 
  850 |     // 5. Verify Bob's file tree populated correctly
  851 |     const bobFileAlpha = bobPage.locator('.ide-scrollbar').getByText('file-alpha.js');
  852 |     const bobFileBeta = bobPage.locator('.ide-scrollbar').getByText('file-beta.js');
  853 |     
  854 |     await expect(bobFileAlpha).toBeVisible({ timeout: 15000 });
  855 |     await expect(bobFileBeta).toBeVisible({ timeout: 15000 });
  856 | 
  857 |     // 6. Verify Bob sees the correct content in File 1
  858 |     await bobFileAlpha.click();
  859 |     await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });
  860 |     await expect(async () => {
  861 |       const textAlpha = await getEditorValue(bobPage);
  862 |       expect(textAlpha).toContain(CONTENT_1);
  863 |     }).toPass({ timeout: 10000, intervals: [1000] });
  864 | 
  865 |     // 7. Verify Bob sees the correct content in File 2
  866 |     await bobFileBeta.click();
  867 |     await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });
  868 |     await expect(async () => {
  869 |       const textBeta = await getEditorValue(bobPage);
  870 |       expect(textBeta).toContain(CONTENT_2);
> 871 |     }).toPass({ timeout: 10000, intervals: [1000] });
      |        ^ Error: expect(received).toContain(expected) // indexOf
  872 |   });
  873 | 
  874 |   // =============================================================================
  875 |   // TEST 14: Live File Creation and CRDT Initialization Freeze
  876 |   //
  877 |   // THE BUG THIS CATCHES:
  878 |   //   Two users are actively in the workspace. User A creates a new file.
  879 |   //   User B sees the file in the sidebar, but when they click it, the editor
  880 |   //   fails to mount, gets stuck loading, or the CRDT Websocket fails to bind 
  881 |   //   to the new file, preventing live typing synchronization.
  882 |   // =============================================================================
  883 |   test('newly created files sync live to peers and initialize collaborative editor without freezing', async ({ page, context }) => {
  884 |     const alicePage = page;
  885 |     const bobContext = await context.browser()!.newContext();
  886 |     const bobPage = await bobContext.newPage();
  887 |     const timestamp = Date.now();
  888 | 
  889 |     await loginUser(alicePage, `Alice_LiveFile_${timestamp}`);
  890 |     await loginUser(bobPage, `Bob_LiveFile_${timestamp}`);
  891 | 
  892 |     await alicePage.goto('/dashboard');
  893 |     await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `LiveFile_WS_${timestamp}`);
  894 |     await alicePage.click('button:has-text("Create Now")');
  895 |     await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
  896 |     const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
  897 |     await waitForBootComplete(alicePage);
  898 | 
  899 |     // Setup: Both Alice and Bob are in the workspace
  900 |     await inviteUser(alicePage, `Bob_LiveFile_${timestamp}`, 'editor');
  901 |     
  902 |     await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
  903 |     await waitForBootComplete(bobPage);
  904 | 
  905 |     // 1. Alice creates a file WHILE Bob is already connected
  906 |     const LIVE_FILENAME = `dynamic-${timestamp}.js`;
  907 |     await createFile(alicePage, LIVE_FILENAME);
  908 |     
  909 |     // Ensure Alice's editor initializes
  910 |     await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });
  911 | 
  912 |     // 2. File should appear instantly in Bob's file tree via socket
  913 |     const bobFileNode = bobPage.locator('.ide-scrollbar').getByText(LIVE_FILENAME);
  914 |     await expect(bobFileNode).toBeVisible({ timeout: 15000 });
  915 | 
  916 |     // 3. Bob clicks the newly created file (this is where the "freeze" usually happens)
  917 |     await bobFileNode.click();
  918 |     
  919 |     // If the app gets stuck here, this selector will timeout and fail the test
  920 |     await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });
  921 | 
  922 |     // 4. Verify bidirectional typing works immediately on the newly created file
  923 |     await focusEditor(alicePage);
  924 |     await alicePage.keyboard.type('// Alice testing live file\n', { delay: 10 });
  925 | 
  926 |     await expect(async () => {
  927 |       const bobText = await getEditorValue(bobPage);
  928 |       expect(bobText).toContain('Alice testing live file');
  929 |     }).toPass({ timeout: 10000, intervals: [500] });
  930 | 
  931 |     await focusEditor(bobPage);
  932 |     await bobPage.keyboard.type('// Bob responding on live file\n', { delay: 10 });
  933 | 
  934 |     await expect(async () => {
  935 |       const aliceText = await getEditorValue(alicePage);
  936 |       expect(aliceText).toContain('Bob responding on live file');
  937 |     }).toPass({ timeout: 10000, intervals: [500] });
  938 |   });
  939 | 
  940 |   // =============================================================================
  941 |   // TEST 15: High Latency Initialization (Exposing the 2-Second REST Hack)
  942 |   //
  943 |   // THE BUG THIS CATCHES:
  944 |   //   CodeEditor.tsx implements a 2000ms fallback timer to fetch REST data.
  945 |   //   If the WebSocket is artificially delayed beyond 2 seconds, the client 
  946 |   //   inserts the REST text, and then the WS syncs the identical text on top,
  947 |   //   resulting in duplicated code.
  948 |   // =============================================================================
  949 |   test('does not duplicate content on slow network connections (exposing fallback race condition)', async ({ page, context }) => {
  950 |     const alicePage = page;
  951 |     const bobContext = await context.browser()!.newContext();
  952 |     const bobPage = await bobContext.newPage();
  953 |     const timestamp = Date.now();
  954 |     const CONTENT = `LATENCY_TEST_${timestamp}`;
  955 | 
  956 |     await loginUser(alicePage, `Alice_Slow_${timestamp}`);
  957 |     await loginUser(bobPage, `Bob_Slow_${timestamp}`);
  958 | 
  959 |     await alicePage.goto('/dashboard');
  960 |     await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Slow_WS_${timestamp}`);
  961 |     await alicePage.click('button:has-text("Create Now")');
  962 |     await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
  963 |     const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
  964 |     await alicePage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
  965 | 
  966 |     await inviteUser(alicePage, `Bob_Slow_${timestamp}`, 'editor');
  967 |     
  968 |     // Alice writes the baseline content
  969 |     await createFile(alicePage, 'latency.js');
  970 |     await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });
  971 |     await focusEditor(alicePage);
```