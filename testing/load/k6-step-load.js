import ws from 'k6/ws';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 500 },   // Step 1: 500 users
    { duration: '2m', target: 1500 },  // Step 2: 1,500 users
    { duration: '2m', target: 3000 },  // Step 3: 3,000 users
    { duration: '2m', target: 6000 },  // Step 4: 6,000 users (Breaking Point SLA)
    { duration: '1m', target: 0 },     // Wind down
  ],
  thresholds: {
    ws_connecting: ['p(95)<2000'],
  },
};

export default function () {
  const targetUrl = __ENV.WS_URL || 'ws://129.154.39.198/ide/ws';
  const url = `${targetUrl}?workspaceId=ws-step-load-${__VU % 10}`;

  ws.connect(url, {}, function (socket) {
    socket.on('open', () => {
      check(socket, { 'step connection open': (s) => s !== null });
    });

    socket.setTimeout(() => {
      socket.close();
    }, 120000);
  });
}
