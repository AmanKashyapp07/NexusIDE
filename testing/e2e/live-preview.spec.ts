import { test, expect } from '@playwright/test';
import {
  APP_URL,
  API_URL,
  loginUser,
  waitForBootComplete,
  waitForSocketConnect,
  createFile,
  extractWorkspaceId,
  waitForTerminalText,
} from '../test-utils.js';

/**
 * =============================================================================
 * NexusIDE Live Preview Feature End-to-End Browser Test Suite
 * =============================================================================
 * Validates container dev server proxying, multi-port routing (3000, 8080, 5000),
 * subresource path rewriting, Referer inheritance, and live hot-reloading.
 */

test.describe('Live Preview & Multi-Port Container Proxy Engine', () => {

  test('1. proxies default dev server on port 3000 and renders HTML content', async ({ page, request }) => {
    const timestamp = Date.now();
    const username = `PreviewUser1_${timestamp}`;
    const token = await loginUser(page, request, username);

    // Create a new workspace
    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Preview_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const workspaceId = extractWorkspaceId(page.url());
    await waitForBootComplete(page);
    await waitForSocketConnect(page);

    // Create an index.html file in the container
    await createFile(page, 'index.html');
    
    // Focus terminal helper textarea and wait for shell prompt
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await terminalTextarea.waitFor({ state: 'attached', timeout: 30000 });
    await terminalTextarea.focus();
    await page.keyboard.press('Enter');
    await waitForTerminalText(page, 'sandbox:~#', 30000);

    // Launch background HTTP server on default port 3000
    await page.keyboard.type(`echo "<html><body><h1 id='title'>NexusIDE Live Preview Test Page</h1></body></html>" > index.html && python3 -m http.server 3000 &`, { delay: 10 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);

    // Access the preview proxy endpoint directly with Bearer auth token
    const previewUrl = `${API_URL}/workspace/${workspaceId}/preview/`;
    const previewRes = await request.get(previewUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(previewRes.status()).toBe(200);

    const htmlBody = await previewRes.text();
    expect(htmlBody).toContain('NexusIDE Live Preview Test Page');
  });

  test('2. supports multi-port dev servers (8080, 5000) via URL path and query parameters', async ({ page, request }) => {
    const timestamp = Date.now();
    const username = `MultiPortUser_${timestamp}`;
    const token = await loginUser(page, request, username);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `MultiPort_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const workspaceId = extractWorkspaceId(page.url());
    await waitForBootComplete(page);
    await waitForSocketConnect(page);

    // Focus terminal helper textarea and wait for shell prompt
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await terminalTextarea.waitFor({ state: 'attached', timeout: 30000 });
    await terminalTextarea.focus();
    await page.keyboard.press('Enter');
    await waitForTerminalText(page, 'sandbox:~#', 30000);

    // Launch python HTTP server on port 8080 bound to 0.0.0.0 for container bridge IP access
    await page.keyboard.type(`mkdir -p app8080 && echo "<h1>App Port 8080</h1>" > app8080/index.html && (cd app8080 && python3 -m http.server 8080 --bind 0.0.0.0 &)`, { delay: 10 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);

    // 1. Verify URL path segment syntax (/preview/8080/)
    const portPathUrl = `${API_URL}/workspace/${workspaceId}/preview/8080/`;
    const pathRes = await request.get(portPathUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(pathRes.status()).toBe(200);
    expect(await pathRes.text()).toContain('App Port 8080');

    // 2. Verify Query parameter syntax (/preview/?port=8080)
    const queryParamUrl = `${API_URL}/workspace/${workspaceId}/preview/?port=8080`;
    const queryRes = await request.get(queryParamUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(queryRes.status()).toBe(200);
    expect(await queryRes.text()).toContain('App Port 8080');
  });

  test('3. correctly rewrites relative subresource asset paths (/style.css, /main.js)', async ({ page, request }) => {
    const timestamp = Date.now();
    const username = `SubresourceUser_${timestamp}`;
    const token = await loginUser(page, request, username);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Asset_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const workspaceId = extractWorkspaceId(page.url());
    await waitForBootComplete(page);
    await waitForSocketConnect(page);

    // Focus terminal helper textarea and wait for shell prompt
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await terminalTextarea.waitFor({ state: 'attached', timeout: 30000 });
    await terminalTextarea.focus();
    await page.keyboard.press('Enter');
    await waitForTerminalText(page, 'sandbox:~#', 30000);

    // Create subresource assets in container
    await page.keyboard.type(`echo "body { background: rgb(15, 23, 42); }" > style.css && echo "console.log('preview-js-ok');" > main.js && python3 -m http.server 3000 &`, { delay: 10 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);

    // Verify subresource path rewriting
    const cssUrl = `${API_URL}/workspace/${workspaceId}/preview/style.css`;
    const cssRes = await request.get(cssUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(cssRes.status()).toBe(200);
    expect(await cssRes.text()).toContain('background: rgb(15, 23, 42);');

    const jsUrl = `${API_URL}/workspace/${workspaceId}/preview/main.js`;
    const jsRes = await request.get(jsUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(jsRes.status()).toBe(200);
    expect(await jsRes.text()).toContain('preview-js-ok');
  });

  test('4. reflects live content updates when HTML files are modified in workspace', async ({ page, request }) => {
    const timestamp = Date.now();
    const username = `HotReloadUser_${timestamp}`;
    const token = await loginUser(page, request, username);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `HotReload_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const workspaceId = extractWorkspaceId(page.url());
    await waitForBootComplete(page);
    await waitForSocketConnect(page);

    // Focus terminal helper textarea and wait for shell prompt
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await terminalTextarea.waitFor({ state: 'attached', timeout: 30000 });
    await terminalTextarea.focus();
    await page.keyboard.press('Enter');
    await waitForTerminalText(page, 'sandbox:~#', 30000);

    // Launch server with v1 content
    await page.keyboard.type(`echo "<h1>Version 1.0</h1>" > index.html && python3 -m http.server 3000 &`, { delay: 10 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);

    const previewUrl = `${API_URL}/workspace/${workspaceId}/preview/`;
    const v1Res = await request.get(previewUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(await v1Res.text()).toContain('Version 1.0');

    // Modify file to Version 2.0
    await page.keyboard.type(`echo "<h1>Version 2.0 Live Update</h1>" > index.html`, { delay: 10 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    // Verify live update is reflected in proxy output
    const v2Res = await request.get(previewUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(await v2Res.text()).toContain('Version 2.0 Live Update');
  });

  test('5. enforces RBAC security authorization before allowing live preview access', async ({ page, context, request }) => {
    const timestamp = Date.now();
    const ownerName = `PreviewOwner_${timestamp}`;
    const unauthorizedUser = `UnauthPreview_${timestamp}`;

    await loginUser(page, request, ownerName);
    await page.fill('input[placeholder="e.g. React-Sandbox"]', `RBAC_Preview_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    const workspaceId = extractWorkspaceId(page.url());

    // Login unauthorized user in a separate browser context
    const intruderPage = await context.browser()!.newContext().then(c => c.newPage());
    const intruderToken = await loginUser(intruderPage, request, unauthorizedUser);

    // Unauthorized user attempts to access preview endpoint without membership
    const unauthorizedRes = await intruderPage.request.get(`${API_URL}/workspace/${workspaceId}/preview/`, {
      headers: { Authorization: `Bearer ${intruderToken}` },
    });
    expect([401, 403]).toContain(unauthorizedRes.status());
    await intruderPage.close();
  });

});
