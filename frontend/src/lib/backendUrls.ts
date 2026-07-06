const trimTrailingSlash = (value: string) => value.replace(/\/$/, '');

const getFallbackApiUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:4000/api';
  return `${window.location.protocol}//${window.location.hostname}:4000/api`;
};

const getFallbackWsUrl = () => {
  if (typeof window === 'undefined') return 'ws://localhost:4000';
  return `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname}:4000`;
};

const apiBase = trimTrailingSlash(import.meta.env.VITE_API_URL || getFallbackApiUrl());
const wsBase = trimTrailingSlash(import.meta.env.VITE_WS_URL || getFallbackWsUrl());

export const apiUrl = (path: string) => `${apiBase}${path.startsWith('/') ? path : `/${path}`}`;
export const wsUrl = (path: string) => `${wsBase}${path.startsWith('/') ? path : `/${path}`}`;