const trimTrailingSlash = (value: string) => value.replace(/\/$/, '');

const apiBase = trimTrailingSlash(import.meta.env.VITE_API_URL || 'http://localhost:4000/api');
const wsBase = trimTrailingSlash(import.meta.env.VITE_WS_URL || 'ws://localhost:4000');

export const apiUrl = (path: string) => `${apiBase}${path.startsWith('/') ? path : `/${path}`}`;
export const wsUrl = (path: string) => `${wsBase}${path.startsWith('/') ? path : `/${path}`}`;