import { test, expect, type Page, type APIRequestContext, type Browser } from '@playwright/test';
import {
  APP_URL, API_URL, WS_URL,
  login, loginUser, inviteUser, waitForBootComplete, focusEditor,
  createTestWorkspace, deleteTestWorkspace, createTestFile, createFile, typeTextInMonaco,
  getEditorValue, waitForEditorModel, waitForEditorSync, setMonacoValue, setEditorValue, waitForSocketConnect
} from './test-utils';

test.describe('Terminal - Core Operations', () => {

  test('executes shell commands, detects directory watch sync, and proxies dev server traffic with Ctrl+C teardown', async ({ page, context }) => {
    const timestamp = Date.now();
    const username = `Tester_${timestamp}`;
    const workspaceTitle = `Term_Brutal_WS_${timestamp}`;

    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(username);
    
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });

    await page.fill('input[placeholder="e.g. React-Sandbox"]', workspaceTitle);
    await page.click('button:has-text("Create Now")');

    await expect(page).toHaveURL(/\/ide\/[a-f0-9-]+/);
    const ideUrl = page.url();
    const workspaceId = ideUrl.split('/ide/')[1].split('/')[0];
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    await page.waitForSelector('text=Select a file from the explorer to begin.');

    const terminalTextarea = page.locator('.xterm-helper-textarea');
    const terminalBody = page.locator('.xterm');

    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });

    await page.waitForTimeout(3000);

    await terminalTextarea.focus();
    await page.keyboard.type('echo "PTY_TEST_OK"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('PTY_TEST_OK', { timeout: 5000 });

    await page.keyboard.type('pwd', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText(`/workspaces/${workspaceId}`, { timeout: 5000 });

    await page.keyboard.type('echo \'console.log("FROM_SHELL_OK");\' > shell-script.js', { delay: 10 });
    await page.keyboard.press('Enter');

    const fileSelector = page.locator('.ide-scrollbar').getByText('shell-script.js');
    await expect(fileSelector).toBeVisible({ timeout: 15000 });

    await fileSelector.click();
    await page.waitForSelector('.monaco-editor', { timeout: 25000 });
    await expect(page.locator('.monaco-editor')).toContainText('FROM_SHELL_OK', { timeout: 10000 });

    await terminalTextarea.focus();
    await page.keyboard.type('echo "const http = require(\'http\'); const server = http.createServer((req, res) => { res.writeHead(200, { \'Content-Type\': \'text/plain\' }); res.end(\'HELLO_SANDBOX_DEV_SERVER\'); }); server.listen(3000, \'0.0.0.0\');" > dev-server.js', { delay: 10 });
    await page.keyboard.press('Enter');

    const devServerSelector = page.locator('.ide-scrollbar').getByText('dev-server.js');
    await expect(devServerSelector).toBeVisible({ timeout: 15000 });

    await devServerSelector.click();
    await page.waitForSelector('.monaco-editor', { timeout: 25000 });
    await expect(page.locator('.monaco-editor')).toContainText('HELLO_SANDBOX_DEV_SERVER', { timeout: 10000 });

    await terminalTextarea.focus();
    await page.keyboard.press('Control+C');
    await page.keyboard.type('\x03');
    await page.waitForTimeout(200);
    await page.keyboard.type('node dev-server.js', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('node dev-server.js', { timeout: 5000 });

    await page.waitForTimeout(2000);

    const previewPromise = context.waitForEvent('page');
    await page.click('button:has-text("Preview")');
    const previewPage = await previewPromise;

    await previewPage.waitForLoadState('domcontentloaded');
    await expect(previewPage.locator('body')).toContainText('HELLO_SANDBOX_DEV_SERVER', { timeout: 15000 });

    await page.bringToFront();
    await terminalTextarea.focus();
    await page.keyboard.press('Control+C');
    await page.keyboard.type('\x03');
    await page.waitForTimeout(1000);

    await previewPage.bringToFront();
    await previewPage.reload();
    await previewPage.waitForLoadState('domcontentloaded');

    await expect(previewPage.locator('body')).toContainText('Preview Server Offline', { timeout: 15000 });

    await previewPage.close();
  });

  test('admin successfully clones a remote git repository and verifies recursive file watcher sync', async ({ page }) => {
    const timestamp = Date.now();
    const adminUsername = `Admin_${timestamp}`; 
    const workspaceTitle = `Git_Clone_WS_${timestamp}`;
    const repoUrl = 'https://github.com/AmanKashyapp07/github-test-ci.git';
    const repoName = 'github-test-ci';

    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(adminUsername);
    
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
    
    await page.fill('input[placeholder="e.g. React-Sandbox"]', workspaceTitle);
    await page.click('button:has-text("Create Now")');

    await expect(page).toHaveURL(/\/ide\/[a-f0-9-]+/);
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalTextarea = page.locator('.xterm-helper-textarea');
    const terminalBody = page.locator('.xterm');

    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });

    await page.waitForTimeout(3000);

    await terminalTextarea.focus();
    await page.keyboard.type('clear', { delay: 10 });
    await page.keyboard.press('Enter');
    
    await page.keyboard.type(`git clone ${repoUrl}`, { delay: 10 });
    await page.keyboard.press('Enter');

    await expect(terminalBody).toContainText(`Cloning into '${repoName}'`, { timeout: 30000 });
    await expect(terminalBody).toContainText('Resolving deltas:', { timeout: 45000 });

    const repoFolder = page.locator('.ide-scrollbar').getByText(repoName);
    await expect(repoFolder).toBeVisible({ timeout: 20000 });

    await page.keyboard.type(`cd ${repoName} && ls -d .git`, { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('.git', { timeout: 5000 });

    await repoFolder.click();
    await page.waitForTimeout(1000);

    const amanFile = page.locator('.ide-scrollbar').getByText('aman.js', { exact: true }).first();
    await expect(amanFile).toBeVisible({ timeout: 15000 });
    await amanFile.click();
    await page.waitForSelector('.monaco-editor', { timeout: 15000 });
    await expect(page.locator('.monaco-editor')).not.toBeEmpty();

    await terminalTextarea.focus();
    await page.keyboard.type('git config --global user.email "admin@example.com" && git config --global user.name "Admin User" && git config --global core.pager cat', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    await page.keyboard.type('git checkout -b feature/collaborative-edit', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText("Switched to a new branch 'feature/collaborative-edit'", { timeout: 10000 });

    await page.keyboard.type('echo "console.log(\'edited from collaborative IDE\');" >> aman.js', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    await page.keyboard.type('git status', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('modified:   aman.js', { timeout: 10000 });

    await page.keyboard.type('git add aman.js && git commit -m "test: commit change from collaborative IDE"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('1 file changed', { timeout: 15000 });

    await page.keyboard.type('git log -n 1', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('test: commit change from collaborative IDE', { timeout: 10000 });

    await page.keyboard.type('git checkout main', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText("Switched to branch 'main'", { timeout: 10000 });
  });

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
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Stress_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalTextarea = page.locator('.xterm-helper-textarea');
    const terminalBody = page.locator('.xterm');

    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    
    await page.waitForTimeout(3000);
    
    await terminalTextarea.focus();

    const floodCommand = `for i in $(seq 1 2000); do echo "STRESS_TEST_LINE_$i"; done`;
    await page.keyboard.type(floodCommand, { delay: 5 });
    await page.keyboard.press('Enter');

    await expect(terminalBody).toContainText('STRESS_TEST_LINE_2000', { timeout: 20000 });

    await page.keyboard.type('echo "SURVIVED"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('SURVIVED', { timeout: 5000 });
  });

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
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Interact_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalTextarea = page.locator('.xterm-helper-textarea');
    const terminalBody = page.locator('.xterm');

    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });

    await page.waitForTimeout(3000);

    await terminalTextarea.focus();

    await page.keyboard.type('echo \'read -p "Enter Magic Word: " word; echo "You said: $word"\' > prompt.sh', { delay: 10 });
    await page.keyboard.press('Enter');
    
    await page.keyboard.type('bash prompt.sh', { delay: 10 });
    await page.keyboard.press('Enter');

    await expect(terminalBody).toContainText('Enter Magic Word:', { timeout: 5000 });

    await page.keyboard.type('PlaywrightRules', { delay: 50 });
    await page.keyboard.press('Enter');

    await expect(terminalBody).toContainText('You said: PlaywrightRules', { timeout: 5000 });

    await page.keyboard.type('sleep 100 &', { delay: 10 });
    await page.keyboard.press('Enter');

    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 5000 });
    
    await page.keyboard.type('echo "PTY_UNBLOCKED"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('PTY_UNBLOCKED', { timeout: 5000 });
  });

});

