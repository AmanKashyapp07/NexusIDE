# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: collaboration.spec.ts >> Collaborative Engine E2E Integration Suite >> rapid file switches do not leak content between files or duplicate on rejoin
- Location: ../testing/e2e/collaboration.spec.ts:557:7

# Error details

```
Error: expect(received).toContain(expected) // indexOf

Expected substring: "FILE_B_1783158645050"
Received string:    ""

Call Log:
- Timeout 15000ms exceeded while waiting on the predicate
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
            - generic [ref=e12]: Switch_WS_1783158645050
            - 'generic "Status: connected" [ref=e13]'
          - generic [ref=e14]: admin workspace
      - generic [ref=e15]:
        - button "Join Voice" [ref=e16]:
          - img [ref=e17]
          - generic [ref=e20]: Join Voice
        - button "AL BO" [ref=e23]:
          - generic [ref=e24]:
            - generic "Alice_Switch_1783158645050" [ref=e25]: AL
            - generic "Bob_Switch_1783158645050" [ref=e27]: BO
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
              - generic [ref=e73]: file-a.js
            - button "Delete File" [ref=e75]:
              - img [ref=e76]
          - generic [ref=e80] [cursor=pointer]:
            - generic [ref=e82]:
              - img [ref=e84]
              - generic [ref=e87]: file-b.js
            - button "Delete File" [ref=e89]:
              - img [ref=e90]
      - main [ref=e93]:
        - generic [ref=e94]:
          - generic [ref=e98]:
            - img [ref=e99]
            - generic [ref=e102]: file-b.js
          - code [ref=e107]:
            - generic [ref=e108]:
              - textbox "Editor content" [active] [ref=e109]
              - textbox [ref=e110]
              - generic [ref=e115]: "1"
            - paragraph [ref=e126]: Cannot edit in read-only editor
        - generic [ref=e128]:
          - generic [ref=e129]:
            - generic [ref=e130]:
              - img [ref=e131]
              - generic [ref=e134]: Sandbox
            - generic [ref=e135]:
              - button "Preview" [ref=e136]:
                - img [ref=e137]
                - text: Preview
              - button "Restart" [ref=e140]:
                - img [ref=e141]
                - text: Restart
          - generic [ref=e145]:
            - button "Clear Terminal" [ref=e147]:
              - img [ref=e148]
            - generic [ref=e155]:
              - textbox "Terminal input" [ref=e156]
              - generic:
                - generic:
                  - generic: sandbox
                  - generic: ":"
                  - generic: ~
                  - generic: "#"
  - generic [ref=e157]:
    - alert
    - alert [ref=e158]: Cannot edit in read-only editor
```

# Test source

