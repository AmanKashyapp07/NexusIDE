# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: terminal.spec.ts >> Terminal Multi-File Interconnection & Compilation >> executes a mixed-language pipeline (Bash -> Python -> Node -> C++)
- Location: ../testing/e2e/terminal.spec.ts:1755:7

# Error details

```
Test timeout of 45000ms exceeded.
```

```
Error: locator.focus: Test timeout of 45000ms exceeded.
Call log:
  - waiting for locator('.xterm-helper-textarea')
    - locator resolved to <textarea tabindex="0" autocorrect="off" spellcheck="false" autocapitalize="off" aria-multiline="false" aria-label="Terminal input" class="xterm-helper-textarea"></textarea>

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - banner [ref=e4]:
      - generic [ref=e6] [cursor=pointer]:
        - img [ref=e8]
        - generic [ref=e10]:
          - generic [ref=e11]:
            - generic [ref=e12]: Mixed_WS_1783436465432
            - 'generic "Status: connected" [ref=e13]'
          - generic [ref=e14]: admin workspace
      - generic [ref=e15]:
        - button "Join Voice" [ref=e16]:
          - img [ref=e17]
          - generic [ref=e20]: Join Voice
        - button "MI" [ref=e23]:
          - generic "Jump to MixedLang_1783436465432's cursor" [ref=e25] [cursor=pointer]: MI
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
      - generic [ref=e52]:
        - generic [ref=e53]: Explorer
        - generic [ref=e54]:
          - button "Refresh Explorer" [ref=e55]:
            - img [ref=e56]
          - button "New File" [ref=e61]:
            - img [ref=e62]
          - button "New Folder" [ref=e65]:
            - img [ref=e66]
      - main [ref=e69]:
        - generic [ref=e70]:
          - generic [ref=e72]:
            - img [ref=e73]
            - text: Ready to code
          - generic [ref=e76]:
            - img [ref=e78]
            - paragraph [ref=e82]: Select a file from the explorer to begin.
        - generic [ref=e83]:
          - generic [ref=e84]:
            - generic [ref=e85]:
              - img [ref=e86]
              - generic [ref=e89]: Sandbox
            - generic [ref=e90]:
              - button "Preview" [ref=e91]:
                - img [ref=e92]
                - text: Preview
              - button "Restart" [ref=e95]:
                - img [ref=e96]
                - text: Restart
          - generic [ref=e100]:
            - button "Clear Terminal" [ref=e102]:
              - img [ref=e103]
            - generic [ref=e110]:
              - textbox "Terminal input" [ref=e111]
              - generic:
                - generic:
                  - generic: sandbox
                  - generic: ":"
                  - generic: ~
                  - generic: "#"
  - alert [ref=e112]:
    - img [ref=e114]
    - generic [ref=e117]: Terminal session connected
    - button [ref=e118] [cursor=pointer]:
      - img [ref=e119]
```

# Test source

