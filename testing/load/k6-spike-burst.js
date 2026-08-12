import ws from 'k6/ws';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    connection_surge: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 500,
      maxVUs: 5000,
      stages: [
        { target: 5000, duration: '10s' }, // Rapid 10s surge to 5000 conns/sec
        { target: 5000, duration: '2m' },  // Hold surge for 2 minutes
        { target: 0, duration: '10s' },    // Ramp down
      ],
    },
  },
  thresholds: {
    ws_connecting: ['p(95)<1000'], // 95% of connections established in < 1s
    checks: ['rate>0.95'],        // 95%+ success rate
  },
};

export default function () {
  const targetUrl = __ENV.WS_URL || 'ws://129.154.39.198/ide/ws';
  const url = `${targetUrl}?workspaceId=ws-spike-test`;

  const res = ws.connect(url, {}, function (socket) {
    socket.on('open', () => {
      check(socket, { 'WS connected successfully': (s) => s !== null });
    });

    socket.on('error', (e) => {
      console.error('WS Error:', e);
    });

    socket.setTimeout(function () {
      socket.close();
    }, 120000); // 2 minute hold
  });

  check(res, { 'status is 101': (r) => r && r.status === 101 });
}
