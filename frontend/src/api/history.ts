import { apiUrl } from '../lib/backendUrls';

export interface AuthorInfo {
  userId: string;
  username: string;
  color: string;
}

export type AuthorMap = Record<string, AuthorInfo>;

export interface HistoryResponse {
  authorMap: AuthorMap;
  updates?: string[];
  yjsState?: string;
}

export interface ConflictResponse {
  hasConflicts: boolean;
}

export async function fetchFileHistory(token: string, wsId: string, fileId: string): Promise<HistoryResponse> {
  const res = await fetch(apiUrl(`/workspace/${wsId}/files/${fileId}/history`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error('Failed to fetch file history');
  }
  return res.json();
}

export async function fetchFileConflicts(token: string, wsId: string, fileId: string): Promise<ConflictResponse> {
  const res = await fetch(apiUrl(`/workspace/${wsId}/files/${fileId}/conflicts`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error('Failed to check conflicts');
  }
  return res.json();
}