```ts
  1674 | 
  1675 |     const terminalBody = page.locator('.xterm');
  1676 |     const terminalTextarea = page.locator('.xterm-helper-textarea');
  1677 |     await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
  1678 |     await page.waitForTimeout(3000);
  1679 | 
  1680 |     await terminalTextarea.focus();
  1681 |     
  1682 |     // Create a Python package structure
  1683 |     await page.keyboard.type('mkdir -p my_package/submodule\n', { delay: 10 });
  1684 |     await page.keyboard.type('touch my_package/__init__.py my_package/submodule/__init__.py\n', { delay: 10 });
  1685 | 
  1686 |     const helperCode = `
  1687 | def get_status():
  1688 |     return "PYTHON_IMPORT_SUCCESS"
  1689 | `;
  1690 |     await page.keyboard.type(`cat << 'EOF' > my_package/submodule/helper.py\n${helperCode}\nEOF\n`, { delay: 10 });
  1691 | 
  1692 |     const mainPyCode = `
  1693 | from my_package.submodule.helper import get_status
  1694 | import sys
  1695 | 
  1696 | def main():
  1697 |     print(f"Status: {get_status()}")
  1698 |     print(f"Args: {sys.argv[1] if len(sys.argv) > 1 else 'None'}")
  1699 | 
  1700 | if __name__ == "__main__":
  1701 |     main()
  1702 | `;
  1703 |     await page.keyboard.type(`cat << 'EOF' > main.py\n${mainPyCode}\nEOF\n`, { delay: 10 });
  1704 |     await page.waitForTimeout(1000);
  1705 | 
  1706 |     // Run python module with arguments
  1707 |     await page.keyboard.type('python3 main.py IDE_TESTER\n', { delay: 10 });
  1708 |     
  1709 |     await expect(terminalBody).toContainText('Status: PYTHON_IMPORT_SUCCESS', { timeout: 5000 });
  1710 |     await expect(terminalBody).toContainText('Args: IDE_TESTER', { timeout: 5000 });
  1711 |   });
  1712 | 
  1713 |   test('resolves Node.js ESM and CommonJS interop and deeply nested requires', async ({ page }) => {
  1714 |     const timestamp = Date.now();
  1715 |     await page.goto('/login');
  1716 |     const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
  1717 |     await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
  1718 |     await usernameInput.click();
  1719 |     await usernameInput.fill(`NodeMulti_${timestamp}`);
  1720 |     await page.locator('button[type="submit"]').click();
  1721 |     await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
  1722 | 
  1723 |     await page.fill('input[placeholder="e.g. React-Sandbox"]', `Node_WS_${timestamp}`);
  1724 |     await page.click('button:has-text("Create Now")');
  1725 |     await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
  1726 | 
  1727 |     const terminalBody = page.locator('.xterm');
  1728 |     const terminalTextarea = page.locator('.xterm-helper-textarea');
  1729 |     await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
  1730 |     await page.waitForTimeout(3000);
  1731 | 
  1732 |     await terminalTextarea.focus();
  1733 | 
  1734 |     // 1. Test CommonJS
  1735 |     const cjsModule = `module.exports = { secret: 'CJS_MODULE_LOADED' };`;
  1736 |     await page.keyboard.type(`cat << 'EOF' > lib.cjs\n${cjsModule}\nEOF\n`, { delay: 10 });
  1737 |     
  1738 |     const cjsMain = `const lib = require('./lib.cjs'); console.log(lib.secret);`;
  1739 |     await page.keyboard.type(`cat << 'EOF' > main.cjs\n${cjsMain}\nEOF\n`, { delay: 10 });
  1740 |     
  1741 |     await page.keyboard.type('node main.cjs\n', { delay: 10 });
  1742 |     await expect(terminalBody).toContainText('CJS_MODULE_LOADED', { timeout: 5000 });
  1743 | 
  1744 |     // 2. Test ES Modules (MJS)
  1745 |     const esmModule = `export const calculate = (n) => n * 3;`;
  1746 |     await page.keyboard.type(`cat << 'EOF' > math.mjs\n${esmModule}\nEOF\n`, { delay: 10 });
  1747 | 
  1748 |     const esmMain = `import { calculate } from './math.mjs'; console.log('ESM_RESULT_' + calculate(5));`;
  1749 |     await page.keyboard.type(`cat << 'EOF' > app.mjs\n${esmMain}\nEOF\n`, { delay: 10 });
  1750 | 
  1751 |     await page.keyboard.type('node app.mjs\n', { delay: 10 });
  1752 |     await expect(terminalBody).toContainText('ESM_RESULT_15', { timeout: 5000 });
  1753 |   });
  1754 | 
  1755 |   test('executes a mixed-language pipeline (Bash -> Python -> Node -> C++)', async ({ page }) => {
  1756 |     const timestamp = Date.now();
  1757 |     await page.goto('/login');
  1758 |     const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
  1759 |     await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
  1760 |     await usernameInput.click();
  1761 |     await usernameInput.fill(`MixedLang_${timestamp}`);
  1762 |     await page.locator('button[type="submit"]').click();
  1763 |     await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
  1764 | 
  1765 |     await page.fill('input[placeholder="e.g. React-Sandbox"]', `Mixed_WS_${timestamp}`);
  1766 |     await page.click('button:has-text("Create Now")');
  1767 |     await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
  1768 | 
  1769 |     const terminalBody = page.locator('.xterm');
  1770 |     const terminalTextarea = page.locator('.xterm-helper-textarea');
  1771 |     await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
  1772 |     await page.waitForTimeout(3000);
  1773 | 
> 1774 |     await terminalTextarea.focus();
       |                            ^ Error: locator.focus: Test timeout of 45000ms exceeded.
  1775 | 
  1776 |     // 1. Python script: Reads stdin, multiplies by 2
  1777 |     const pyScript = `import sys\nprint(int(sys.stdin.read().strip()) * 2)`;
  1778 |     await page.keyboard.type(`cat << 'EOF' > step1.py\n${pyScript}\nEOF\n`, { delay: 10 });
  1779 | 
  1780 |     // 2. Node script: Reads stdin, adds 10
  1781 |     const nodeScript = `const fs = require('fs'); const input = parseInt(fs.readFileSync(0, 'utf-8').trim()); console.log(input + 10);`;
  1782 |     await page.keyboard.type(`cat << 'EOF' > step2.js\n${nodeScript}\nEOF\n`, { delay: 10 });
  1783 | 
  1784 |     // 3. C++ program: Takes argv, prints final formatted string
  1785 |     const cppScript = `
  1786 | #include <iostream>
  1787 | #include <cstdlib>
  1788 | int main(int argc, char** argv) {
  1789 |     if(argc > 1) std::cout << "PIPELINE_FINAL:" << argv[1] << std::endl;
  1790 |     return 0;
  1791 | }
  1792 | `;
  1793 |     await page.keyboard.type(`cat << 'EOF' > step3.cpp\n${cppScript}\nEOF\n`, { delay: 10 });
  1794 |     await page.keyboard.type('g++ step3.cpp -o step3_bin\n', { delay: 10 });
  1795 |     await expect(terminalBody).toContainText('step3_bin', { timeout: 15000 });
  1796 | 
  1797 |     // 4. Bash pipeline chaining them all together:
  1798 |     // Input 5 -> Python(5*2=10) -> Node(10+10=20) -> C++(PIPELINE_FINAL:20)
  1799 |     await page.keyboard.type('result=$(echo "5" | python3 step1.py | node step2.js)\n', { delay: 10 });
  1800 |     await page.keyboard.type('./step3_bin $result\n', { delay: 10 });
  1801 | 
  1802 |     await expect(terminalBody).toContainText('PIPELINE_FINAL:20', { timeout: 10000 });
  1803 |   });
  1804 | 
  1805 | });
  1806 | 
  1807 | test.describe('Terminal Advanced File System Edge Cases', () => {
  1808 | 
  1809 |   
  1810 | 
  1811 |   test('handles large file operations, binary downloads, and permission modifications (chmod)', async ({ page }) => {
  1812 |     const timestamp = Date.now();
  1813 |     await page.goto('/login');
  1814 |     const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
  1815 |     await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
  1816 |     await usernameInput.click();
  1817 |     await usernameInput.fill(`Perms_${timestamp}`);
  1818 |     await page.locator('button[type="submit"]').click();
  1819 |     await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
  1820 | 
  1821 |     await page.fill('input[placeholder="e.g. React-Sandbox"]', `Perms_WS_${timestamp}`);
  1822 |     await page.click('button:has-text("Create Now")');
  1823 |     await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
  1824 | 
  1825 |     const terminalBody = page.locator('.xterm');
  1826 |     const terminalTextarea = page.locator('.xterm-helper-textarea');
  1827 |     await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
  1828 |     await page.waitForTimeout(3000);
  1829 | 
  1830 |     await terminalTextarea.focus();
  1831 | 
  1832 |     // 1. Download a file using curl (simulating fetching a binary/script)
  1833 |     await page.keyboard.type('curl -s https://raw.githubusercontent.com/torvalds/linux/master/README > linux_readme.txt\n', { delay: 10 });
  1834 |     
  1835 |     // Validate the file has substantial line count
  1836 |     await page.keyboard.type('wc -l linux_readme.txt\n', { delay: 10 });
  1837 |     await expect(terminalBody).toContainText(/[1-9][0-9]+ linux_readme\.txt/, { timeout: 10000 });
  1838 | 
  1839 |     // 2. Write a shell script, make it executable, and run it
  1840 |     const bashScript = `#!/bin/bash\necho "EXECUTION_GRANTED_OK"`;
  1841 |     await page.keyboard.type(`cat << 'EOF' > runner.sh\n${bashScript}\nEOF\n`, { delay: 10 });
  1842 |     
  1843 |     // Try running without permissions (should fail)
  1844 |     await page.keyboard.type('./runner.sh\n', { delay: 10 });
  1845 |     await expect(terminalBody).toContainText(/Permission denied|not found/, { timeout: 5000 });
  1846 | 
  1847 |     // Add execution rights
  1848 |     await page.keyboard.type('chmod +x runner.sh\n', { delay: 10 });
  1849 |     
  1850 |     // Run successfully
  1851 |     await page.keyboard.type('./runner.sh\n', { delay: 10 });
  1852 |     await expect(terminalBody).toContainText('EXECUTION_GRANTED_OK', { timeout: 5000 });
  1853 |   });
  1854 | 
  1855 | });
  1856 | 
  1857 | 
```