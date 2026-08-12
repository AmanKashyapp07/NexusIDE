import ws from 'k6/ws';
import { check } from 'k6';

export const options = {
  vus: 50,
  duration: '2m',
  thresholds: {
    checks: ['rate>0.95'],
  },
};

export default function () {
  const targetUrl = __ENV.WS_URL || 'ws://129.154.39.198/ide/ws';
  const url = `${targetUrl}?workspaceId=ws-pty-flood-${__VU}`;

  ws.connect(url, {}, function (socket) {
    socket.on('open', () => {
      // Trigger infinite high-volume stdout stream command inside container
      const cmdPayload = JSON.stringify({
        type: 'pty_input',
        data: 'cat /dev/urandom | base64\r\n',
      });
      socket.send(cmdPayload);
    });

    socket.setTimeout(() => {
      // Stop flood command and exit session cleanly
      socket.send(JSON.stringify({ type: 'pty_input', data: '\x03' })); // Ctrl+C
      socket.close();
    }, 90000);
  });
}
