# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: terminal.spec.ts >> Terminal History & Shell State >> runs split frontend and backend servers simultaneously and serves proxied live preview
- Location: ../testing/e2e/terminal.spec.ts:1373:7

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.xterm')
Expected substring: "Backend listening on port 5000"
Received string:    "llllllllllllllllllllllllllllllll################################sandbox:~# mkdir -p backend frontendsandbox:~# cat << 'EOF' > backend/server.js> > const http = require('http');> const server = http.createServer((req, res) => {>   if (req.url === '/api/s "
Timeout: 10000ms

Call log:
  - Expect "toContainText" with timeout 10000ms
  - waiting for locator('.xterm')
    24 × locator resolved to <div dir="ltr" class="terminal xterm xterm-dom-renderer-owner-1 focus">…</div>
       - unexpected value "llllllllllllllllllllllllllllllll################################sandbox:~# mkdir -p backend frontendsandbox:~# cat << 'EOF' > backend/server.js> > const http = require('http');> const server = http.createServer((req, res) => {>   if (req.url === '/api/s "

```

```yaml
- textbox "Terminal input"
```

# Test source

```ts
  1362 |     // Open a new tab in the same context to fetch the preview URL
  1363 |     const previewPage = await context.newPage();
  1364 |     await previewPage.goto(`${API_URL.replace('/api', '')}/api/workspace/${workspaceId}/preview/?token=${token}`);
  1365 |     
  1366 |     // Assert target contents are served via proxy
  1367 |     await expect(previewPage.locator('h1')).toHaveText('Express Backend Active', { timeout: 15000 });
  1368 |     await expect(previewPage.locator('p')).toContainText('React Mock Frontend Mounted', { timeout: 15000 });
  1369 |     
  1370 |     await previewPage.close();
  1371 |   });
  1372 | 
  1373 |   test('runs split frontend and backend servers simultaneously and serves proxied live preview', async ({ page, context }) => {
  1374 |     const timestamp = Date.now();
  1375 |     const username = `SplitProj_${timestamp}`;
  1376 |     const workspaceTitle = `SplitProj_WS_${timestamp}`;
  1377 | 
  1378 |     // 1. User logs in
  1379 |     await page.goto('/login');
  1380 |     const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
  1381 |     await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
  1382 |     await usernameInput.click();
  1383 |     await usernameInput.fill(username);
  1384 |     
  1385 |     const submitBtn = page.locator('button[type="submit"]');
  1386 |     await expect(submitBtn).toBeEnabled({ timeout: 10000 });
  1387 |     await submitBtn.click();
  1388 |     await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
  1389 | 
  1390 |     // 2. User creates a workspace
  1391 |     await page.fill('input[placeholder="e.g. React-Sandbox"]', workspaceTitle);
  1392 |     await page.click('button:has-text("Create Now")');
  1393 | 
  1394 |     // Wait for redirect to IDE and bootstrap
  1395 |     await expect(page).toHaveURL(/\/ide\/[a-f0-9-]+/);
  1396 |     const ideUrl = page.url();
  1397 |     const workspaceId = ideUrl.split('/ide/')[1].split('/')[0];
  1398 |     await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
  1399 |     await page.waitForSelector('text=Select a file from the explorer to begin.');
  1400 | 
  1401 |     // Locate terminal components
  1402 |     const terminalTextarea = page.locator('.xterm-helper-textarea');
  1403 |     const terminalBody = page.locator('.xterm');
  1404 | 
  1405 |     await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
  1406 |     await page.waitForTimeout(3000);
  1407 | 
  1408 |     // 3. Create backend and frontend directories and scripts
  1409 |     const backendScript = `
  1410 | const http = require('http');
  1411 | const server = http.createServer((req, res) => {
  1412 |   if (req.url === '/api/status') {
  1413 |     res.writeHead(200, { 'Content-Type': 'application/json' });
  1414 |     res.end(JSON.stringify({ status: 'ok', source: 'backend-api' }));
  1415 |   } else {
  1416 |     res.writeHead(404);
  1417 |     res.end();
  1418 |   }
  1419 | });
  1420 | server.listen(5000, () => {
  1421 |   console.log('Backend listening on port 5000');
  1422 | });
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
> 1462 |     await expect(terminalBody).toContainText('Backend listening on port 5000', { timeout: 10000 });
       |                                ^ Error: expect(locator).toContainText(expected) failed
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
  1523 |     await page.keyboard.type('ls -la\n', { delay: 10 });
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
```