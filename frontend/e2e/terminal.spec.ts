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