# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: terminal.spec.ts >> Terminal Advanced File System Edge Cases >> handles symlinks correctly in terminal and watcher avoids recursive crash
- Location: ../testing/e2e/terminal.spec.ts:1830:7

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.monaco-editor')
Expected substring: "MODIFIED_VIA_LINK"
Received string:    "12ORIGINAL_DATA"
Timeout: 10000ms

Call log:
  - Expect "toContainText" with timeout 10000ms
  - waiting for locator('.monaco-editor')
    - locator resolved to <div role="code" data-uri="file:///fake_file.txt" class="monaco-editor no-user-select  showUnused showDeprecated vs-dark">…</div>
    - unexpected value "12ORIGINAL_DATA"
    - locator resolved to <div role="code" data-uri="file:///real_file.txt" class="monaco-editor no-user-select  showUnused showDeprecated vs-dark">…</div>
    - unexpected value ""
    2 × locator resolved to <div role="code" data-uri="file:///real_file.txt" class="monaco-editor no-user-select  showUnused showDeprecated vs-dark">…</div>
      - unexpected value "1"
    20 × locator resolved to <div role="code" data-uri="file:///real_file.txt" class="monaco-editor no-user-select  showUnused showDeprecated vs-dark">…</div>
       - unexpected value "12ORIGINAL_DATA"

```

```yaml
- code:
  - textbox "Editor content"
