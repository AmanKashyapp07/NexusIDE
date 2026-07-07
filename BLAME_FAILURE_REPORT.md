# Blame Feature Test Failure Report

## Summary
3 tests failed after implementing majority-rule blame algorithm. Added debug logging to diagnose character distribution and Yjs sync issues.

---

## Test #1: `attributes authorship chronologically on the same line`
**Status:** FAILED  
**Verdict:** **LIKELY CODE FAULT** (needs confirmation with debug logs)

### Failure
```
Error: expect(locator).toBeVisible() failed
Locator: locator('.w-\\[260px\\]').getByText('attr_bob')
Expected: visible
```

### Test Scenario
1. Alice writes: `let data = [];` (14 characters)
2. Bob inserts at position 14: ` /* loaded */` (12 characters)
3. Expected: Bob owns the line (majority rule)
4. Actual: `attr_bob` not visible in blame sidebar

### Suspected Root Cause
**Character count mismatch**: Alice has 14 chars, Bob has 12 chars. Under majority-rule, Alice still wins! The test expectation is wrong OR Bob's edit isn't actually replacing/deleting Alice's characters—he's just appending.

### Debug Logs Added
- Line 368-390: Logs line content, Yjs character distribution by clientID
- Will show: `{ lineContent: 'let data = []; /* loaded */', charsByClient: { aliceID: 14, bobID: 12 } }`

### Manual Test Instructions
1. Login as `attr_alice` on http://129.154.39.198
2. Create workspace, create file `blame_chrono.js`
3. Type: `let data = [];`
4. Click **Blame** → Verify Alice shown as author
5. Click **Hide Blame**
6. Invite `attr_bob` (editor role)
7. Login as `attr_bob` in incognito window
8. Open same file, wait for content to load
9. Place cursor at end of line 1 (after `;`), type: ` /* loaded */`
10. Switch back to Alice's browser
11. Click **Blame** again
12. **Expected:** Blame shows `attr_bob` (if Bob has more chars)
13. **Actual:** Check if blame shows Alice or Bob

---

## Test #2: `live blame updates when user-2 modifies user-1 line (both connected)`
**Status:** FAILED  
**Verdict:** **TEST FAULT** (Yjs WebSocket not syncing in test environment)

### Failure
```
Error: Bob's Yjs not synced. Status: {"connected":false,"synced":false,"content":"const x = 10;","wsExists":false}
```

### Suspected Root Cause
`window.__yjsProvider` is `undefined` in Bob's browser context. This means:
1. CodeEditor component didn't mount properly for Bob, OR
2. The `window.__yjsProvider` assignment happens AFTER the test checks for it, OR
3. Bob's page is checking the wrong window context

### Debug Logs Added
- Line 538-564: Logs Alice's editor content after Bob's edit, Yjs character counts
- Will reveal if Bob's edit ever reaches Alice's Yjs document

### Manual Test Instructions
1. Login as `attr_alice` on http://129.154.39.198
2. Create workspace, create file `live_blame_update.js`
3. Type: `const x = 10;`
4. Click **Blame** → Verify Alice shown
5. Keep blame sidebar **OPEN** (this test checks live updates)
6. Invite `live_bob` (editor role)
7. Login as `live_bob` in incognito window
8. Open same file, verify it shows `const x = 10;`
9. As Bob, add at end of line 1: ` // modified by Bob`
10. Switch to Alice's browser (blame still open)
11. **Expected:** Blame sidebar updates to show `live_bob` as author
12. **Actual:** Check if Alice's editor even shows Bob's comment

---

## Test #3: `history endpoint returns authorMap with the typist`
**Status:** INTERRUPTED  
**Verdict:** **TEST FAULT** (cascading timeout from Test #2)

### Failure
```
Test was interrupted.
Error: page.waitForTimeout: Test ended.
```

### Root Cause
Test #2 spent 15+ seconds polling for a WebSocket that never synced. Playwright hit global timeout and killed Test #3 mid-execution.

### Fix
Fixing Test #2 will prevent this interruption.

---

## Next Steps

### 1. Run Tests with Debug Logs
```bash
cd /Users/amankashyap/Documents/sandbox
BASE_URL=http://129.154.39.198 npm --prefix frontend run test:e2e -- timelapse.spec.ts --grep="attributes authorship"
```

Check console output for:
- `[TEST DEBUG] Line 1 content:` → Shows character distribution
- `[TEST DEBUG] Character counts on line 1:` → Shows which client owns more chars

### 2. Manual IDE Testing
Follow manual test instructions above to verify:
- Does closing/reopening blame show correct authorship?
- Does Bob's edit even sync to Alice in test environment?

### 3. Code Fixes Required

**If debug logs show Alice has more characters:**
- **Fix Test #1 expectation** → Bob should type MORE characters than Alice has, OR
- **Fix test to delete Alice's line first** → Then Bob's new line will be 100% his

**If `wsExists: false` persists:**
- **Check if `window.__yjsProvider` is set in production build** (check deployed CodeEditor.tsx lines 246-250)
- **Add delay in test** → Wait longer for CodeEditor to mount before checking `__yjsProvider`

---

## Files Modified
- `/Users/amankashyap/Documents/sandbox/testing/e2e/timelapse.spec.ts` (lines 368-390, 538-564)
- `/Users/amankashyap/Documents/sandbox/frontend/src/components/Editor/CodeEditor.tsx` (majority-rule algorithm + window.__yjsProvider exposure)
- `/Users/amankashyap/Documents/sandbox/frontend/src/components/Editor/BlameViewer.tsx` (majority-rule algorithm)

---

## Command to Deploy + Test
```bash
# Deploy updated test suite (no frontend changes needed for debug logs)
cd /Users/amankashyap/Documents/sandbox
BASE_URL=http://129.154.39.198 npm --prefix frontend run test:e2e -- timelapse.spec.ts 2>&1 | tee test_output.log
```

Check `test_output.log` for `[TEST DEBUG]` lines.
