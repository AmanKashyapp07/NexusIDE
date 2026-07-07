# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: terminal.spec.ts >> Terminal History & Shell State >> admin clones repo, commits, leaves, returns and makes new changes with correct git status
- Location: ../testing/e2e/terminal.spec.ts:1480:7

# Error details

```
Test timeout of 45000ms exceeded.
```

```
Error: keyboard.type: Test timeout of 45000ms exceeded.
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
            - generic [ref=e12]: GitFlow_WS_1783436363106
            - 'generic "Status: connected" [ref=e13]'
          - generic [ref=e14]: admin workspace
      - generic [ref=e15]:
        - button "Join Voice" [ref=e16]:
          - img [ref=e17]
          - generic [ref=e20]: Join Voice
        - button "GI" [ref=e23]:
          - generic "Jump to GitFlow_1783436363106's cursor" [ref=e25] [cursor=pointer]: GI
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
          - generic [ref=e71]:
            - button [ref=e72]:
              - img [ref=e73]
            - img [ref=e75]
            - generic [ref=e77]: github-test-ci
          - generic [ref=e78]:
            - button "New File" [ref=e79]:
              - img [ref=e80]
            - button "New Folder" [ref=e83]:
              - img [ref=e84]
            - button "Delete Folder" [ref=e86]:
              - img [ref=e87]
      - main [ref=e90]:
        - generic [ref=e91]:
          - generic [ref=e93]:
            - generic [ref=e94]:
              - generic [ref=e95]:
                - generic [ref=e96] [cursor=pointer]:
                  - img [ref=e97]
                  - generic [ref=e99]: github-test-ci
                - img [ref=e100]
              - generic [ref=e103]:
                - img [ref=e104]
                - generic [ref=e107]: aman.js
            - button "Timelapse" [ref=e108]:
              - img [ref=e109]
              - text: Timelapse
          - generic [ref=e116]:
            - code [ref=e119]:
              - generic [ref=e120]:
                - textbox "Editor content" [ref=e121]
                - textbox [ref=e122]
                - generic [ref=e127]: "1"
            - button "Blame" [ref=e134]:
              - img [ref=e135]
              - text: Blame
            - generic [ref=e137]: LSP
        - generic [ref=e139]:
          - generic [ref=e140]:
            - generic [ref=e141]:
              - img [ref=e142]
              - generic [ref=e145]: Sandbox
            - generic [ref=e146]:
              - button "Preview" [ref=e147]:
                - img [ref=e148]
                - text: Preview
              - button "Restart" [ref=e151]:
                - img [ref=e152]
                - text: Restart
          - generic [ref=e156]:
            - button "Clear Terminal" [ref=e158]:
              - img [ref=e159]
            - generic [ref=e166]:
              - textbox "Terminal input" [active] [ref=e167]
              - generic:
                - generic:
                  - generic: "remote: Compressing objects: 27% (5"
                - generic:
                  - generic: "remote: Compressing objects: 33% (6"
                - generic:
                  - generic: "remote: Compressing objects: 38% (7"
                - generic:
                  - generic: "remote: Compressing objects: 44% (8"
                - generic:
                  - generic: "remote: Compressing objects: 50% (9"
                - generic:
                  - generic: "remote: Compressing objects: 55% (1"
                - generic:
                  - generic: "remote: Compressing objects: 61% (1"
                - generic:
                  - generic: "remote: Compressing objects: 66% (1"
                - generic:
                  - generic: "remote: Compressing objects: 72% (1"
                - generic:
                  - generic: "remote: Compressing objects: 77% (1"
                - generic:
                  - generic: "remote: Compressing objects: 83% (1"
                - generic:
                  - generic: "remote: Compressing objects: 88% (1"
                - generic:
                  - generic: "remote: Compressing objects: 94% (1"
                - generic:
                  - generic: "remote: Compressing objects: 100% (1"
                - generic:
                  - generic: "remote: Compressing objects: 100% (1"
                - generic:
                  - generic: 8/18), done.
                - generic:
                  - generic: "remote: Total 163 (delta 11), reused"
                - generic:
                  - generic: 21 (delta 6), pack-reused 137 (from
                - generic:
                  - generic: 1)
                - generic:
                  - generic: "Receiving objects: 100% (163/163), 5"
                - generic:
                  - generic: 1.48 KiB | 1.51 MiB/s, done.
                - generic:
                  - generic: "Resolving deltas: 100% (65/65), done"
                - generic:
                  - generic: .
                - generic:
                  - generic: sandbox
                  - generic: ":"
                  - generic: ~
                  - generic: "#"
  - generic [ref=e170]:
    - alert
    - alert
```

