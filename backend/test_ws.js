const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:4000/terminal/some_id?token=test');
ws.on('open', () => console.log('Connected'));
ws.on('close', (code, reason) => console.log('Closed', code, reason.toString()));
ws.on('error', err => console.log('Error', err));
