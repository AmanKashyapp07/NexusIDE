# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: terminal.spec.ts >> Terminal History & Shell State >> runs standard Node React Express server replica and serves live preview
- Location: ../testing/e2e/terminal.spec.ts:1316:7

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator:  locator('h1')
Expected: "Express Backend Active"
Received: "Preview Server Offline"
Timeout:  15000ms

Call log:
  - Expect "toHaveText" with timeout 15000ms
  - waiting for locator('h1')
    34 × locator resolved to <h1>Preview Server Offline</h1>
       - unexpected value "Preview Server Offline"

```

```yaml
- heading "Preview Server Offline" [level=1]
```

# Test source

```ts
  1291 |     await page.keyboard.type('alias ll="ls -la"', { delay: 10 });
  1292 |     await page.keyboard.press('Enter');
  1293 |     await page.keyboard.type('ll', { delay: 10 });
  1294 |     await page.keyboard.press('Enter');
  1295 |     // Should show directory listing (not "command not found")
  1296 |     await expect(terminalBody).toContainText(/total|drwx/i, { timeout: 5000 });
  1297 | 
  1298 |     // Verify shell variables persist
  1299 |     await page.keyboard.type('MY_VAR="PERSISTENT_VALUE"', { delay: 10 });
  1300 |     await page.keyboard.press('Enter');
  1301 |     await page.keyboard.type('echo "CHECK:$MY_VAR"', { delay: 10 });
  1302 |     await page.keyboard.press('Enter');
  1303 |     await expect(terminalBody).toContainText('CHECK:PERSISTENT_VALUE', { timeout: 5000 });
  1304 | 
  1305 |     // Test bash history expansion (!!)
  1306 |     await page.keyboard.type('echo "LAST_COMMAND_TEST"', { delay: 10 });
  1307 |     await page.keyboard.press('Enter');
  1308 |     await page.keyboard.type('!!', { delay: 10 });
  1309 |     await page.keyboard.press('Enter');
  1310 |     // !! should repeat the last command
  1311 |     await page.waitForTimeout(1000);
  1312 |     // Both outputs should be visible — just verify the original worked
  1313 |     await expect(terminalBody).toContainText('LAST_COMMAND_TEST', { timeout: 5000 });
  1314 |   });
  1315 | 
  1316 |   test('runs standard Node React Express server replica and serves live preview', async ({ page, context }) => {
  1317 |     const timestamp = Date.now();
  1318 |     const username = `FullProj_${timestamp}`;
  1319 |     const workspaceTitle = `FullProj_WS_${timestamp}`;
  1320 | 
  1321 |     // 1. User logs in
  1322 |     await page.goto('/login');
  1323 |     const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
  1324 |     await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
  1325 |     await usernameInput.click();
  1326 |     await usernameInput.fill(username);
  1327 |     
  1328 |     const submitBtn = page.locator('button[type="submit"]');
  1329 |     await expect(submitBtn).toBeEnabled({ timeout: 10000 });
  1330 |     await submitBtn.click();
  1331 |     await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
  1332 | 
  1333 |     // 2. User creates a workspace
  1334 |     await page.fill('input[placeholder="e.g. React-Sandbox"]', workspaceTitle);
  1335 |     await page.click('button:has-text("Create Now")');
  1336 | 
  1337 |     // Wait for redirect to IDE and bootstrap
  1338 |     await expect(page).toHaveURL(/\/ide\/[a-f0-9-]+/);
  1339 |     const ideUrl = page.url();
  1340 |     const workspaceId = ideUrl.split('/ide/')[1].split('/')[0];
  1341 |     await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
  1342 |     await page.waitForSelector('text=Select a file from the explorer to begin.');
  1343 | 
  1344 |     // Locate terminal components
  1345 |     const terminalTextarea = page.locator('.xterm-helper-textarea');
  1346 |     const terminalBody = page.locator('.xterm');
  1347 | 
  1348 |     await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
  1349 |     await page.waitForTimeout(3000);
  1350 | 
  1351 |     // 3. Write a mock React/Express server script listening on port 3000
  1352 |     const serverScript = `
  1353 | const http = require('http');
  1354 | const server = http.createServer((req, res) => {
  1355 |   res.writeHead(200, { 'Content-Type': 'text/html' });
  1356 |   res.end('<h1>Express Backend Active</h1><p>React Mock Frontend Mounted</p>');
  1357 | });
  1358 | server.listen(3000, () => {
  1359 |   console.log('Server listening on port 3000');
  1360 | });
  1361 | `;
  1362 | 
  1363 |     // Create app.js file via terminal using node -e with escaped content
  1364 |     // Avoids heredoc quoting issues with single quotes in the server script
  1365 |     await terminalTextarea.focus();
  1366 |     const appJsContent = [
  1367 |       "const http = require('http');",
  1368 |       "const server = http.createServer((req, res) => {",
  1369 |       "  res.writeHead(200, { 'Content-Type': 'text/html' });",
  1370 |       "  res.end('<h1>Express Backend Active</h1><p>React Mock Frontend Mounted</p>');",
  1371 |       "});",
  1372 |       "server.listen(3000, () => { console.log('Server listening on port 3000'); });"
  1373 |     ].join('\\n');
  1374 |     await page.keyboard.type(`node -e "const fs=require('fs');fs.writeFileSync('app.js','${appJsContent}')"\n`, { delay: 10 });
  1375 |     await page.waitForTimeout(1500);
  1376 | 
  1377 |     // 4. Start the server in the background
  1378 |     await page.keyboard.type('node app.js &\n', { delay: 10 });
  1379 |     await expect(terminalBody).toContainText('Server listening on port 3000', { timeout: 10000 });
  1380 |     // Give the server a moment to fully bind the port before proxying
  1381 |     await page.waitForTimeout(1000);
  1382 | 
  1383 |     // 5. Query and open the live preview
  1384 |     const token = await page.evaluate(() => localStorage.getItem('token') || '');
  1385 |     
  1386 |     // Open a new tab in the same context to fetch the preview URL
  1387 |     const previewPage = await context.newPage();
  1388 |     await previewPage.goto(`http://localhost:4000/api/workspace/${workspaceId}/preview/?token=${token}`);
  1389 |     
  1390 |     // Assert target contents are served via proxy
> 1391 |     await expect(previewPage.locator('h1')).toHaveText('Express Backend Active', { timeout: 15000 });
       |                                             ^ Error: expect(locator).toHaveText(expected) failed
  1392 |     await expect(previewPage.locator('p')).toContainText('React Mock Frontend Mounted', { timeout: 15000 });
  1393 |     
  1394 |     await previewPage.close();
  1395 |   });
  1396 | 
  1397 |   test('runs split frontend and backend servers simultaneously and serves proxied live preview', async ({ page, context }) => {
  1398 |     const timestamp = Date.now();
  1399 |     const username = `SplitProj_${timestamp}`;
  1400 |     const workspaceTitle = `SplitProj_WS_${timestamp}`;
  1401 | 
  1402 |     // 1. User logs in
  1403 |     await page.goto('/login');
  1404 |     const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
  1405 |     await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
  1406 |     await usernameInput.click();
  1407 |     await usernameInput.fill(username);
  1408 |     
  1409 |     const submitBtn = page.locator('button[type="submit"]');
  1410 |     await expect(submitBtn).toBeEnabled({ timeout: 10000 });
  1411 |     await submitBtn.click();
  1412 |     await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
  1413 | 
  1414 |     // 2. User creates a workspace
  1415 |     await page.fill('input[placeholder="e.g. React-Sandbox"]', workspaceTitle);
  1416 |     await page.click('button:has-text("Create Now")');
  1417 | 
  1418 |     // Wait for redirect to IDE and bootstrap
  1419 |     await expect(page).toHaveURL(/\/ide\/[a-f0-9-]+/);
  1420 |     const ideUrl = page.url();
  1421 |     const workspaceId = ideUrl.split('/ide/')[1].split('/')[0];
  1422 |     await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
  1423 |     await page.waitForSelector('text=Select a file from the explorer to begin.');
  1424 | 
  1425 |     // Locate terminal components
  1426 |     const terminalTextarea = page.locator('.xterm-helper-textarea');
  1427 |     const terminalBody = page.locator('.xterm');
  1428 | 
  1429 |     await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
  1430 |     await page.waitForTimeout(3000);
  1431 | 
  1432 |     // 3. Create backend and frontend directories and scripts
  1433 |     const backendScript = `
  1434 | const http = require('http');
  1435 | const server = http.createServer((req, res) => {
  1436 |   if (req.url === '/api/status') {
  1437 |     res.writeHead(200, { 'Content-Type': 'application/json' });
  1438 |     res.end(JSON.stringify({ status: 'ok', source: 'backend-api' }));
  1439 |   } else {
  1440 |     res.writeHead(404);
  1441 |     res.end();
  1442 |   }
  1443 | });
  1444 | server.listen(5000, () => {
  1445 |   console.log('Backend listening on port 5000');
  1446 | });
  1447 | `;
  1448 | 
  1449 |     const frontendScript = `
  1450 | const http = require('http');
  1451 | const server = http.createServer((req, res) => {
  1452 |   if (req.url.startsWith('/api')) {
  1453 |     const proxyReq = http.request({
  1454 |       host: 'localhost',
  1455 |       port: 5000,
  1456 |       path: req.url,
  1457 |       method: req.method,
  1458 |       headers: req.headers
  1459 |     }, (proxyRes) => {
  1460 |       res.writeHead(proxyRes.statusCode, proxyRes.headers);
  1461 |       proxyRes.pipe(res);
  1462 |     });
  1463 |     req.pipe(proxyReq);
  1464 |   } else {
  1465 |     res.writeHead(200, { 'Content-Type': 'text/html' });
  1466 |     res.end('<!DOCTYPE html><html><body><h1>React Frontend</h1><div id=\\"status\\">Connecting to API...</div><script>fetch(\\"/api/status\\").then(r => r.json()).then(data => { document.getElementById(\\"status\\").innerText = \\"Connected to: \\" + data.source; }).catch(err => { document.getElementById(\\"status\\").innerText = \\"Error: \\" + err.message; });</script></body></html>');
  1467 |   }
  1468 | });
  1469 | server.listen(3000, () => {
  1470 |   console.log('Frontend dev server listening on port 3000');
  1471 | });
  1472 | `;
  1473 | 
  1474 |     await terminalTextarea.focus();
  1475 |     await page.keyboard.type('mkdir -p backend frontend\n', { delay: 10 });
  1476 |     await page.waitForTimeout(500);
  1477 | 
  1478 |     // Write scripts
  1479 |     await page.keyboard.type(`cat << 'EOF' > backend/server.js\n${backendScript}\nEOF\n`, { delay: 10 });
  1480 |     await page.waitForTimeout(1000);
  1481 |     await page.keyboard.type(`cat << 'EOF' > frontend/dev-server.js\n${frontendScript}\nEOF\n`, { delay: 10 });
  1482 |     await page.waitForTimeout(1000);
  1483 | 
  1484 |     // 4. Run both backend and frontend servers in background
  1485 |     await page.keyboard.type('node backend/server.js &\n', { delay: 10 });
  1486 |     await expect(terminalBody).toContainText('Backend listening on port 5000', { timeout: 10000 });
  1487 | 
  1488 |     await page.keyboard.type('node frontend/dev-server.js &\n', { delay: 10 });
  1489 |     await expect(terminalBody).toContainText('Frontend dev server listening on port 3000', { timeout: 10000 });
  1490 | 
  1491 |     // 5. Query and open live preview from backend port 4000
```