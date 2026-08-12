import ws from 'k6/ws';
import { check, sleep } from 'k6';

export const options = {
  vus: 50,
  duration: '3m',
  thresholds: {
    checks: ['rate>0.98'],
  },
};

export default function () {
  const targetUrl = __ENV.WS_URL || 'ws://129.154.39.198/ide/ws';
  const workspaceId = 'ws-shared-fanout-doc';
  const url = `${targetUrl}?workspaceId=${workspaceId}`;

  ws.connect(url, {}, function (socket) {
    socket.on('open', () => {
      // 20 edits per second per user (50ms interval)
      socket.setInterval(() => {
        const payload = JSON.stringify({
          type: 'awareness_update',
          user: `user_${__VU}`,
          cursor: { line: Math.floor(Math.random() * 100), ch: Math.floor(Math.random() * 80) },
          timestamp: Date.now(),
        });
        socket.send(payload);
      }, 50);
    });

    socket.setTimeout(() => {
      socket.close();
    }, 180000); // 3 minutes
  });
}
