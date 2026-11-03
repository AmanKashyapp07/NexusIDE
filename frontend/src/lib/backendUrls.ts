export const getFallbackApiUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:4000/api';
  const hostname = window.location.hostname || 'localhost';
  return `${window.location.protocol}//${hostname}:4000/api`;
};

export const getFallbackWsUrl = () => {
  if (typeof window === 'undefined') return 'ws://localhost:4000';
  const hostname = window.location.hostname || 'localhost';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${hostname}:4000`;
};

export const getSocketIoOptions = () => {
  const options = { transports: ['websocket'], upgrade: false };
  if (typeof window === 'undefined') return { url: 'http://localhost:4000', path: '/socket.io', ...options };
  const hostname = window.location.hostname || 'localhost';
  return { url: `${window.location.protocol}//${hostname}:4000`, path: '/socket.io', ...options };
};

export const apiUrl = (path: string) => `${getFallbackApiUrl()}${path.startsWith('/') ? path : `/${path}`}`;
export const wsUrl = (path: string) => `${getFallbackWsUrl()}${path.startsWith('/') ? path : `/${path}`}`;
