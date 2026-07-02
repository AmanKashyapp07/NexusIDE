import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { handleTerminalConnection } from '/Users/amankashyap/Documents/sandbox/backend/src/terminal/terminalHandler';

const pool = new Pool({ connectionString: 'postgresql://amankashyap@localhost:5432/sandbox' });
const JWT_SECRET = 'super_secret_dev_key_123';

async function run() {
  try {
    const rand = Math.floor(Math.random() * 10000);
    const userRes = await pool.query(
      'INSERT INTO users (username, email, github_token) VALUES ($1, $2, $3) RETURNING id',
      [`testadmin_${rand}`, `test${rand}@example.com`, 'fake_token']
    );
    const userId = userRes.rows[0].id;
    const token = jwt.sign({ id: userId, username: `testadmin_${rand}` }, JWT_SECRET);

    const wsRes = await pool.query(
      'INSERT INTO workspaces (owner_id, title) VALUES ($1, $2) RETURNING id',
      [userId, 'AmanKashyapp07/magnus-ci-demo']
    );
    const workspaceId = wsRes.rows[0].id;

    console.log(`Created Workspace: ${workspaceId}, User: ${userId}`);

    const mockWs = {
      readyState: 1, // OPEN
      send: (data: any) => {},
      close: (code: number, reason: string) => { console.log('Mock WS Closed:', code, reason); },
      on: () => {},
      OPEN: 1
    };
    const mockReq = {
      url: `/terminal/${workspaceId}?token=${token}`,
      headers: { host: 'localhost' }
    };

    console.log('Calling handleTerminalConnection...');
    try {
      await handleTerminalConnection(mockWs as any, mockReq as any);
      console.log('handleTerminalConnection finished successfully.');
    } catch (err: any) {
      console.error('FATAL ERROR:', err.stack);
    }
  } catch (err) {
    console.error('Script Error:', err);
  } finally {
    pool.end();
  }
}

run();
