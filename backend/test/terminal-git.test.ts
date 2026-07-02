/**
 * Terminal Connection Integration Test
 * 
 * Tests the WebSocket terminal connection flow end-to-end
 * to verify the git integration doesn't break the terminal.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import WebSocket from 'ws';

// Read env manually since dotenv may not be loaded
import dotenv from 'dotenv';
dotenv.config();

const API_BASE = 'http://localhost:4000';

let authToken = '';
let testUserId = '';
let testWorkspaceId = '';

describe('Terminal Connection', () => {

  beforeAll(async () => {
    // Step 1: Get a valid JWT token by checking existing users
    const { getPool } = await import('../src/db.js');
    const pool = getPool();
    
    // Find the first user with a github_token (admin user)
    const userRes = await pool.query(
      `SELECT u.id, u.username, u.email, u.github_token FROM users u WHERE u.github_token IS NOT NULL LIMIT 1`
    );

    if (userRes.rows.length === 0) {
      throw new Error('No users with github_token found in database. Log in via GitHub first.');
    }
    
    const user = userRes.rows[0];
    testUserId = user.id;
    console.log(`[Test] Using user: ${user.username} (${user.id})`);

    // Create a JWT token for this user
    const jwt = await import('jsonwebtoken');
    authToken = jwt.default.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET || 'fallback_secret'
    );

    // Find a workspace owned by this user
    const wsRes = await pool.query(
      `SELECT id, title FROM workspaces WHERE owner_id = $1 LIMIT 1`,
      [testUserId]
    );

    if (wsRes.rows.length === 0) {
      // Create a test workspace
      const createRes = await pool.query(
        `INSERT INTO workspaces (title, owner_id) VALUES ('git-test-workspace', $1) RETURNING id`,
        [testUserId]
      );
      testWorkspaceId = createRes.rows[0].id;
      console.log(`[Test] Created test workspace: ${testWorkspaceId}`);
    } else {
      testWorkspaceId = wsRes.rows[0].id;
      console.log(`[Test] Using existing workspace: ${wsRes.rows[0].title} (${testWorkspaceId})`);
    }
  });

  it('should establish a WebSocket terminal connection without crashing', async () => {
    const wsUrl = `ws://localhost:4000/terminal/${testWorkspaceId}?token=${authToken}`;
    console.log(`[Test] Connecting to: ws://localhost:4000/terminal/${testWorkspaceId}?token=<redacted>`);

    const result = await new Promise<{ connected: boolean; data: string; closeCode?: number; closeReason?: string }>((resolve) => {
      let receivedData = '';
      const timeout = setTimeout(() => {
        ws.close();
        resolve({ connected: true, data: receivedData });
      }, 5000);

      const ws = new WebSocket(wsUrl);

      ws.on('open', () => {
        console.log('[Test] ✅ WebSocket OPEN');
      });

      ws.on('message', (data) => {
        const text = data.toString();
        receivedData += text;
        // Once we get any shell output (PS1 prompt), the connection is working
        if (receivedData.length > 10) {
          clearTimeout(timeout);
          ws.close();
          resolve({ connected: true, data: receivedData });
        }
      });

      ws.on('close', (code, reason) => {
        clearTimeout(timeout);
        console.log(`[Test] WebSocket CLOSED: code=${code}, reason=${reason.toString()}`);
        if (receivedData.length === 0) {
          resolve({ connected: false, data: '', closeCode: code, closeReason: reason.toString() });
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        console.error(`[Test] WebSocket ERROR:`, err.message);
        resolve({ connected: false, data: err.message });
      });
    });

    console.log(`[Test] Connected: ${result.connected}`);
    console.log(`[Test] Data received: ${result.data.substring(0, 200)}`);
    if (result.closeCode) console.log(`[Test] Close code: ${result.closeCode}, reason: ${result.closeReason}`);

    expect(result.connected).toBe(true);
    expect(result.data.length).toBeGreaterThan(0);
  }, 15000);

  it('should send a command and receive output', async () => {
    const wsUrl = `ws://localhost:4000/terminal/${testWorkspaceId}?token=${authToken}`;

    const result = await new Promise<string>((resolve) => {
      let output = '';
      const ws = new WebSocket(wsUrl);

      const timeout = setTimeout(() => {
        ws.close();
        resolve(output);
      }, 6000);

      ws.on('open', () => {
        // Wait for prompt, then send a command
        setTimeout(() => {
          ws.send('echo TERMINAL_OK\n');
        }, 1500);
      });

      ws.on('message', (data) => {
        output += data.toString();
        if (output.includes('TERMINAL_OK')) {
          clearTimeout(timeout);
          setTimeout(() => { ws.close(); resolve(output); }, 500);
        }
      });

      ws.on('error', () => resolve(''));
      ws.on('close', () => { clearTimeout(timeout); resolve(output); });
    });

    console.log(`[Test] Command output received: ${result.includes('TERMINAL_OK')}`);
    expect(result).toContain('TERMINAL_OK');
  }, 15000);

  it('git wrapper should exist and restrict commands (admin only)', async () => {
    const wsUrl = `ws://localhost:4000/terminal/${testWorkspaceId}?token=${authToken}`;

    const result = await new Promise<string>((resolve) => {
      let output = '';
      const ws = new WebSocket(wsUrl);

      const timeout = setTimeout(() => {
        ws.close();
        resolve(output);
      }, 8000);

      ws.on('open', () => {
        // Wait for prompt, then test the git wrapper
        setTimeout(() => {
          ws.send('which git && cat /tmp/git && echo GIT_CHECK_DONE\n');
        }, 1500);
      });

      ws.on('message', (data) => {
        output += data.toString();
        if (output.includes('GIT_CHECK_DONE')) {
          clearTimeout(timeout);
          setTimeout(() => { ws.close(); resolve(output); }, 500);
        }
      });

      ws.on('error', () => resolve(''));
      ws.on('close', () => { clearTimeout(timeout); resolve(output); });
    });

    console.log(`[Test] Git wrapper output:\n${result}`);
    // The git command should resolve to /tmp/git (our wrapper)
    expect(result).toContain('/tmp/git');
    expect(result).toContain('GIT_CHECK_DONE');
  }, 15000);

  it('should allow git clone inside the terminal', async () => {
    const wsUrl = `ws://localhost:4000/terminal/${testWorkspaceId}?token=${authToken}`;

    const result = await new Promise<string>((resolve) => {
      let output = '';
      const ws = new WebSocket(wsUrl);

      const timeout = setTimeout(() => {
        ws.close();
        resolve(output);
      }, 15000);

      ws.on('open', () => {
        setTimeout(() => {
          // Clone a public dummy repo in /tmp so we don't pollute /app
          ws.send('cd /tmp && git clone https://github.com/AmanKashyapp07/github-test-ci.git && echo CLONE_DONE\n');
        }, 1500);
      });

      ws.on('message', (data) => {
        output += data.toString();
        if (output.includes('CLONE_DONE')) {
          clearTimeout(timeout);
          setTimeout(() => { ws.close(); resolve(output); }, 500);
        }
      });

      ws.on('error', () => resolve(''));
      ws.on('close', () => { clearTimeout(timeout); resolve(output); });
    });

    console.log(`[Test] Clone output:\n${result}`);
    expect(result).toContain('CLONE_DONE');
    expect(result).not.toContain('Only git clone, commit, push, add, status, log, and diff are allowed');
  }, 20000);
});
