import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import WebSocket from 'ws';
import axios from 'axios';

const pool = new Pool({ connectionString: 'postgresql://amankashyap@localhost:5432/sandbox' });
const JWT_SECRET = 'super_secret_dev_key_123';

async function run() {
  try {
    // 1. Create a test admin user with a fake GitHub token
    const userRes = await pool.query(
      'INSERT INTO users (username, email, github_token) VALUES ($1, $2, $3) RETURNING id',
      ['testadmin', 'test@example.com', 'fake_github_token_123']
    );
    const userId = userRes.rows[0].id;
    const token = jwt.sign({ id: userId, username: 'testadmin' }, JWT_SECRET);

    // 2. Create a workspace (instead of importing, let's just create one for speed)
    const wsRes = await pool.query(
      'INSERT INTO workspaces (owner_id, title) VALUES ($1, $2) RETURNING id',
      [userId, 'AmanKashyapp07/magnus-ci-demo']
    );
    const workspaceId = wsRes.rows[0].id;

    console.log(`Created Workspace: ${workspaceId}, User: ${userId}`);

    // 3. Connect to terminal WebSocket
    const wsUrl = `ws://localhost:4001/terminal/${workspaceId}?token=${token}`;
    console.log(`Connecting to ${wsUrl}`);
    
    const ws = new WebSocket(wsUrl);
    
    ws.on('open', () => {
      console.log('Terminal connected successfully!');
      setTimeout(() => {
        ws.send('echo "Hello World"\r');
      }, 500);
    });

    ws.on('message', (data) => {
      console.log(`Received: ${data.toString()}`);
    });

    ws.on('close', (code, reason) => {
      console.log(`Terminal closed: ${code} - ${reason.toString()}`);
      pool.end();
      process.exit(code === 1000 ? 0 : 1);
    });

    ws.on('error', (err) => {
      console.error('WebSocket Error:', err);
    });

  } catch (err) {
    console.error('Script Error:', err);
    pool.end();
  }
}

run();
