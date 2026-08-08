const trimTrailingSlash = (value: string) => value.replace(/\/$/, '');

export const getFallbackApiUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:4000/api';
  const hostname = window.location.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${window.location.protocol}//${hostname}:4000/api`;
  }
  return `${window.location.protocol}//${hostname}/ide/api`;
};

export const getFallbackWsUrl = () => {
  if (typeof window === 'undefined') return 'ws://localhost:4000';
  const hostname = window.location.hostname;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${protocol}//${hostname}:4000`;
  }
  return `${protocol}//${hostname}/ide/ws`;
};

export const getSocketIoOptions = () => {
  if (typeof window === 'undefined') return { url: 'http://localhost:4000', path: '/socket.io' };
  const hostname = window.location.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return { url: `${window.location.protocol}//${hostname}:4000`, path: '/socket.io' };
  }
  return { url: `${window.location.protocol}//${hostname}`, path: '/ide/socket.io' };
};

export const apiUrl = (path: string) => `${getFallbackApiUrl()}${path.startsWith('/') ? path : `/${path}`}`;
export const wsUrl = (path: string) => `${getFallbackWsUrl()}${path.startsWith('/') ? path : `/${path}`}`;