```

# Test source

```ts
  1770 |     await page.keyboard.type(`cat << 'EOF' > app.mjs\n${esmMain}\nEOF\n`, { delay: 10 });
  1771 | 
  1772 |     await page.keyboard.type('node app.mjs\n', { delay: 10 });
  1773 |     await expect(terminalBody).toContainText('ESM_RESULT_15', { timeout: 5000 });
  1774 |   });
  1775 | 
  1776 |   test('executes a mixed-language pipeline (Bash -> Python -> Node -> C++)', async ({ page }) => {
  1777 |     const timestamp = Date.now();
  1778 |     await page.goto('/login');
  1779 |     const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
  1780 |     await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
  1781 |     await usernameInput.click();
  1782 |     await usernameInput.fill(`MixedLang_${timestamp}`);
  1783 |     await page.locator('button[type="submit"]').click();
  1784 |     await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
  1785 | 
  1786 |     await page.fill('input[placeholder="e.g. React-Sandbox"]', `Mixed_WS_${timestamp}`);
  1787 |     await page.click('button:has-text("Create Now")');
  1788 |     await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
  1789 | 
  1790 |     const terminalBody = page.locator('.xterm');
  1791 |     const terminalTextarea = page.locator('.xterm-helper-textarea');
  1792 |     await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
  1793 |     await page.waitForTimeout(3000);
  1794 | 
  1795 |     await terminalTextarea.focus();
  1796 | 
  1797 |     // 1. Python script: Reads stdin, multiplies by 2
  1798 |     const pyScript = `import sys\nprint(int(sys.stdin.read().strip()) * 2)`;
  1799 |     await page.keyboard.type(`cat << 'EOF' > step1.py\n${pyScript}\nEOF\n`, { delay: 10 });
  1800 | 
  1801 |     // 2. Node script: Reads stdin, adds 10
  1802 |     const nodeScript = `const fs = require('fs'); const input = parseInt(fs.readFileSync(0, 'utf-8').trim()); console.log(input + 10);`;
  1803 |     await page.keyboard.type(`cat << 'EOF' > step2.js\n${nodeScript}\nEOF\n`, { delay: 10 });
  1804 | 
  1805 |     // 3. C++ program: Takes argv, prints final formatted string
  1806 |     const cppScript = `
  1807 | #include <iostream>
  1808 | #include <cstdlib>
  1809 | int main(int argc, char** argv) {
  1810 |     if(argc > 1) std::cout << "PIPELINE_FINAL:" << argv[1] << std::endl;
  1811 |     return 0;
  1812 | }
  1813 | `;
  1814 |     await page.keyboard.type(`cat << 'EOF' > step3.cpp\n${cppScript}\nEOF\n`, { delay: 10 });
  1815 |     await page.keyboard.type('g++ step3.cpp -o step3_bin\n', { delay: 10 });
  1816 |     await expect(terminalBody).toContainText('step3_bin', { timeout: 15000 });
  1817 | 
  1818 |     // 4. Bash pipeline chaining them all together:
  1819 |     // Input 5 -> Python(5*2=10) -> Node(10+10=20) -> C++(PIPELINE_FINAL:20)
  1820 |     await page.keyboard.type('result=$(echo "5" | python3 step1.py | node step2.js)\n', { delay: 10 });
  1821 |     await page.keyboard.type('./step3_bin $result\n', { delay: 10 });
  1822 | 
  1823 |     await expect(terminalBody).toContainText('PIPELINE_FINAL:20', { timeout: 10000 });
  1824 |   });
  1825 | 
  1826 | });
  1827 | 
  1828 | test.describe('Terminal Advanced File System Edge Cases', () => {
  1829 | 
  1830 |   test('handles symlinks correctly in terminal and watcher avoids recursive crash', async ({ page }) => {
  1831 |     const timestamp = Date.now();
  1832 |     await page.goto('/login');
  1833 |     const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
  1834 |     await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
  1835 |     await usernameInput.click();
  1836 |     await usernameInput.fill(`Symlink_${timestamp}`);
  1837 |     await page.locator('button[type="submit"]').click();
  1838 |     await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
  1839 | 
  1840 |     await page.fill('input[placeholder="e.g. React-Sandbox"]', `Sym_WS_${timestamp}`);
  1841 |     await page.click('button:has-text("Create Now")');
  1842 |     await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
  1843 | 
  1844 |     const terminalBody = page.locator('.xterm');
  1845 |     const terminalTextarea = page.locator('.xterm-helper-textarea');
  1846 |     await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
  1847 |     await page.waitForTimeout(3000);
  1848 | 
  1849 |     await terminalTextarea.focus();
  1850 | 
  1851 |     // Create a target file
  1852 |     await page.keyboard.type('echo "ORIGINAL_DATA" > real_file.txt\n', { delay: 10 });
  1853 |     
  1854 |     // Create a soft link
  1855 |     await page.keyboard.type('ln -s real_file.txt fake_file.txt\n', { delay: 10 });
  1856 | 
  1857 |     // Watcher should sync the original file (symlinks might be ignored or synced depending on your backend, but it shouldn't crash)
  1858 |     const realFileLocator = page.locator('.ide-scrollbar').getByText('real_file.txt');
  1859 |     await expect(realFileLocator).toBeVisible({ timeout: 15000 });
  1860 | 
  1861 |     // Append to the symlink, verify the original file updates
  1862 |     await page.keyboard.type('echo "MODIFIED_VIA_LINK" >> fake_file.txt\n', { delay: 10 });
  1863 |     await page.keyboard.type('cat real_file.txt\n', { delay: 10 });
  1864 |     
  1865 |     await expect(terminalBody).toContainText('MODIFIED_VIA_LINK', { timeout: 5000 });
  1866 | 
  1867 |     // Open original in editor and verify content update passed through watcher
  1868 |     await realFileLocator.click();
  1869 |     await page.waitForSelector('.monaco-editor', { timeout: 25000 });
> 1870 |     await expect(page.locator('.monaco-editor')).toContainText('MODIFIED_VIA_LINK', { timeout: 10000 });
       |                                                  ^ Error: expect(locator).toContainText(expected) failed
  1871 | 
  1872 |     // Test cyclic symlink creation (to ensure watcher/system doesn't crash in a loop)
  1873 |     await page.keyboard.type('mkdir cycle_dir && cd cycle_dir\n', { delay: 10 });
  1874 |     await page.keyboard.type('ln -s . self_link\n', { delay: 10 });
  1875 |     
  1876 |     // Verify shell is still responsive (no OS-level recursive explosion)
  1877 |     await page.keyboard.type('echo "SURVIVED_CYCLE"\n', { delay: 10 });
  1878 |     await expect(terminalBody).toContainText('SURVIVED_CYCLE', { timeout: 5000 });
  1879 |   });
  1880 | 
  1881 |   test('handles large file operations, binary downloads, and permission modifications (chmod)', async ({ page }) => {
  1882 |     const timestamp = Date.now();
  1883 |     await page.goto('/login');
  1884 |     const usernameInput = page.locator('input[placeholder="Username (e.g. alice, bob)"]');
  1885 |     await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
  1886 |     await usernameInput.click();
  1887 |     await usernameInput.fill(`Perms_${timestamp}`);
  1888 |     await page.locator('button[type="submit"]').click();
  1889 |     await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
  1890 | 
  1891 |     await page.fill('input[placeholder="e.g. React-Sandbox"]', `Perms_WS_${timestamp}`);
  1892 |     await page.click('button:has-text("Create Now")');
  1893 |     await page.waitForSelector('text=Booting environment...', { state: 'detached', timeout: 35000 });
  1894 | 
  1895 |     const terminalBody = page.locator('.xterm');
  1896 |     const terminalTextarea = page.locator('.xterm-helper-textarea');
  1897 |     await expect(terminalBody).toContainText('sandbox:~#', { timeout: 25000 });
  1898 |     await page.waitForTimeout(3000);
  1899 | 
  1900 |     await terminalTextarea.focus();
  1901 | 
  1902 |     // 1. Download a file using curl (simulating fetching a binary/script)
  1903 |     await page.keyboard.type('curl -s https://raw.githubusercontent.com/torvalds/linux/master/README > linux_readme.txt\n', { delay: 10 });
  1904 |     
  1905 |     // Validate the file has substantial line count
  1906 |     await page.keyboard.type('wc -l linux_readme.txt\n', { delay: 10 });
  1907 |     await expect(terminalBody).toContainText(/[1-9][0-9]+ linux_readme\.txt/, { timeout: 10000 });
  1908 | 
  1909 |     // 2. Write a shell script, make it executable, and run it
  1910 |     const bashScript = `#!/bin/bash\necho "EXECUTION_GRANTED_OK"`;
  1911 |     await page.keyboard.type(`cat << 'EOF' > runner.sh\n${bashScript}\nEOF\n`, { delay: 10 });
  1912 |     
  1913 |     // Try running without permissions (should fail)
  1914 |     await page.keyboard.type('./runner.sh\n', { delay: 10 });
  1915 |     await expect(terminalBody).toContainText(/Permission denied|not found/, { timeout: 5000 });
  1916 | 
  1917 |     // Add execution rights
  1918 |     await page.keyboard.type('chmod +x runner.sh\n', { delay: 10 });
  1919 |     
  1920 |     // Run successfully
  1921 |     await page.keyboard.type('./runner.sh\n', { delay: 10 });
  1922 |     await expect(terminalBody).toContainText('EXECUTION_GRANTED_OK', { timeout: 5000 });
  1923 |   });
  1924 | 
  1925 | });
```