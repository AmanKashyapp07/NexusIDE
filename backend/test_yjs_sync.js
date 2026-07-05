const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const Y = require('yjs');

const JWT_SECRET = "super_secret_dev_key_123";
const adminUserId = "151b7988-50ca-4df3-a536-66f0d0e1a70d";

async function loginUserApi(username) {
  const res = await axios.post('http://localhost:4000/api/auth/test-login', { username, password: 'password123' });
  return res.data;
}

async function run() {
  // 1. Get tokens
  console.log("Logging in users...");
  const adminData = await loginUserApi("conflict_admin");
  const adminToken = adminData.token;
  
  const userAData = await loginUserApi("user_a");
  const userAToken = userAData.token;
  
  const userBData = await loginUserApi("user_b");
  const userBToken = userBData.token;

  // 2. Create workspace
  console.log("Creating workspace...");
  const wsRes = await axios.post('http://localhost:4000/api/workspace', 
    { title: 'Yjs Sync Test' },
    { headers: { Authorization: `Bearer ${adminToken}` } }
  );
  const wsId = wsRes.data.id;
  console.log("Workspace ID:", wsId);

  // 3. Create file
  const fileRes = await axios.post(`http://localhost:4000/api/workspace/${wsId}/files`,
    { name: 'test.js', type: 'file' },
    { headers: { Authorization: `Bearer ${adminToken}` } }
  );
  const fileId = fileRes.data.id;
  console.log("File ID:", fileId);

  // 4. Invite user_a and user_b
  console.log("Inviting user_a...");
  await axios.post(`http://localhost:4000/api/workspace/${wsId}/collaborators`,
    { usernameOrEmail: 'user_a', role: 'editor' },
    { headers: { Authorization: `Bearer ${adminToken}` } }
  );
  console.log("Inviting user_b...");
  await axios.post(`http://localhost:4000/api/workspace/${wsId}/collaborators`,
    { usernameOrEmail: 'user_b', role: 'editor' },
    { headers: { Authorization: `Bearer ${adminToken}` } }
  );

  // 5. Connect User A & User B
  const roomName = `${wsId}-${fileId}`;
  const urlA = `ws://localhost:4000/${roomName}?token=${encodeURIComponent(userAToken)}`;
  const urlB = `ws://localhost:4000/${roomName}?token=${encodeURIComponent(userBToken)}`;

  console.log("Connecting User A to:", urlA);
  const wsA = new WebSocket(urlA);
  
  console.log("Connecting User B to:", urlB);
  const wsB = new WebSocket(urlB);

  let step = 0;

  wsA.on('open', () => {
    console.log("User A WebSocket opened!");
  });

  wsB.on('open', () => {
    console.log("User B WebSocket opened!");
    // Wait for both to connect, then send a message from A
    setTimeout(() => {
      console.log("User A sending sync message...");
      // Let's create a Yjs doc, make a change, and send update
      const docA = new Y.Doc();
      const textA = docA.getText('monaco');
      textA.insert(0, 'Hello from User A via Yjs!');
      
      const update = Y.encodeStateAsUpdate(docA);
      
      // y-websocket protocol:
      // messageType = 0 (sync), syncMessageType = 2 (update)
      // We write: [0, 2, ...update]
      // Wait, let's write it in y-websocket binary format:
      // Actually, we can use y-websocket protocol:
      const encoder = require('lib0/encoding').createEncoder();
      require('lib0/encoding').writeVarUint(encoder, 0); // messageYjsSync
      require('lib0/encoding').writeVarUint(encoder, 2); // messageYjsSyncUpdate
      require('lib0/encoding').writeVarUint8Array(encoder, update);
      
      wsA.send(require('lib0/encoding').toUint8Array(encoder));
    }, 1500);
  });

  wsB.on('message', (data) => {
    console.log("User B received message bytes length:", data.length);
    try {
      const decoder = require('lib0/decoding').createDecoder(new Uint8Array(data));
      const type = require('lib0/decoding').readVarUint(decoder);
      console.log("User B received message type:", type);
      if (type === 0) {
        const syncType = require('lib0/decoding').readVarUint(decoder);
        console.log("User B sync type:", syncType);
        if (syncType === 2) {
          const update = require('lib0/decoding').readVarUint8Array(decoder);
          const docB = new Y.Doc();
          Y.applyUpdate(docB, update);
          console.log("User B document text:", docB.getText('monaco').toString());
          if (docB.getText('monaco').toString() === 'Hello from User A via Yjs!') {
            console.log("SUCCESS: Yjs synchronization works!");
            cleanup();
          }
        }
      }
    } catch (e) {
      console.error("Decode error on B:", e.message);
    }
  });

  wsA.on('close', (code, reason) => console.log(`User A closed: ${code} - ${reason.toString()}`));
  wsB.on('close', (code, reason) => console.log(`User B closed: ${code} - ${reason.toString()}`));

  function cleanup() {
    wsA.close();
    wsB.close();
    axios.delete(`http://localhost:4000/api/workspace/${wsId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    }).then(() => {
      console.log("Cleaned up workspace.");
      process.exit(0);
    }).catch(err => {
      console.error("Failed to delete workspace:", err.message);
      process.exit(1);
    });
  }

  // Timeout safety
  setTimeout(() => {
    console.error("FAIL: Yjs synchronization timed out!");
    cleanup();
  }, 10000);
}

run().catch(err => console.error("Failed:", err.message));
