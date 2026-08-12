import ws from 'k6/ws';
import { check, sleep } from 'k6';

export const options = {
  vus: 1000,
  duration: '5m',
  thresholds: {
    checks: ['rate>0.90'],
  },
};

export default function () {
  const targetUrl = __ENV.WS_URL || 'ws://129.154.39.198/ide/ws';
  const url = `${targetUrl}?workspaceId=ws-reconnect-herd-${__VU % 20}`;

  // Step 1: Connect and maintain live session for 1 minute
  ws.connect(url, {}, function (socket) {
    socket.on('open', () => {
      check(socket, { 'initial session active': (s) => s !== null });
    });

    socket.setTimeout(() => {
      // Simulate abrupt connection drop
      socket.close();
    }, 60000);
  });

  // Step 2: 10 second network outage pause
  sleep(10);

  // Step 3: Reconnection Thundering Herd (all 1,000 VUs reconnect simultaneously)
  ws.connect(url, {}, function (socket) {
    socket.on('open', () => {
      check(socket, { 'reconnection successful': (s) => s !== null });
    });

    socket.setTimeout(() => {
      socket.close();
    }, 60000);
  });
}
