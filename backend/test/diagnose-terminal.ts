/**
 * Quick diagnostic script — run with: npx tsx test/diagnose-terminal.ts
 * 
 * Tests raw WebSocket connectivity + logs every detail.
 */
import dotenv from 'dotenv';
dotenv.config();

import WebSocket from 'ws';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const API_BASE = 'http://localhost:4000';

async function main() {
  // 1. Check HTTP connectivity
  console.log('=== Step 1: HTTP Health Check ===');
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`);
    console.log(`HTTP Status: ${res.status} (expected 401 = server is up)`);
    if (res.status !== 401) {
      console.log('Body:', await res.text());
    }
  } catch (err: any) {
    console.error('❌ Backend not reachable:', err.message);
    process.exit(1);
  }

  // 2. Get user + workspace from DB
  console.log('\n=== Step 2: Database Lookup ===');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  
  const userRes = await pool.query(
    `SELECT u.id, u.username, u.email, u.github_token FROM users u LIMIT 1`
  );
  if (userRes.rows.length === 0) {
    console.error('❌ No users in database');
    process.exit(1);
  }
  const user = userRes.rows[0];
  console.log(`User: ${user.username} (${user.id})`);
  console.log(`Has github_token: ${!!user.github_token}`);

  const wsRes = await pool.query(
    `SELECT id, title FROM workspaces WHERE owner_id = $1 LIMIT 1`,
    [user.id]
  );
  if (wsRes.rows.length === 0) {
    console.error('❌ No workspaces for this user');
    process.exit(1);
  }
  const workspace = wsRes.rows[0];
  console.log(`Workspace: ${workspace.title} (${workspace.id})`);

  const token = jwt.sign(
    { id: user.id, username: user.username },
    process.env.JWT_SECRET || 'fallback_secret'
  );

  await pool.end();

  // 3. Test raw WebSocket
  console.log('\n=== Step 3: WebSocket Connection ===');
  const wsUrl = `ws://localhost:4000/terminal/${workspace.id}?token=${token}`;
  console.log(`Connecting to: ${wsUrl.replace(token, '<JWT>')}`);

  await new Promise<void>((resolve) => {
    const ws = new WebSocket(wsUrl);
    let receivedData = '';

    const timeout = setTimeout(() => {
      console.log(`\n=== Timeout after 8s ===`);
      console.log(`Data received so far (${receivedData.length} bytes): "${receivedData.substring(0, 300)}"`);
      ws.close();
      resolve();
    }, 8000);

    ws.on('open', () => {
      console.log('✅ WebSocket OPEN (upgrade successful)');
      // Send a simple echo after 2s
      setTimeout(() => {
        console.log('Sending: echo DIAGNOSTIC_OK');
        ws.send('echo DIAGNOSTIC_OK\n');
      }, 2000);
    });

    ws.on('message', (data) => {
      const text = data.toString();
      receivedData += text;
      if (receivedData.length <= 500) {
        process.stdout.write(`[recv ${data.toString().length}b] `);
      }
      if (receivedData.includes('DIAGNOSTIC_OK')) {
        clearTimeout(timeout);
        console.log('\n✅ Terminal is WORKING! Received echo response.');
        ws.close();
        resolve();
      }
    });

    ws.on('close', (code, reason) => {
      clearTimeout(timeout);
      console.log(`\n❌ WebSocket CLOSED: code=${code}, reason="${reason.toString()}"`);
      if (receivedData.length === 0) {
        console.log('No data was received. The connection was killed before the shell started.');
        console.log('This typically means handleTerminalConnection() threw an error.');
        console.log('Check the backend server console output for [Terminal] error messages.');
      }
      resolve();
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      console.error(`❌ WebSocket ERROR: ${err.message}`);
      resolve();
    });
  });

  console.log('\n=== Done ===');
}

main().catch(console.error);
