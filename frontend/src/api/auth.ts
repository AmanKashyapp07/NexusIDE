import { apiUrl } from '../lib/backendUrls';

export interface AuthUser {
  id: string;
  username: string;
  avatar_url?: string;
}

export async function fetchCurrentUser(token: string): Promise<AuthUser> {
  const res = await fetch(apiUrl('/auth/me'), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error('Unauthorized');
  }
  const data = await res.json();
  return data.user;
}