```ts
  521 | 
  522 |     await expect(async () => {
  523 |       const firstJoinText = await getEditorValue(bobPage);
  524 |       expect(firstJoinText).toContain(SENTINEL);
  525 |       expect(firstJoinText.split(SENTINEL).length - 1).toBe(1);
  526 |     }).toPass({ timeout: 15000, intervals: [1000] });
  527 | 
  528 |     // Bob navigates away (destroys Yjs provider)
  529 |     await bobPage.goto('/dashboard');
  530 |     await bobPage.waitForURL(/\/dashboard/);
  531 |     await bobPage.waitForTimeout(1000);
  532 | 
  533 |     // Bob rejoins
  534 |     await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
  535 |     await waitForBootComplete(bobPage);
  536 |     await bobPage.locator('.ide-scrollbar').getByText('reconnect.js').click();
  537 |     await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });
  538 |     // Give Yjs time to reconnect and sync from the server before asserting
  539 |     await bobPage.waitForTimeout(2000);
  540 | 
  541 |     // Auto-retry assertion after reconnect to handle load sync latency
  542 |     await expect(async () => {
  543 |       const reconnectText = await getEditorValue(bobPage);
  544 |       expect(reconnectText).toContain(SENTINEL);
  545 |       expect(reconnectText.split(SENTINEL).length - 1).toBe(1);
  546 |     }).toPass({ timeout: 15000, intervals: [1000] });
  547 |   });
  548 | 
  549 |   // =============================================================================
  550 |   // TEST 9: Rapid File Switching — Provider Cleanup & No Content Leakage
  551 |   //
  552 |   // Switching files rapidly must cleanly destroy the old Yjs provider before
  553 |   // mounting the new one. Failure modes:
  554 |   //   - Old file content bleeds into new file (provider not torn down)
  555 |   //   - New file content doubled (two providers attach to same Monaco model)
  556 |   // =============================================================================
  557 |   test('rapid file switches do not leak content between files or duplicate on rejoin', async ({ page, context }) => {
  558 |     const alicePage = page;
  559 |     const bobContext = await context.browser()!.newContext();
  560 |     const bobPage = await bobContext.newPage();
  561 |     const timestamp = Date.now();
  562 |     const FILE_A_CONTENT = `FILE_A_${timestamp}`;
  563 |     const FILE_B_CONTENT = `FILE_B_${timestamp}`;
  564 | 
  565 |     await loginUser(alicePage, `Alice_Switch_${timestamp}`);
  566 |     await loginUser(bobPage, `Bob_Switch_${timestamp}`);
  567 |     
  568 |     alicePage.on('console', msg => console.log(`[Alice] ${msg.text()}`));
  569 |     bobPage.on('console', msg => console.log(`[Bob] ${msg.text()}`));
  570 | 
  571 |     await alicePage.goto('/dashboard');
  572 |     await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Switch_WS_${timestamp}`);
  573 |     await alicePage.click('button:has-text("Create Now")');
  574 |     await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
  575 |     const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
  576 |     await waitForBootComplete(alicePage);
  577 |     await inviteUser(alicePage, `Bob_Switch_${timestamp}`, 'editor');
  578 | 
  579 |     // Alice creates file-a.js with unique content
  580 |     await createFile(alicePage, 'file-a.js');
  581 |     await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });
  582 |     await alicePage.locator('.monaco-editor').first().click();
  583 |     await alicePage.waitForTimeout(300);
  584 |     await alicePage.keyboard.type(`console.log("${FILE_A_CONTENT}");`, { delay: 20 });
  585 |     await alicePage.waitForTimeout(3000);
  586 | 
  587 |     // Alice creates file-b.js with different unique content
  588 |     await createFile(alicePage, 'file-b.js');
  589 |     await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });
  590 |     await alicePage.locator('.monaco-editor').first().click();
  591 |     await alicePage.waitForTimeout(300);
  592 |     await alicePage.keyboard.type(`console.log("${FILE_B_CONTENT}");`, { delay: 20 });
  593 |     await alicePage.waitForTimeout(3000);
  594 | 
  595 |     // Bob joins
  596 |     await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
  597 |     await waitForBootComplete(bobPage);
  598 | 
  599 |     // Bob rapidly switches: file-a -> file-b -> file-a -> file-b
  600 |     for (let i = 0; i < 2; i++) {
  601 |       await bobPage.locator('.ide-scrollbar').getByText('file-a.js').click();
  602 |       await bobPage.waitForTimeout(300);
  603 |       await bobPage.locator('.ide-scrollbar').getByText('file-b.js').click();
  604 |       await bobPage.waitForTimeout(300);
  605 |     }
  606 |     // Wait for the Monaco model URI + Yjs provider to fully settle after rapid switching
  607 |     await bobPage.waitForTimeout(4000);
  608 | 
  609 |     // Verify file-b.js: correct, no duplication, no leakage from file-a
  610 |     await bobPage.locator('.ide-scrollbar').getByText('file-b.js').click();
  611 |     await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });
  612 |     // Wait for Monaco to finish switching to file-b's model after the rapid switches
  613 |     await waitForEditorModel(bobPage, 'file-b.js');
  614 |     await bobPage.waitForTimeout(2000);
  615 | 
  616 |     await expect(async () => {
  617 |       const bobFileBText = await getEditorValue(bobPage);
  618 |       expect(bobFileBText).toContain(FILE_B_CONTENT);
  619 |       expect(bobFileBText).not.toContain(FILE_A_CONTENT);
  620 |       expect(bobFileBText.split(FILE_B_CONTENT).length - 1).toBe(1);
> 621 |     }).toPass({ timeout: 15000, intervals: [1000] });
      |        ^ Error: expect(received).toContain(expected) // indexOf
  622 | 
  623 |     // Verify file-a.js: correct, no duplication, no leakage from file-b
  624 |     await bobPage.locator('.ide-scrollbar').getByText('file-a.js').click();
  625 |     await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });
  626 |     // Wait for Monaco to finish switching to file-a's model
  627 |     await waitForEditorModel(bobPage, 'file-a.js');
  628 |     // Give Yjs time to sync after a fresh file switch
  629 |     await bobPage.waitForTimeout(1500);
  630 | 
  631 |     await expect(async () => {
  632 |       const { modelText, ydocText, synced } = await bobPage.evaluate(() => {
  633 |         const editors = (window as any).monaco?.editor?.getEditors();
  634 |         const modelText = editors && editors[0] ? editors[0].getModel()?.getValue() || '' : '';
  635 |         const ydoc = (window as any).debugYdoc;
  636 |         const ydocText = ydoc ? ydoc.getText('monaco').toString() : 'NO_YDOC';
  637 |         return { modelText, ydocText, synced: !!ydoc };
  638 |       });
  639 |       
  640 |       console.log(`[Test 9 Debug] modelText: "${modelText}", ydocText: "${ydocText}"`);
  641 |       
  642 |       expect(modelText).toContain(FILE_A_CONTENT);
  643 |       expect(modelText).not.toContain(FILE_B_CONTENT);
  644 |       expect(modelText.split(FILE_A_CONTENT).length - 1).toBe(1);
  645 |     }).toPass({ timeout: 8000, intervals: [1000] });
  646 |   });
  647 | 
  648 | });
  649 | // =============================================================================
  650 |   // TEST 10: CRDT Undo/Redo Stack Isolation
  651 |   //
  652 |   // THE BUG THIS CATCHES:
  653 |   //   In standard text editors, Ctrl+Z undoes the last local change. In a
  654 |   //   collaborative editor without a configured Yjs UndoManager, Ctrl+Z will
  655 |   //   undo the last change in the document globally (wiping out a peer's work),
  656 |   //   or cause document corruption/desync between the local model and Yjs.
  657 |   // =============================================================================
  658 |   test('maintains isolated undo/redo stacks per user without affecting peer edits', async ({ page, context }) => {
  659 |     const alicePage = page;
  660 |     const bobContext = await context.browser()!.newContext();
  661 |     const bobPage = await bobContext.newPage();
  662 |     const timestamp = Date.now();
  663 | 
  664 |     await loginUser(alicePage, `Alice_Undo_${timestamp}`);
  665 |     await loginUser(bobPage, `Bob_Undo_${timestamp}`);
  666 | 
  667 |     await alicePage.goto('/dashboard');
  668 |     await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Undo_WS_${timestamp}`);
  669 |     await alicePage.click('button:has-text("Create Now")');
  670 |     await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
  671 |     const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
  672 |     await waitForBootComplete(alicePage);
  673 | 
  674 |     await inviteUser(alicePage, `Bob_Undo_${timestamp}`, 'editor');
  675 |     await createFile(alicePage, 'undo-test.js');
  676 |     await alicePage.waitForSelector('.monaco-editor', { timeout: 15000 });
  677 | 
  678 |     await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
  679 |     await waitForBootComplete(bobPage);
  680 |     await bobPage.locator('.ide-scrollbar').getByText('undo-test.js').click();
  681 |     await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });
  682 | 
  683 |     // 1. Alice types first edit
  684 |     await waitForEditorReady(alicePage);
  685 |     await focusEditor(alicePage);
  686 |     await alicePage.keyboard.type('// Alice Edit 1\n', { delay: 10 });
  687 |     await alicePage.waitForTimeout(500);
  688 | 
  689 |     // 2. Bob types his edit
  690 |     await waitForEditorReady(bobPage);
  691 |     await focusEditor(bobPage);
  692 |     await bobPage.keyboard.type('// Bob Edit 1\n', { delay: 10 });
  693 |     await bobPage.waitForTimeout(500);
  694 | 
  695 |     // 3. Alice types second edit (single character to bypass Monaco word-grouping in undo)
  696 |     await focusEditor(alicePage);
  697 |     await alicePage.keyboard.type('X');
  698 |     
  699 |     // Ensure both editors see all edits including X
  700 |     await expect(async () => {
  701 |       const bobText = await getEditorValue(bobPage);
  702 |       expect(bobText).toContain('Alice Edit 1');
  703 |       expect(bobText).toContain('Bob Edit 1');
  704 |       expect(bobText).toContain('X');
  705 |     }).toPass({ timeout: 5000, intervals: [500] });
  706 | 
  707 |     // 4. Alice triggers Undo via programmatic Monaco command
  708 |     await alicePage.evaluate(() => {
  709 |       const ed = (window as any).monaco.editor.getEditors()[0];
  710 |       if (ed) {
  711 |         ed.focus();
  712 |         ed.trigger('keyboard', 'undo', null);
  713 |       }
  714 |     });
  715 | 
  716 |     // 5. Verification: Alice's Edit 2 (X) should be gone. Bob's Edit 1 MUST remain.
  717 |     await expect(async () => {
  718 |       const aliceText = await getEditorValue(alicePage);
  719 |       const bobText = await getEditorValue(bobPage);
  720 |       
  721 |       expect(aliceText).toContain('Alice Edit 1');
```