# Test source

```ts
  1423 | `;
  1424 | 
  1425 |     const frontendScript = `
  1426 | const http = require('http');
  1427 | const server = http.createServer((req, res) => {
  1428 |   if (req.url.startsWith('/api')) {
  1429 |     const proxyReq = http.request({
  1430 |       host: 'localhost',
  1431 |       port: 5000,
  1432 |       path: req.url,
  1433 |       method: req.method,
  1434 |       headers: req.headers
  1435 |     }, (proxyRes) => {
  1436 |       res.writeHead(proxyRes.statusCode, proxyRes.headers);
  1437 |       proxyRes.pipe(res);
  1438 |     });
  1439 |     req.pipe(proxyReq);
  1440 |   } else {
  1441 |     res.writeHead(200, { 'Content-Type': 'text/html' });
  1442 |     res.end('<!DOCTYPE html><html><body><h1>React Frontend</h1><div id=\\"status\\">Connecting to API...</div><script>fetch(\\"/api/status\\").then(r => r.json()).then(data => { document.getElementById(\\"status\\").innerText = \\"Connected to: \\" + data.source; }).catch(err => { document.getElementById(\\"status\\").innerText = \\"Error: \\" + err.message; });</script></body></html>');
  1443 |   }
  1444 | });
  1445 | server.listen(3000, () => {
  1446 |   console.log('Frontend dev server listening on port 3000');
  1447 | });
  1448 | `;
  1449 | 
  1450 |     await terminalTextarea.focus();
  1451 |     await page.keyboard.type('mkdir -p backend frontend\n', { delay: 10 });
  1452 |     await page.waitForTimeout(500);
  1453 | 
  1454 |     // Write scripts
  1455 |     await page.keyboard.type(`cat << 'EOF' > backend/server.js\n${backendScript}\nEOF\n`, { delay: 10 });
  1456 |     await page.waitForTimeout(1000);
  1457 |     await page.keyboard.type(`cat << 'EOF' > frontend/dev-server.js\n${frontendScript}\nEOF\n`, { delay: 10 });
  1458 |     await page.waitForTimeout(1000);
  1459 | 
  1460 |     // 4. Run both backend and frontend servers in background
  1461 |     await page.keyboard.type('node backend/server.js &\n', { delay: 10 });
  1462 |     await expect(terminalBody).toContainText('Backend listening on port 5000', { timeout: 10000 });
  1463 | 
  1464 |     await page.keyboard.type('node frontend/dev-server.js &\n', { delay: 10 });
  1465 |     await expect(terminalBody).toContainText('Frontend dev server listening on port 3000', { timeout: 10000 });
  1466 | 
  1467 |     // 5. Query and open live preview from backend port 4000
  1468 |     const token = await page.evaluate(() => localStorage.getItem('token') || '');
  1469 |     const previewPage = await context.newPage();
  1470 |     await previewPage.goto(`${API_URL.replace('/api', '')}/api/workspace/${workspaceId}/preview/?token=${token}`);
  1471 | 
  1472 |     // Verify HTML content from frontend dev server
  1473 |     await expect(previewPage.locator('h1')).toHaveText('React Frontend', { timeout: 15000 });
  1474 |     // Verify client-side JS successfully fetched backend status through proxy
  1475 |     await expect(previewPage.locator('#status')).toHaveText('Connected to: backend-api', { timeout: 15000 });
  1476 | 
  1477 |     await previewPage.close();
  1478 |   });
  1479 | 
  1480 |   test('admin clones repo, commits, leaves, returns and makes new changes with correct git status', async ({ page }) => {
  1481 |     const timestamp = Date.now();
  1482 |     const username = `GitFlow_${timestamp}`;
  1483 |     const workspaceTitle = `GitFlow_WS_${timestamp}`;
  1484 | 
  1485 |     // 1. User logs in
  1486 |     await page.goto('/login');
  1487 |     const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
  1488 |     await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
  1489 |     await usernameInput.click();
  1490 |     await usernameInput.fill(username);
  1491 |     
  1492 |     const submitBtn = page.locator('button[type="submit"]');
  1493 |     await expect(submitBtn).toBeEnabled({ timeout: 10000 });
  1494 |     await submitBtn.click();
  1495 |     await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
  1496 | 
  1497 |     // 2. User creates a workspace
  1498 |     await page.fill('input[placeholder="e.g. React-Sandbox"]', workspaceTitle);
  1499 |     await page.click('button:has-text("Create Now")');
  1500 | 
  1501 |     // Wait for redirect to IDE and bootstrap
  1502 |     await expect(page).toHaveURL(/\/ide\/[a-f0-9-]+/);
  1503 |     const ideUrl = page.url();
  1504 |     const workspaceId = ideUrl.split('/ide/')[1].split('/')[0];
  1505 |     await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
  1506 |     await page.waitForSelector('text=Select a file from the explorer to begin.');
  1507 | 
  1508 |     // Locate terminal components
  1509 |     const terminalTextarea = page.locator('.xterm-helper-textarea');
  1510 |     const terminalBody = page.locator('.xterm');
  1511 | 
  1512 |     await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
  1513 |     await page.waitForTimeout(3000);
  1514 | 
  1515 |     // Set up git user configurations to prevent git commit prompt errors
  1516 |     await terminalTextarea.focus();
  1517 |     await page.keyboard.type('git config --global user.email "test@example.com" && git config --global user.name "Tester"\n', { delay: 10 });
  1518 |     await page.waitForTimeout(500);
  1519 | 
  1520 |     // 3. Clone the repo
  1521 |     await page.keyboard.type('git clone https://github.com/AmanKashyapp07/github-test-ci.git\n', { delay: 10 });
  1522 |     await page.waitForTimeout(8000); // Allow sufficient time for the git clone download to finish
> 1523 |     await page.keyboard.type('ls -la\n', { delay: 10 });
       |                         ^ Error: keyboard.type: Test timeout of 45000ms exceeded.
  1524 |     await expect(terminalBody).toContainText('github-test-ci', { timeout: 10000 });
  1525 | 
  1526 |     // 4. Navigate, make first edit and commit
  1527 |     await page.keyboard.type('cd github-test-ci && echo "first_edit" >> README.md && git add README.md && git commit -m "first commit"\n', { delay: 10 });
  1528 |     await page.waitForTimeout(1500);
  1529 | 
  1530 |     // Verify git status shows clean tree
  1531 |     await page.keyboard.type('git status\n', { delay: 10 });
  1532 |     await expect(terminalBody).toContainText('nothing to commit, working tree clean', { timeout: 5000 });
  1533 | 
  1534 |     // 5. Leave the workspace (navigate to dashboard)
  1535 |     await page.goto('/dashboard');
  1536 |     await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
  1537 | 
  1538 |     // 6. Come back to the workspace IDE
  1539 |     await page.goto(ideUrl);
  1540 |     await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
  1541 | 
  1542 |     // Locate new terminal instances
  1543 |     const terminalTextarea2 = page.locator('.xterm-helper-textarea');
  1544 |     const terminalBody2 = page.locator('.xterm');
  1545 |     await expect(terminalBody2).toContainText('sandbox:~#', { timeout: 25000 });
  1546 |     await page.waitForTimeout(3000);
  1547 | 
  1548 |     // 7. Navigate back to the repo, make second edit, and run git status
  1549 |     await terminalTextarea2.focus();
  1550 |     await page.keyboard.type('cd github-test-ci && echo "second_edit" >> README.md && git status\n', { delay: 10 });
  1551 |     await expect(terminalBody2).toContainText('modified:   README.md', { timeout: 10000 });
  1552 |   });
  1553 | 
  1554 |   test('blocks git commands when admin is not signed in via GitHub (test account)', async ({ page }) => {
  1555 |     const timestamp = Date.now();
  1556 |     const username = `NoGit_${timestamp}`;
  1557 |     const workspaceTitle = `NoGit_WS_${timestamp}`;
  1558 | 
  1559 |     // 1. User logs in (ordinary username/password flow, no GitHub link)
  1560 |     await page.goto('/login');
  1561 |     const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
  1562 |     await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
  1563 |     await usernameInput.click();
  1564 |     await usernameInput.fill(username);
  1565 |     
  1566 |     const submitBtn = page.locator('button[type="submit"]');
  1567 |     await expect(submitBtn).toBeEnabled({ timeout: 10000 });
  1568 |     await submitBtn.click();
  1569 |     await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
  1570 | 
  1571 |     // 2. User creates a workspace
  1572 |     await page.fill('input[placeholder="e.g. React-Sandbox"]', workspaceTitle);
  1573 |     await page.click('button:has-text("Create Now")');
  1574 | 
  1575 |     // Wait for redirect to IDE and bootstrap
  1576 |     await expect(page).toHaveURL(/\/ide\/[a-f0-9-]+/);
  1577 |     await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
  1578 |     await page.waitForSelector('text=Select a file from the explorer to begin.');
  1579 | 
  1580 |     // Locate terminal components
  1581 |     const terminalTextarea = page.locator('.xterm-helper-textarea');
  1582 |     const terminalBody = page.locator('.xterm');
  1583 | 
  1584 |     await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
  1585 |     await page.waitForTimeout(3000);
  1586 | 
  1587 |     // 3. Try to execute a git command (should print blocker error)
  1588 |     await terminalTextarea.focus();
  1589 |     await page.keyboard.type('git status\n', { delay: 10 });
  1590 |     
  1591 |     // Expect blocker error message
  1592 |     await expect(terminalBody).toContainText('Error: Git commands are only available when signed in with a GitHub account.', { timeout: 10000 });
  1593 |   });
  1594 | 
  1595 | });
  1596 | 
  1597 | test.describe('Terminal Multi-File Interconnection & Compilation', () => {
  1598 | 
  1599 |   test('compiles and executes multi-file C++ project with headers and implementations', async ({ page }) => {
  1600 |     const timestamp = Date.now();
  1601 |     await page.goto('/login');
  1602 |     const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
  1603 |     await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
  1604 |     await usernameInput.click();
  1605 |     await usernameInput.fill(`CppMulti_${timestamp}`);
  1606 |     await page.locator('button[type="submit"]').click();
  1607 |     await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
  1608 | 
  1609 |     await page.fill('input[placeholder="e.g. React-Sandbox"]', `Cpp_WS_${timestamp}`);
  1610 |     await page.click('button:has-text("Create Now")');
  1611 |     await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
  1612 | 
  1613 |     const terminalBody = page.locator('.xterm');
  1614 |     const terminalTextarea = page.locator('.xterm-helper-textarea');
  1615 |     await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
  1616 |     await page.waitForTimeout(3000);
  1617 | 
  1618 |     await terminalTextarea.focus();
  1619 |     await page.keyboard.type('mkdir cpp_project && cd cpp_project\n', { delay: 10 });
  1620 | 
  1621 |     // Create Header File
  1622 |     const headerCode = `
  1623 | #ifndef MATH_UTILS_H
```