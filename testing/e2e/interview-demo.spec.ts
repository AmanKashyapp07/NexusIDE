import { test, expect } from '@playwright/test';
import {
  APP_URL, API_URL,
  loginUser, inviteUser, waitForBootComplete, focusEditor,
  createTestWorkspace, deleteTestWorkspace, createFile, typeTextInMonaco,
  getEditorValue, waitForEditorModel, setMonacoValue, waitForTerminalText
} from '../test-utils';

test.describe('Live Practical Interview Demo - End-to-End Verification', () => {
  test.describe.configure({ mode: 'serial' });

  test('executes complete 5-phase practical interview demonstration from demo.md', async ({ page, context, request }) => {
    // Increase test timeout for full 5-stage demonstration
    test.setTimeout(180000);

    const demoPage = page;
    const collabContext = await context.browser()!.newContext();
    const collabPage = await collabContext.newPage();
    let workspaceId = '';

    try {
      // =========================================================================
      // PHASE 1: Authentication & Workspace Creation (0:00 - 0:45)
      // =========================================================================
      console.log('[Demo E2E] Phase 1: Authenticating demo and collab accounts...');
      await loginUser(demoPage, request, 'demo');
      await loginUser(collabPage, request, 'collab');

      console.log('[Demo E2E] Phase 1: Demo creating workspace "Distributed-Systems-Demo"...');
      workspaceId = await createTestWorkspace(demoPage, 'Distributed-Systems-Demo');
      expect(workspaceId).toBeTruthy();
      await waitForBootComplete(demoPage);
      console.log(`[Demo E2E] Workspace booted with ID: ${workspaceId}`);

      // =========================================================================
      // PHASE 2: Multi-Cursor Concurrency Showcase (0:45 - 2:30)
      // =========================================================================
      console.log('[Demo E2E] Phase 2: Inviting collab as editor...');
      await inviteUser(demoPage, 'collab', 'editor');

      console.log('[Demo E2E] Phase 2: Creating file engine.py...');
      await createFile(demoPage, 'engine.py');
      await waitForEditorModel(demoPage, 'engine.py');

      console.log('[Demo E2E] Phase 2: Collab joining workspace via URL...');
      await collabPage.goto(`${APP_URL}/${workspaceId}`);
      await waitForBootComplete(collabPage);

      console.log('[Demo E2E] Phase 2: Verifying engine.py is visible in collab file tree...');
      const collabFileItem = collabPage.locator('.ide-scrollbar').getByText('engine.py');
      await expect(collabFileItem).toBeVisible({ timeout: 15000 });
      await collabFileItem.click();
      await waitForEditorModel(collabPage, 'engine.py');

      console.log('[Demo E2E] Phase 2: Demo typing cluster engine boilerplate...');
      await focusEditor(demoPage);
      const codeDemo = 'import os, sys, time\n\ndef compute_cluster_state():\n';
      await typeTextInMonaco(demoPage, codeDemo);

      console.log('[Demo E2E] Phase 2: Verifying collab editor converges via Yjs CRDT...');
      await expect(async () => {
        const val = await getEditorValue(collabPage);
        expect(val).toContain('compute_cluster_state');
      }).toPass({ timeout: 15000, intervals: [500] });

      console.log('[Demo E2E] Phase 2: Collab typing inside function...');
      await focusEditor(collabPage);
      const codeCollab = '    return {"nodes": 3, "status": "HEALTHY"}\n';
      await typeTextInMonaco(collabPage, codeCollab);

      console.log('[Demo E2E] Phase 2: Verifying demo editor reflects collab keystrokes...');
      await expect(async () => {
        const val = await getEditorValue(demoPage);
        expect(val).toContain('HEALTHY');
      }).toPass({ timeout: 15000, intervals: [500] });

      // =========================================================================
      // PHASE 3: Network Partition & Chaos Merge (2:30 - 4:00)
      // =========================================================================
      console.log('[Demo E2E] Phase 3: Emulating WAN network disconnect on collab...');
      const cdpClient = await collabContext.newCDPSession(collabPage);
      await cdpClient.send('Network.emulateNetworkConditions', {
        offline: true,
        latency: 0,
        downloadThroughput: 0,
        uploadThroughput: 0,
      });

      console.log('[Demo E2E] Phase 3: Partition edits — Demo writes verify_quorum() online...');
      await focusEditor(demoPage);
      await typeTextInMonaco(demoPage, '\ndef verify_quorum():\n    return True\n');

      console.log('[Demo E2E] Phase 3: Partition edits — Collab writes offline comment while disconnected...');
      await focusEditor(collabPage);
      await typeTextInMonaco(collabPage, '# Partition edit from isolated client\n');

      // Verify network isolation: collab does not receive verify_quorum while disconnected
      const isolatedVal = await getEditorValue(collabPage);
      expect(isolatedVal).not.toContain('verify_quorum');

      console.log('[Demo E2E] Phase 3: Restoring network connection to collab...');
      await cdpClient.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 20,
        downloadThroughput: 10 * 1024 * 1024 / 8,
        uploadThroughput: 5 * 1024 * 1024 / 8,
      });

      console.log('[Demo E2E] Phase 3: Verifying conflict-free CRDT convergence across both clients...');
      await expect(async () => {
        const demoVal = await getEditorValue(demoPage);
        const collabVal = await getEditorValue(collabPage);
        expect(demoVal).toContain('Partition edit');
        expect(demoVal).toContain('verify_quorum');
        expect(collabVal).toContain('Partition edit');
        expect(collabVal).toContain('verify_quorum');
      }).toPass({ timeout: 20000, intervals: [1000] });

      // =========================================================================
      // PHASE 4: Linux Container Sandbox & Interactive Terminal (4:00 - 5:45)
      // =========================================================================
      console.log('[Demo E2E] Phase 4: Connecting to Linux Container PTY...');
      const terminalTextarea = demoPage.locator('.xterm-helper-textarea');
      await waitForTerminalText(demoPage, /sandbox:~#|#|\$/, 35000);

      console.log('[Demo E2E] Phase 4: Executing "whoami && python3 --version" in container...');
      await terminalTextarea.focus();
      await demoPage.keyboard.type('whoami && python3 --version\n', { delay: 20 });
      await waitForTerminalText(demoPage, /sandbox|root|node/, 15000);
      await waitForTerminalText(demoPage, /Python 3/, 15000);

      console.log('[Demo E2E] Phase 4: Executing inline python verification script...');
      await terminalTextarea.focus();
      await demoPage.keyboard.type('python3 -c "print(\'CLUSTER_HEALTH_VERIFIED\')"\n', { delay: 20 });
      await waitForTerminalText(demoPage, 'CLUSTER_HEALTH_VERIFIED', 15000);

      // =========================================================================
      // PHASE 5: Merkle DAG Snapshots & Atomic Rollback (5:45 - 7:15)
      // =========================================================================
      console.log('[Demo E2E] Phase 5: Waiting 3s for adaptive debouncer to commit file state...');
      await demoPage.waitForTimeout(3000);

      console.log('[Demo E2E] Phase 5: Opening Snapshot History modal...');
      await demoPage.click('button:has-text("History")');
      await expect(demoPage.locator('text=Snapshot History')).toBeVisible({ timeout: 10000 });

      console.log('[Demo E2E] Phase 5: Creating snapshot "Stable-v1"...');
      await demoPage.click('button:has-text("New Snapshot")');
      const labelInput = demoPage.locator('input[placeholder="Snapshot label (optional)"]');
      await labelInput.waitFor({ state: 'visible', timeout: 5000 });
      await labelInput.fill('Stable-v1');
      await demoPage.click('button:has-text("Save")');

      console.log('[Demo E2E] Phase 5: Verifying snapshot card "Stable-v1" appears...');
      const snapshotCard = demoPage.locator('button:has-text("Stable-v1")');
      await expect(snapshotCard).toBeVisible({ timeout: 15000 });

      console.log('[Demo E2E] Phase 5: Closing Snapshot History modal...');
      const closeBtn = demoPage.locator('.fixed.inset-0 button').filter({ has: demoPage.locator('svg.lucide-x') }).last();
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
      } else {
        await demoPage.locator('.fixed.inset-0').click({ position: { x: 5, y: 5 } });
      }
      await expect(demoPage.locator('text=Snapshot History')).toBeHidden({ timeout: 5000 });

      console.log('[Demo E2E] Phase 5: Vandalizing editor state in demo window...');
      await focusEditor(demoPage);
      await setMonacoValue(demoPage, '# Corrupted state by accidental deletion\n');

      console.log('[Demo E2E] Phase 5: Verifying corruption propagated to collab window...');
      await expect(async () => {
        const collabVal = await getEditorValue(collabPage);
        expect(collabVal).toContain('Corrupted state');
      }).toPass({ timeout: 10000, intervals: [500] });

      console.log('[Demo E2E] Phase 5: Opening History modal and restoring snapshot "Stable-v1"...');
      await demoPage.click('button:has-text("History")');
      await expect(demoPage.locator('text=Snapshot History')).toBeVisible({ timeout: 10000 });
      await demoPage.click('button:has-text("Stable-v1")');

      await demoPage.click('button:has-text("Restore to this snapshot")');
      await demoPage.click('button:has-text("Confirm Restore")');

      console.log('[Demo E2E] Phase 5: Waiting for workspace restore reload...');
      await demoPage.waitForTimeout(3000);
      await waitForBootComplete(demoPage);

      console.log('[Demo E2E] Phase 5: Re-opening engine.py in restored workspace...');
      const restoredFileItem = demoPage.locator('.ide-scrollbar').getByText('engine.py');
      await expect(restoredFileItem).toBeVisible({ timeout: 15000 });
      await restoredFileItem.click();
      await waitForEditorModel(demoPage, 'engine.py');

      console.log('[Demo E2E] Phase 5: Verifying restored file content matches snapshot and lacks corruption...');
      await expect(async () => {
        const restoredVal = await getEditorValue(demoPage);
        expect(restoredVal).toContain('compute_cluster_state');
        expect(restoredVal).not.toContain('Corrupted state');
      }).toPass({ timeout: 15000, intervals: [500] });

      console.log('[Demo E2E] Phase 5: Complete 5-phase practical interview demonstration PASSED!');
    } finally {
      console.log('[Demo E2E] Cleaning up collab context and workspace...');
      await collabContext.close().catch(() => {});
      if (workspaceId) {
        await deleteTestWorkspace(demoPage, workspaceId, request).catch(() => {});
      }
    }
  });
});
