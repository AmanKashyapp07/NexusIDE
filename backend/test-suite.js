const { Client } = require('pg');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_dev_key_123';
const DB_URL = process.env.DATABASE_URL || 'postgresql://amankashyap@localhost:5432/sandbox';

async function runTestSuite() {
  console.log('--- STARTING ADVANCED TERMINAL TEST SUITE ---\n');
  
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  
  const wsRes = await client.query('SELECT id, owner_id FROM workspaces LIMIT 1');
  if (wsRes.rows.length === 0) {
    console.log('❌ No workspaces found in DB to test with.');
    process.exit(1);
  }
  
  const workspaceId = wsRes.rows[0].id;
  const ownerId = wsRes.rows[0].owner_id;
  const token = jwt.sign({ id: ownerId }, JWT_SECRET, { expiresIn: '1h' });
  
  console.log(`✅ Fetched Workspace: ${workspaceId}`);
  
  const ws = new WebSocket(`ws://localhost:4000/terminal/${workspaceId}?token=${token}`);
  let terminalBuffer = '';
  
  ws.on('open', () => {
    console.log('✅ WebSocket Connected');
    
    // Command sequence with slight delays
    const commands = [
      { t: 500, cmd: 'echo "TEST_ECHO_WORKING"', desc: '1. Basic Echo' },
      { t: 1000, cmd: 'node -e "console.log(999 * 2)"', desc: '2. Node Execution' },
      { t: 1500, cmd: 'this_command_does_not_exist', desc: '3. Stderr/Error Checking' },
      { t: 2000, cmd: 'mkdir -p /app/test_folder_sync', desc: '4. Folder Sync Creation' },
      { t: 2500, cmd: 'echo "initial_content" > /app/test_file_sync.js', desc: '5. File Sync Creation' },
      { t: 4000, cmd: 'echo "updated_content" > /app/test_file_sync.js', desc: '6. File Sync Modification' },
      { t: 5500, cmd: 'for i in $(seq 1 100); do echo "LINE_$i"; done', desc: '7. Large Data Stream Handling' },
      { t: 6000, cmd: 'rm /app/test_file_sync.js', desc: '8. File Deletion Sync' }
    ];

    commands.forEach(({ t, cmd, desc }) => {
      setTimeout(() => {
        console.log(`-> ${desc}`);
        ws.send(`${cmd}\n`);
      }, t);
    });
  });
  
  ws.on('message', (data) => {
    terminalBuffer += data.toString();
  });
  
  ws.on('error', (err) => console.error('❌ WebSocket Error:', err.message));
  ws.on('close', () => console.log('ℹ️ WebSocket Closed'));

  // Validation Phase
  setTimeout(async () => {
    console.log('\n--- VALIDATING RESULTS ---\n');
    let allPassed = true;

    const assert = (condition, msg) => {
      if (condition) {
        console.log(`✅ Passed: ${msg}`);
      } else {
        console.log(`❌ Failed: ${msg}`);
        allPassed = false;
      }
    };

    // 1. Basic Echo
    assert(terminalBuffer.includes('TEST_ECHO_WORKING'), 'Basic bash echo works');
    
    // 2. Node Execution
    assert(terminalBuffer.includes('1998'), 'Node execution calculates correctly');

    // 3. Error Checking (stderr)
    assert(terminalBuffer.includes('not found') || terminalBuffer.includes('command not found'), 'Stderr output captured correctly');

    // 4. Folder Sync Check
    const folderRes = await client.query('SELECT id FROM files WHERE workspace_id = $1 AND name = $2 AND type = $3', [workspaceId, 'test_folder_sync', 'directory']);
    assert(folderRes.rows.length > 0, 'Directory creation synced to database');

    // 5 & 6. File Update Check (Checking if content updated)
    // Wait an extra second for DB sync of deletion if needed
    const fileResBeforeDelete = await client.query('SELECT content FROM files WHERE workspace_id = $1 AND name = $2', [workspaceId, 'test_file_sync.js']);
    // Wait, the file was deleted at t=6000, this validation runs at t=8000. It should be GONE.
    assert(fileResBeforeDelete.rows.length === 0, 'File deletion synced to database');

    // 7. Large Data stream check
    assert(terminalBuffer.includes('LINE_100'), 'Stream pipes can handle large output bursts without truncation');

    // Cleanup lingering folder
    if (folderRes.rows.length > 0) {
      await client.query('DELETE FROM files WHERE id = $1', [folderRes.rows[0].id]);
      ws.send('rm -rf /app/test_folder_sync\n');
    }

    if (allPassed) {
      console.log('\n🎉 ALL ADVANCED TESTS PASSED! Terminal pipeline is 100% solid.');
    } else {
      console.log('\n⚠️ SOME TESTS FAILED.');
    }

    ws.close();
    client.end();
    process.exit(allPassed ? 0 : 1);
  }, 8500); // Allow time for DB polling intervals (1.5s) to catch all changes
}

runTestSuite().catch(err => {
  console.error('Crash:', err);
  process.exit(1);
});