test.describe('Terminal Multi-User Isolation & Concurrent Sessions', () => {

  test('two users in same workspace get independent PTY sessions with isolated shell state', async ({ page, context }) => {
    const browser = context.browser();
    if (!browser) throw new Error('Browser not initialized');

    const timestamp = Date.now();
    const userA = `UserA_Iso_${timestamp}`;
    const userB = `UserB_Iso_${timestamp}`;

    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(userA);
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });

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
    await expect(pageB).toHaveURL(/\/dashboard/, { timeout: 20000 });

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

    await textareaA.focus();
    await page.keyboard.type('export MY_SECRET_A="onlyForA"', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('mkdir -p subdir_a && cd subdir_a', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    await textareaB.focus();
    await pageB.keyboard.type('export MY_SECRET_B="onlyForB"', { delay: 10 });
    await pageB.keyboard.press('Enter');
    await pageB.waitForTimeout(500);

    await textareaB.focus();
    await pageB.keyboard.type('echo "B_CHECK:$MY_SECRET_A"', { delay: 10 });
    await pageB.keyboard.press('Enter');
    await expect(terminalB).toContainText('B_CHECK:', { timeout: 5000 });

    await pageB.keyboard.type('echo "B_OWN:$MY_SECRET_B"', { delay: 10 });
    await pageB.keyboard.press('Enter');
    await expect(terminalB).toContainText('B_OWN:onlyForB', { timeout: 5000 });

    await textareaA.focus();
    await page.keyboard.type('pwd', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalA).toContainText('subdir_a', { timeout: 5000 });

    await textareaB.focus();
    await pageB.keyboard.type('pwd', { delay: 10 });
    await pageB.keyboard.press('Enter');
    await expect(terminalB).toContainText(`/workspaces/${workspaceId}`, { timeout: 5000 });

    await textareaA.focus();
    await page.keyboard.type('echo "from_A" > ../created_by_a.txt', { delay: 10 });
    await page.keyboard.press('Enter');

    await textareaB.focus();
    await pageB.keyboard.type('echo "from_B" > created_by_b.txt', { delay: 10 });
    await pageB.keyboard.press('Enter');

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
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `MultiTab_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await expect(page).toHaveURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = page.url().split('/ide/')[1].split('/')[0];
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminal1 = page.locator('.xterm');
    const textarea1 = page.locator('.xterm-helper-textarea');
    await expect(terminal1).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await textarea1.focus();
    await page.keyboard.type('echo "TAB1_MARKER" > tab1_test.txt', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    const page2 = await context.newPage();
    await page2.goto(`/ide/${workspaceId}`);
    await page2.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminal2 = page2.locator('.xterm');
    const textarea2 = page2.locator('.xterm-helper-textarea');
    await expect(terminal2).toContainText('sandbox:~#', { timeout: 25000 });
    await page2.waitForTimeout(2000);

    await textarea2.focus();
    await page2.keyboard.type('cat tab1_test.txt', { delay: 10 });
    await page2.keyboard.press('Enter');
    await expect(terminal2).toContainText('TAB1_MARKER', { timeout: 5000 });

    await page.close();
    await page2.waitForTimeout(1000);

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
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Signal_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalBody = page.locator('.xterm');
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await terminalTextarea.focus();
    await page.keyboard.type('sleep 300', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    await page.keyboard.press('Control+Z');
    await page.waitForTimeout(1000);

    await expect(terminalBody).toContainText(/Stopped|stopped/i, { timeout: 5000 });

    await page.keyboard.type('echo "SHELL_BACK"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('SHELL_BACK', { timeout: 5000 });

    await page.keyboard.type('jobs', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('sleep', { timeout: 5000 });

    await page.keyboard.type('fg', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

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
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `SigTrap_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalBody = page.locator('.xterm');
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

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

    await page.keyboard.type('node trap.js', { delay: 10 });
    await page.keyboard.press('Enter');

    await expect(terminalBody).toContainText('HEARTBEAT', { timeout: 8000 });

    await page.waitForTimeout(1000);

    await page.keyboard.press('Control+C');

    await expect(terminalBody).toContainText('GRACEFUL_SHUTDOWN_CAUGHT', { timeout: 8000 });

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
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `DirSync_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    await page.waitForSelector('text=Select a file from the explorer to begin.');

    const terminalBody = page.locator('.xterm');
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await terminalTextarea.focus();

    await page.keyboard.type('mkdir -p src/components/ui', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    await page.keyboard.type('echo "export default App;" > src/App.tsx', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('echo "export const Button = () => {};" > src/components/ui/Button.tsx', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('echo "body { margin: 0; }" > src/styles.css', { delay: 10 });
    await page.keyboard.press('Enter');

    const srcFolder = page.locator('.ide-scrollbar').getByText('src');
    await expect(srcFolder).toBeVisible({ timeout: 15000 });

    await srcFolder.click();
    await page.waitForTimeout(1000);
    const appFile = page.locator('.ide-scrollbar').getByText('App.tsx');
    await expect(appFile).toBeVisible({ timeout: 10000 });

    await appFile.click();
    await page.waitForSelector('.monaco-editor', { timeout: 25000 });
    await expect(page.locator('.monaco-editor')).toContainText('export default App', { timeout: 10000 });

    await terminalTextarea.focus();
    await page.keyboard.type('rm src/styles.css', { delay: 10 });
    await page.keyboard.press('Enter');

    const stylesFile = page.locator('.ide-scrollbar').getByText('styles.css');
    await expect(stylesFile).not.toBeVisible({ timeout: 20000 });

    await page.keyboard.type('echo "config" > src/my-config.test.ts', { delay: 10 });
    await page.keyboard.press('Enter');
    const configFile = page.locator('.ide-scrollbar').getByText('my-config.test.ts');
    await expect(configFile).toBeVisible({ timeout: 15000 });

    await page.keyboard.type('mv src/App.tsx src/Main.tsx', { delay: 10 });
    await page.keyboard.press('Enter');

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
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Npm_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalBody = page.locator('.xterm');
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await terminalTextarea.focus();

    const pkgJson = '{"name":"test-pkg","version":"1.0.0","dependencies":{"is-odd":"3.0.1"}}';
    await page.keyboard.type(`echo '${pkgJson}' > package.json`, { delay: 5 });
    await page.keyboard.press('Enter');

    const pkgFile = page.locator('.ide-scrollbar').getByText('package.json');
    await expect(pkgFile).toBeVisible({ timeout: 15000 });

    await page.keyboard.type('npm install', { delay: 10 });
    await page.keyboard.press('Enter');

    await expect(terminalBody).toContainText(/added|up to date/i, { timeout: 30000 });

    await page.keyboard.type('ls node_modules/is-odd/index.js', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('node_modules/is-odd/index.js', { timeout: 5000 });

    const nodeModulesEntry = page.locator('.ide-scrollbar').getByText('node_modules', { exact: true });
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
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Pipes_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalBody = page.locator('.xterm');
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await terminalTextarea.focus();

    await page.keyboard.type('echo "apple banana cherry" | grep -o "banana"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('banana', { timeout: 5000 });

    await page.keyboard.type('echo -e "zeta\\nalpha\\nbeta" | sort | head -1', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('alpha', { timeout: 5000 });

    await page.keyboard.type('echo "line1" > append_test.txt', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('echo "line2" >> append_test.txt', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('echo "line3" >> append_test.txt', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('wc -l append_test.txt', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('3', { timeout: 5000 });

    await page.keyboard.type('true && echo "CHAIN_AND_OK"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('CHAIN_AND_OK', { timeout: 5000 });

    await page.keyboard.type('false || echo "CHAIN_OR_OK"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('CHAIN_OR_OK', { timeout: 5000 });

    await page.keyboard.type('ls /nonexistent 2> err.txt; cat err.txt', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText(/No such file|cannot access/i, { timeout: 5000 });

    await page.keyboard.type('echo "Today is $(date +%A)"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText(/Today is (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i, { timeout: 5000 });

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
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `ANSI_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalBody = page.locator('.xterm');
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await terminalTextarea.focus();

    await page.keyboard.type('echo -e "\\033[31mRED_TEXT\\033[0m \\033[32mGREEN_TEXT\\033[0m \\033[34mBLUE_TEXT\\033[0m"', { delay: 5 });
    await page.keyboard.press('Enter');

    await expect(terminalBody).toContainText('RED_TEXT', { timeout: 5000 });
    await expect(terminalBody).toContainText('GREEN_TEXT', { timeout: 5000 });
    await expect(terminalBody).toContainText('BLUE_TEXT', { timeout: 5000 });

    await page.keyboard.type('echo -e "ABCDEF\\033[3D***"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('ABC***', { timeout: 5000 });

    await page.keyboard.press('Control+L');
    await page.waitForTimeout(500);
    await page.keyboard.type('echo "AFTER_CLEAR"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('AFTER_CLEAR', { timeout: 5000 });

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
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });

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

    await page.keyboard.type('pwd', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText(`/workspaces/${workspaceId}`, { timeout: 5000 });

    await page.keyboard.type('mkdir -p deep/nested/path/here', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('cd deep/nested/path/here', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('pwd', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('deep/nested/path/here', { timeout: 5000 });

    await page.keyboard.type('cd ../..', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('pwd', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('deep/nested', { timeout: 5000 });

    await page.keyboard.type('cd -', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('deep/nested/path/here', { timeout: 5000 });

    await page.keyboard.type(`cd /workspaces/${workspaceId}`, { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('pwd', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText(`/workspaces/${workspaceId}`, { timeout: 5000 });

    await page.keyboard.type('echo $HOME', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText(`/workspaces/${workspaceId}`, { timeout: 5000 });

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
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Burst_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    await page.waitForSelector('text=Select a file from the explorer to begin.');

    const terminalBody = page.locator('.xterm');
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await terminalTextarea.focus();

    const burstCmd = 'for i in $(seq 1 10); do echo "content_$i" > "burst_file_$i.txt"; done';
    await page.keyboard.type(burstCmd, { delay: 5 });
    await page.keyboard.press('Enter');

    await page.waitForTimeout(8000);

    const firstFile = page.locator('.ide-scrollbar').getByText('burst_file_1.txt');
    const lastFile = page.locator('.ide-scrollbar').getByText('burst_file_10.txt');
    await expect(firstFile).toBeVisible({ timeout: 10000 });
    await expect(lastFile).toBeVisible({ timeout: 10000 });

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
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Race_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    await page.waitForSelector('text=Select a file from the explorer to begin.');

    const terminalBody = page.locator('.xterm');
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await terminalTextarea.focus();
    await page.keyboard.type('echo "EDITOR_TARGET" > editor_file.js', { delay: 10 });
    await page.keyboard.press('Enter');

    const editorFile = page.locator('.ide-scrollbar').getByText('editor_file.js');
    await expect(editorFile).toBeVisible({ timeout: 15000 });
    await editorFile.click();
    await page.waitForSelector('.monaco-editor', { timeout: 25000 });
    await expect(page.locator('.monaco-editor')).toContainText('EDITOR_TARGET', { timeout: 10000 });

    await page.locator('.monaco-editor').first().click();
    await page.waitForTimeout(500);
    await page.keyboard.type('// EDITOR_ADDITION\n', { delay: 20 });
    await page.waitForTimeout(2000); // Let Yjs debounce fire

    await terminalTextarea.focus();
    await page.keyboard.type('echo "TERMINAL_SEPARATE" > terminal_file.js', { delay: 10 });
    await page.keyboard.press('Enter');

    const terminalFile = page.locator('.ide-scrollbar').getByText('terminal_file.js');
    await expect(terminalFile).toBeVisible({ timeout: 15000 });

    await editorFile.click();
    await page.waitForTimeout(1000);
    await expect(page.locator('.monaco-editor')).toContainText('EDITOR_ADDITION', { timeout: 10000 });

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
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });

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

    await page.keyboard.type('echo "TERM=$TERM"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('TERM=xterm-256color', { timeout: 5000 });

    await page.keyboard.type('echo "HOME=$HOME"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText(`HOME=/workspaces/${workspaceId}`, { timeout: 5000 });

    await page.keyboard.type('node --version', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText(/v\d+\.\d+/, { timeout: 5000 });

    await page.keyboard.type('python3 --version', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText(/Python \d+\.\d+/, { timeout: 5000 });

    await page.keyboard.type('gcc --version | head -1', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText(/gcc/i, { timeout: 5000 });

    await page.keyboard.type('which run', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('/usr/local/bin/run', { timeout: 5000 });

    await page.keyboard.type('echo "console.log(42 * 2);" > calc.js', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('run calc.js', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('84', { timeout: 5000 });

    await page.keyboard.type('echo "print(7 ** 3)" > power.py', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('run power.py', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('343', { timeout: 5000 });

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
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Compile_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalBody = page.locator('.xterm');
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await terminalTextarea.focus();

    const cProgram = '#include <stdio.h>\\nint main() { printf("C_OUTPUT_OK\\\\n"); return 0; }';
    await page.keyboard.type(`echo -e '${cProgram}' > hello.c`, { delay: 5 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    await page.keyboard.type('run hello.c', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('C_OUTPUT_OK', { timeout: 10000 });

    const cppProgram = '#include <iostream>\\n#include <vector>\\nint main() { std::vector<int> v = {1,2,3}; std::cout << "CPP_VECTOR_SIZE:" << v.size() << std::endl; return 0; }';
    await page.keyboard.type(`echo -e '${cppProgram}' > test.cpp`, { delay: 5 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    await page.keyboard.type('run test.cpp', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('CPP_VECTOR_SIZE:3', { timeout: 15000 });

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
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `History_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalBody = page.locator('.xterm');
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await terminalTextarea.focus();

    await page.keyboard.type('echo "HISTORY_CMD_1"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('HISTORY_CMD_1', { timeout: 5000 });

    await page.keyboard.type('echo "HISTORY_CMD_2"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('HISTORY_CMD_2', { timeout: 5000 });

    await page.keyboard.type('echo "HISTORY_CMD_3"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('HISTORY_CMD_3', { timeout: 5000 });

    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');

    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    await page.keyboard.type('alias ll="ls -la"', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('ll', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText(/total|drwx/i, { timeout: 5000 });

    await page.keyboard.type('MY_VAR="PERSISTENT_VALUE"', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('echo "CHECK:$MY_VAR"', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(terminalBody).toContainText('CHECK:PERSISTENT_VALUE', { timeout: 5000 });

    await page.keyboard.type('echo "LAST_COMMAND_TEST"', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('!!', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);
    await expect(terminalBody).toContainText('LAST_COMMAND_TEST', { timeout: 5000 });
  });

  test('runs standard Node React Express server replica and serves live preview', async ({ page, context }) => {
    const timestamp = Date.now();
    const username = `FullProj_${timestamp}`;
    const workspaceTitle = `FullProj_WS_${timestamp}`;

    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(username);
    
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });

    await page.fill('input[placeholder="e.g. React-Sandbox"]', workspaceTitle);
    await page.click('button:has-text("Create Now")');

    await expect(page).toHaveURL(/\/ide\/[a-f0-9-]+/);
    const ideUrl = page.url();
    const workspaceId = ideUrl.split('/ide/')[1].split('/')[0];
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    await page.waitForSelector('text=Select a file from the explorer to begin.');

    const terminalTextarea = page.locator('.xterm-helper-textarea');
    const terminalBody = page.locator('.xterm');

    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    const serverScript = `
const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h1>Express Backend Active</h1><p>React Mock Frontend Mounted</p>');
});
server.listen(3000, () => {
  console.log('Server ' + 'listening on port 3000');
});
`;

    await terminalTextarea.focus();
    await page.keyboard.type(`cat << 'EOF' > app.js\n${serverScript}\nEOF\n`, { delay: 10 });
    await page.waitForTimeout(1500);

    await page.keyboard.type('node app.js &\n', { delay: 10 });
    await expect(terminalBody).toContainText('Server listening on port 3000', { timeout: 10000 });
    await page.waitForTimeout(1000);

    const token = await page.evaluate(() => localStorage.getItem('token') || '');
    
    const previewPage = await context.newPage();
    await previewPage.goto(`${API_URL.replace('/api', '')}/api/workspace/${workspaceId}/preview/?token=${token}`);
    
    await expect(previewPage.locator('h1')).toHaveText('Express Backend Active', { timeout: 15000 });
    await expect(previewPage.locator('p')).toContainText('React Mock Frontend Mounted', { timeout: 15000 });
    
    await previewPage.close();
  });

  test('runs split frontend and backend servers simultaneously and serves proxied live preview', async ({ page, context }) => {
    const timestamp = Date.now();
    const username = `SplitProj_${timestamp}`;
    const workspaceTitle = `SplitProj_WS_${timestamp}`;

    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(username);
    
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });

    await page.fill('input[placeholder="e.g. React-Sandbox"]', workspaceTitle);
    await page.click('button:has-text("Create Now")');

    await expect(page).toHaveURL(/\/ide\/[a-f0-9-]+/);
    const ideUrl = page.url();
    const workspaceId = ideUrl.split('/ide/')[1].split('/')[0];
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    await page.waitForSelector('text=Select a file from the explorer to begin.');

    const terminalTextarea = page.locator('.xterm-helper-textarea');
    const terminalBody = page.locator('.xterm');

    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    const backendScript = `
const http = require('http');
const server = http.createServer((req, res) => {
  if (req.url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', source: 'backend-api' }));
  } else {
    res.writeHead(404);
    res.end();
  }
});
server.listen(5000, () => {
  console.log('Backend listening on port 5000');
});
`;

    const frontendScript = `
const http = require('http');
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api')) {
    const proxyReq = http.request({
      host: 'localhost',
      port: 5000,
      path: req.url,
      method: req.method,
      headers: req.headers
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    req.pipe(proxyReq);
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!DOCTYPE html><html><body><h1>React Frontend</h1><div id=\\"status\\">Connecting to API...</div><script>fetch(\\"/api/status\\").then(r => r.json()).then(data => { document.getElementById(\\"status\\").innerText = \\"Connected to: \\" + data.source; }).catch(err => { document.getElementById(\\"status\\").innerText = \\"Error: \\" + err.message; });</script></body></html>');
  }
});
server.listen(3000, () => {
  console.log('Frontend dev server listening on port 3000');
});
`;

    await terminalTextarea.focus();
    await page.keyboard.type('mkdir -p backend frontend\n', { delay: 10 });
    await page.waitForTimeout(500);

    await page.keyboard.type(`cat << 'EOF' > backend/server.js\n${backendScript}\nEOF\n`, { delay: 10 });
    await page.waitForTimeout(1000);
    await page.keyboard.type(`cat << 'EOF' > frontend/dev-server.js\n${frontendScript}\nEOF\n`, { delay: 10 });
    await page.waitForTimeout(1000);

    await page.keyboard.type('node backend/server.js &\n', { delay: 10 });
    await expect(terminalBody).toContainText('Backend listening on port 5000', { timeout: 10000 });

    await page.keyboard.type('node frontend/dev-server.js &\n', { delay: 10 });
    await expect(terminalBody).toContainText('Frontend dev server listening on port 3000', { timeout: 10000 });

    const token = await page.evaluate(() => localStorage.getItem('token') || '');
    const previewPage = await context.newPage();
    await previewPage.goto(`${API_URL.replace('/api', '')}/api/workspace/${workspaceId}/preview/?token=${token}`);

    await expect(previewPage.locator('h1')).toHaveText('React Frontend', { timeout: 15000 });
    await expect(previewPage.locator('#status')).toHaveText('Connected to: backend-api', { timeout: 15000 });

    await previewPage.close();
  });

  test('admin clones repo, commits, leaves, returns and makes new changes with correct git status', async ({ page }) => {
    const timestamp = Date.now();
    const username = `GitFlow_${timestamp}`;
    const workspaceTitle = `GitFlow_WS_${timestamp}`;

    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(username);
    
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });

    await page.fill('input[placeholder="e.g. React-Sandbox"]', workspaceTitle);
    await page.click('button:has-text("Create Now")');

    await expect(page).toHaveURL(/\/ide\/[a-f0-9-]+/);
    const ideUrl = page.url();
    const workspaceId = ideUrl.split('/ide/')[1].split('/')[0];
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    await page.waitForSelector('text=Select a file from the explorer to begin.');

    const terminalTextarea = page.locator('.xterm-helper-textarea');
    const terminalBody = page.locator('.xterm');

    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await terminalTextarea.focus();
    await page.keyboard.type('git config --global user.email "test@example.com" && git config --global user.name "Tester"\n', { delay: 10 });
    await page.waitForTimeout(500);

    await page.keyboard.type('git clone https://github.com/AmanKashyapp07/github-test-ci.git\n', { delay: 10 });
    await page.waitForTimeout(8000); // Allow sufficient time for the git clone download to finish
    await page.keyboard.type('ls -la\n', { delay: 10 });
    await expect(terminalBody).toContainText('github-test-ci', { timeout: 10000 });

    await page.keyboard.type('cd github-test-ci && echo "first_edit" >> README.md && git add README.md && git commit -m "first commit"\n', { delay: 10 });
    await page.waitForTimeout(1500);

    await page.keyboard.type('git status\n', { delay: 10 });
    await expect(terminalBody).toContainText('nothing to commit, working tree clean', { timeout: 5000 });

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });

    await page.goto(ideUrl);
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalTextarea2 = page.locator('.xterm-helper-textarea');
    const terminalBody2 = page.locator('.xterm');
    await expect(terminalBody2).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await terminalTextarea2.focus();
    await page.keyboard.type('cd github-test-ci && echo "second_edit" >> README.md && git status\n', { delay: 10 });
    await expect(terminalBody2).toContainText('modified:   README.md', { timeout: 10000 });
  });

  test('blocks git commands when admin is not signed in via GitHub (test account)', async ({ page }) => {
    const timestamp = Date.now();
    const username = `NoGit_${timestamp}`;
    const workspaceTitle = `NoGit_WS_${timestamp}`;

    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(username);
    
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });

    await page.fill('input[placeholder="e.g. React-Sandbox"]', workspaceTitle);
    await page.click('button:has-text("Create Now")');

    await expect(page).toHaveURL(/\/ide\/[a-f0-9-]+/);
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
    await page.waitForSelector('text=Select a file from the explorer to begin.');

    const terminalTextarea = page.locator('.xterm-helper-textarea');
    const terminalBody = page.locator('.xterm');

    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await terminalTextarea.focus();
    await page.keyboard.type('git status\n', { delay: 10 });
    
    await expect(terminalBody).toContainText('Error: Git commands are only available when signed in with a GitHub account.', { timeout: 10000 });
  });

});

test.describe('Terminal Multi-File Interconnection & Compilation', () => {

  test('compiles and executes multi-file C++ project with headers and implementations', async ({ page }) => {
    const timestamp = Date.now();
    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(`CppMulti_${timestamp}`);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Cpp_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalBody = page.locator('.xterm');
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await terminalTextarea.focus();
    await page.keyboard.type('mkdir cpp_project && cd cpp_project\n', { delay: 10 });

    const headerCode = `
#ifndef MATH_UTILS_H
#define MATH_UTILS_H
int multiply(int a, int b);
#endif
`;
    await page.keyboard.type(`cat << 'EOF' > math_utils.h\n${headerCode}\nEOF\n`, { delay: 10 });

    const implCode = `
#include "math_utils.h"
int multiply(int a, int b) {
    return a * b;
}
`;
    await page.keyboard.type(`cat << 'EOF' > math_utils.cpp\n${implCode}\nEOF\n`, { delay: 10 });

    const mainCode = `
#include <iostream>
#include "math_utils.h"
int main() {
    std::cout << "CPP_LINK_OK: " << multiply(21, 2) << std::endl;
    return 0;
}
`;
    await page.keyboard.type(`cat << 'EOF' > main.cpp\n${mainCode}\nEOF\n`, { delay: 10 });
    await page.waitForTimeout(1000);

    await page.keyboard.type('g++ main.cpp math_utils.cpp -o app\n', { delay: 10 });
    await expect(terminalBody).toContainText('app', { timeout: 15000 }); 
    
    await page.keyboard.type('./app\n', { delay: 10 });
    await expect(terminalBody).toContainText('CPP_LINK_OK: 42', { timeout: 5000 });
  });

  test('executes multi-file Python program with package initialization and cross-imports', async ({ page }) => {
    const timestamp = Date.now();
    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(`PyMulti_${timestamp}`);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Py_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalBody = page.locator('.xterm');
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await terminalTextarea.focus();
    
    await page.keyboard.type('mkdir -p my_package/submodule\n', { delay: 10 });
    await page.keyboard.type('touch my_package/__init__.py my_package/submodule/__init__.py\n', { delay: 10 });

    const helperCode = `
def get_status():
    return "PYTHON_IMPORT_SUCCESS"
`;
    await page.keyboard.type(`cat << 'EOF' > my_package/submodule/helper.py\n${helperCode}\nEOF\n`, { delay: 10 });

    const mainPyCode = `
import sys
from my_package.submodule.helper import get_status

def main():
    print(f"Status: {get_status()}")
    print(f"Args: {sys.argv[1] if len(sys.argv) > 1 else 'None'}")

if __name__ == "__main__":
    main()
`;
    await page.keyboard.type(`cat << 'EOF' > main.py\n${mainPyCode}\nEOF\n`, { delay: 10 });
    await page.waitForTimeout(1000);

    await page.keyboard.type('python3 main.py IDE_TESTER\n', { delay: 10 });
    
    await expect(terminalBody).toContainText('Status: PYTHON_IMPORT_SUCCESS', { timeout: 5000 });
    await expect(terminalBody).toContainText('Args: IDE_TESTER', { timeout: 5000 });
  });

  test('resolves Node.js ESM and CommonJS interop and deeply nested requires', async ({ page }) => {
    const timestamp = Date.now();
    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(`NodeMulti_${timestamp}`);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Node_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalBody = page.locator('.xterm');
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await terminalTextarea.focus();

    const cjsModule = `module.exports = { secret: 'CJS_MODULE_LOADED' };`;
    await page.keyboard.type(`cat << 'EOF' > lib.cjs\n${cjsModule}\nEOF\n`, { delay: 10 });
    
    const cjsMain = `const lib = require('./lib.cjs'); console.log(lib.secret);`;
    await page.keyboard.type(`cat << 'EOF' > main.cjs\n${cjsMain}\nEOF\n`, { delay: 10 });
    
    await page.keyboard.type('node main.cjs\n', { delay: 10 });
    await expect(terminalBody).toContainText('CJS_MODULE_LOADED', { timeout: 5000 });

    const esmModule = `export const calculate = (n) => n * 3;`;
    await page.keyboard.type(`cat << 'EOF' > math.mjs\n${esmModule}\nEOF\n`, { delay: 10 });

    const esmMain = `import { calculate } from './math.mjs'; console.log('ESM_RESULT_' + calculate(5));`;
    await page.keyboard.type(`cat << 'EOF' > app.mjs\n${esmMain}\nEOF\n`, { delay: 10 });

    await page.keyboard.type('node app.mjs\n', { delay: 10 });
    await expect(terminalBody).toContainText('ESM_RESULT_15', { timeout: 5000 });
  });

  test('executes a mixed-language pipeline (Bash -> Python -> Node -> C++)', async ({ page }) => {
    const timestamp = Date.now();
    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(`MixedLang_${timestamp}`);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Mixed_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalBody = page.locator('.xterm');
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await terminalTextarea.focus();

    const pyScript = `import sys\nprint(int(sys.stdin.read().strip()) * 2)`;
    await page.keyboard.type(`cat << 'EOF' > step1.py\n${pyScript}\nEOF\n`, { delay: 10 });

    const nodeScript = `const fs = require('fs'); const input = parseInt(fs.readFileSync(0, 'utf-8').trim()); console.log(input + 10);`;
    await page.keyboard.type(`cat << 'EOF' > step2.js\n${nodeScript}\nEOF\n`, { delay: 10 });

    const cppScript = `
#include <iostream>
#include <cstdlib>
int main(int argc, char** argv) {
    if(argc > 1) std::cout << "PIPELINE_FINAL:" << argv[1] << std::endl;
    return 0;
}
`;
    await page.keyboard.type(`cat << 'EOF' > step3.cpp\n${cppScript}\nEOF\n`, { delay: 10 });
    await page.keyboard.type('g++ step3.cpp -o step3_bin\n', { delay: 10 });
    await expect(terminalBody).toContainText('step3_bin', { timeout: 15000 });

    await page.keyboard.type('result=$(echo "5" | python3 step1.py | node step2.js)\n', { delay: 10 });
    await page.keyboard.type('./step3_bin $result\n', { delay: 10 });

    await expect(terminalBody).toContainText('PIPELINE_FINAL:20', { timeout: 10000 });
  });

});

test.describe('Terminal Advanced File System Edge Cases', () => {

  

  test('handles large file operations, binary downloads, and permission modifications (chmod)', async ({ page }) => {
    const timestamp = Date.now();
    await page.goto('/login');
    const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.click();
    await usernameInput.fill(`Perms_${timestamp}`);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Perms_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });

    const terminalBody = page.locator('.xterm');
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
    await page.waitForTimeout(3000);

    await terminalTextarea.focus();

    await page.keyboard.type('curl -s https://raw.githubusercontent.com/torvalds/linux/master/README > linux_readme.txt\n', { delay: 10 });
    
    await page.keyboard.type('wc -l linux_readme.txt\n', { delay: 10 });
    await expect(terminalBody).toContainText(/[1-9][0-9]+ linux_readme\.txt/, { timeout: 10000 });

    const bashScript = `#!/bin/bash\necho "EXECUTION_GRANTED_OK"`;
    await page.keyboard.type(`cat << 'EOF' > runner.sh\n${bashScript}\nEOF\n`, { delay: 10 });
    
    await page.keyboard.type('./runner.sh\n', { delay: 10 });
    await expect(terminalBody).toContainText(/Permission denied|not found/, { timeout: 5000 });

    await page.keyboard.type('chmod +x runner.sh\n', { delay: 10 });
    
    await page.keyboard.type('./runner.sh\n', { delay: 10 });
    await expect(terminalBody).toContainText('EXECUTION_GRANTED_OK', { timeout: 5000 });
  });

});








/** Wait until the LSP status badge reaches a specific status */
async function waitForLspStatus(page: Page, status: 'ready' | 'connecting' | 'error', timeout = 45000) {
  await expect(
    page.locator('[data-testid="lsp-status-badge"]')
  ).toHaveAttribute('data-lsp-status', status, { timeout });
}



/** Returns Monaco marker messages for the active model */
async function getMarkers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const monaco = (window as any).monaco;
    if (!monaco) return [];
    const models = monaco.editor.getModels();
    if (!models.length) return [];
    return monaco.editor
      .getModelMarkers({ resource: models[0].uri })
      .map((m: any) => m.message as string);
  });
}


test.describe('LSP - Language Intelligence', () => {

  test('1. LSP badge shows connecting then ready for a TypeScript file', async ({ page }) => {
    const ts = Date.now();
    await loginUser(page, `LspTs_${ts}`);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `LSP_TS_${ts}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[a-f0-9-]+/);
    await waitForBootComplete(page);

    await createFile(page, 'index.ts');
    await waitForEditorModel(page, 'index.ts');

    await expect(page.locator('[data-testid="lsp-status-badge"]')).toBeVisible({ timeout: 15000 });

    await waitForLspStatus(page, 'ready', 30000);
  });

  test('2. LSP badge shows ready for a Python file', async ({ page }) => {
    const ts = Date.now();
    await loginUser(page, `LspPy_${ts}`);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `LSP_PY_${ts}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[a-f0-9-]+/);
    await waitForBootComplete(page);

    await createFile(page, 'main.py');
    await waitForEditorModel(page, 'main.py');

    await expect(page.locator('[data-testid="lsp-status-badge"]')).toBeVisible({ timeout: 15000 });
    await waitForLspStatus(page, 'ready', 30000);
  });

  test('3. LSP badge does not appear for unsupported languages (JSON)', async ({ page }) => {
    const ts = Date.now();
    await loginUser(page, `LspNone_${ts}`);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `LSP_NONE_${ts}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[a-f0-9-]+/);
    await waitForBootComplete(page);

    await createFile(page, 'config.json');
    await waitForEditorModel(page, 'config.json');

    await page.waitForTimeout(3000);

    await expect(page.locator('[data-testid="lsp-status-badge"]')).not.toBeVisible();
  });

  test('4. TypeScript LSP emits diagnostics for a type error', async ({ page }) => {
    const ts = Date.now();
    await loginUser(page, `LspDiag_${ts}`);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `LSP_DIAG_${ts}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[a-f0-9-]+/);
    await waitForBootComplete(page);

    await createFile(page, 'error.ts');
    await waitForEditorModel(page, 'error.ts');

    await waitForLspStatus(page, 'ready', 30000);

    const errorCode = `const x: string = 42;`;
    await setEditorValue(page, errorCode);

    await expect.poll(async () => {
      const markers = await getMarkers(page);
      return markers.length;
    }, { timeout: 15000, intervals: [1000, 2000, 3000] }).toBeGreaterThan(0);

    const markers = await getMarkers(page);
    expect(markers.some(m => m.toLowerCase().includes('string') || m.toLowerCase().includes('number') || m.toLowerCase().includes('assignable'))).toBe(true);
  });

  test('5. Python LSP (Pyright) emits diagnostics for an undefined variable', async ({ page }) => {
    const ts = Date.now();
    await loginUser(page, `LspPyDiag_${ts}`);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `LSP_PYDIAG_${ts}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[a-f0-9-]+/);
    await waitForBootComplete(page);

    await createFile(page, 'bad.py');
    await waitForEditorModel(page, 'bad.py');

    await waitForLspStatus(page, 'ready', 30000);

    const errorCode = `result = undefined_function_xyz()`;
    await setEditorValue(page, errorCode);

    await expect.poll(async () => {
      const markers = await getMarkers(page);
      return markers.length;
    }, { timeout: 15000, intervals: [1000, 2000, 3000] }).toBeGreaterThan(0);

    const markers = await getMarkers(page);
    expect(markers.some(m =>
      m.toLowerCase().includes('undefined') ||
      m.toLowerCase().includes('not defined') ||
      m.toLowerCase().includes('unknown')
    )).toBe(true);
  });

  test('6. Diagnostics clear when the type error is corrected', async ({ page }) => {
    const ts = Date.now();
    await loginUser(page, `LspClear_${ts}`);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `LSP_CLEAR_${ts}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[a-f0-9-]+/);
    await waitForBootComplete(page);

    await createFile(page, 'fix.ts');
    await waitForEditorModel(page, 'fix.ts');
    await waitForLspStatus(page, 'ready', 30000);

    await setEditorValue(page, `const x: string = 42;`);
    await expect.poll(async () => (await getMarkers(page)).length, { timeout: 15000 }).toBeGreaterThan(0);

    await setEditorValue(page, `const x: string = "hello";`);
    await expect.poll(async () => (await getMarkers(page)).length, { timeout: 15000 }).toBe(0);
  });

  test('7. Viewer role cannot connect to LSP — no badge shown', async ({ page, context }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const ts = Date.now();

    await loginUser(alicePage, `LspOwner_${ts}`);
    await loginUser(bobPage, `LspViewer_${ts}`);

    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `LSP_RBAC_${ts}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await createFile(alicePage, 'secret.ts');
    await alicePage.waitForTimeout(1000);
    await inviteUser(alicePage, `LspViewer_${ts}`, 'viewer');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);
    await bobPage.locator('.ide-scrollbar').getByText('secret.ts').click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });

    await expect(bobPage.locator('text=View Only')).toBeVisible({ timeout: 10000 });
    await bobPage.waitForTimeout(5000);
    await expect(bobPage.locator('[data-testid="lsp-status-badge"]')).not.toBeVisible();

    const wsRejectCode = await bobPage.evaluate(async ({ wsId }) => {
      const token = localStorage.getItem('token') ?? '';
      return new Promise<number>((resolve) => {
        const hostname = window.location.hostname;
        const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
        const wsUrl = isLocal
          ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${hostname}:4000`
          : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${hostname}/ws`;
        const ws = new WebSocket(
          `${wsUrl}/ws/lsp/${wsId}/typescript?token=${encodeURIComponent(token)}`
        );
        ws.onclose = (e) => resolve(e.code);
        ws.onerror = () => resolve(-1);
        setTimeout(() => resolve(-2), 8000);
      });
    }, { wsId: workspaceId });

    expect(wsRejectCode).toBe(4403);

    await bobPage.close();
  });

  test.skip('8. Switching from TypeScript to Python file reconnects to the correct LSP', async ({ page }) => {
    const ts = Date.now();
    await loginUser(page, `LspSwitch_${ts}`);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `LSP_SWITCH_${ts}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[a-f0-9-]+/);
    await waitForBootComplete(page);

    await createFile(page, 'app.ts');
    await page.waitForTimeout(500);
    await createFile(page, 'script.py');
    await page.waitForTimeout(500);

    await page.locator('.ide-scrollbar').getByText('app.ts').click();
    await page.waitForSelector('.monaco-editor', { timeout: 15000 });
    await waitForLspStatus(page, 'ready', 30000);

    await setEditorValue(page, `const n: number = "not a number";`);
    await expect.poll(async () => (await getMarkers(page)).length, { timeout: 15000 }).toBeGreaterThan(0);

    await page.locator('.ide-scrollbar').getByText('script.py').click();
    await page.waitForTimeout(500); // let the TS LSP session close

    await expect(page.locator('[data-testid="lsp-status-badge"]')).toBeVisible({ timeout: 10000 });
    await waitForLspStatus(page, 'ready', 30000);

    await setEditorValue(page, `x: int = "this is wrong"`);
    await expect.poll(async () => (await getMarkers(page)).length, { timeout: 15000 }).toBeGreaterThan(0);

    await page.locator('.ide-scrollbar').getByText('app.ts').click();
    await waitForLspStatus(page, 'ready', 30000);
    const tsMarkers = await getMarkers(page);
    expect(tsMarkers.length).toBeGreaterThan(0);
  });
  test('9. LSP WebSocket rejects connections with an invalid token', async ({ page }) => {
    const ts = Date.now();
    await loginUser(page, `LspAuth_${ts}`);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `LSP_AUTH_${ts}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = page.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(page);

    const closeCode = await page.evaluate(async ({ wsId }) => {
      return new Promise<number>((resolve) => {
        const hostname = window.location.hostname;
        const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
        const wsUrl = isLocal
          ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${hostname}:4000`
          : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${hostname}/ws`;
        const ws = new WebSocket(`${wsUrl}/ws/lsp/${wsId}/typescript?token=invalid_token_xyz`);
        ws.onclose = (e) => resolve(e.code);
        ws.onerror = () => resolve(-1);
        setTimeout(() => resolve(-2), 5000);
      });
    }, { wsId: workspaceId });

    expect([4401, 1006, -1]).toContain(closeCode);
  });

  test('10. Viewer badge stays absent after switching files', async ({ page, context }) => {
    const alicePage = page;
    const bobPage = await context.browser()!.newContext().then(c => c.newPage());
    const ts = Date.now();

    await loginUser(alicePage, `LspOwner2_${ts}`);
    await loginUser(bobPage, `LspViewer2_${ts}`);

    await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `LSP_RBAC2_${ts}`);
    await alicePage.click('button:has-text("Create Now")');
    await alicePage.waitForURL(/\/ide\/[a-f0-9-]+/);
    const workspaceId = alicePage.url().split('/ide/')[1].split('/')[0];
    await waitForBootComplete(alicePage);

    await createFile(alicePage, 'a.ts');
    await alicePage.waitForTimeout(500);
    await createFile(alicePage, 'b.py');
    await alicePage.waitForTimeout(500);
    await inviteUser(alicePage, `LspViewer2_${ts}`, 'viewer');

    await bobPage.goto(`${APP_URL}/ide/${workspaceId}`);
    await waitForBootComplete(bobPage);

    await bobPage.locator('.ide-scrollbar').getByText('a.ts').click();
    await bobPage.waitForSelector('.monaco-editor', { timeout: 15000 });
    await bobPage.waitForTimeout(3000);
    await expect(bobPage.locator('[data-testid="lsp-status-badge"]')).not.toBeVisible();

    await bobPage.locator('.ide-scrollbar').getByText('b.py').click();
    await bobPage.waitForTimeout(3000);
    await expect(bobPage.locator('[data-testid="lsp-status-badge"]')).not.toBeVisible();

    await bobPage.close();
  });
});
