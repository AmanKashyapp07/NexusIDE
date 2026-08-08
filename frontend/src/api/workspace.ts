import { apiUrl } from '../lib/backendUrls';

export interface Workspace {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  owner_id: string;
  user_role?: string;
  userRole?: string;
}

export interface AppFile {
  id: string;
  name: string;
  type: 'file' | 'directory';
  parent_id: string | null;
  language: string | null;
  content?: string;
}

export async function fetchWorkspaces(token: string): Promise<Workspace[]> {
  const res = await fetch(apiUrl('/workspace'), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error('Failed to fetch workspaces');
  }
  return res.json();
}

export async function fetchWorkspace(token: string, id: string): Promise<Workspace> {
  const res = await fetch(apiUrl(`/workspace/${id}`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error('Failed to fetch workspace details');
  }
  return res.json();
}

export async function createWorkspace(token: string, title: string): Promise<Workspace> {
  const res = await fetch(apiUrl('/workspace'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to create workspace');
  }
  return data;
}

export async function deleteWorkspace(token: string, id: string): Promise<void> {
  const res = await fetch(apiUrl(`/workspace/${id}`), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to delete workspace' }));
    throw new Error(data.error || 'Failed to delete workspace');
  }
}

export async function renameWorkspace(token: string, id: string, title: string): Promise<void> {
  const res = await fetch(apiUrl('/workspace'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ id, title }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to update workspace title' }));
    throw new Error(data.error || 'Failed to update workspace title');
  }
}

export async function exportWorkspace(token: string, id: string): Promise<Blob> {
  const res = await fetch(apiUrl(`/workspace/${id}/export`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => 'Failed to export workspace');
    throw new Error(errText || 'Failed to export workspace');
  }
  return res.blob();
}

export async function fetchWorkspaceFiles(token: string, wsId: string): Promise<AppFile[]> {
  const res = await fetch(apiUrl(`/workspace/${wsId}/files`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error('Failed to fetch files');
  }
  return res.json();
}

export async function createFile(
  token: string,
  wsId: string,
  payload: { name: string; type: 'file' | 'directory'; parent_id: string | null; language: string | null }
): Promise<AppFile> {
  const res = await fetch(apiUrl(`/workspace/${wsId}/files`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to create file');
  }
  return data;
}

export async function deleteFile(token: string, wsId: string, fileId: string): Promise<void> {
  const res = await fetch(apiUrl(`/workspace/${wsId}/files/${fileId}`), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error('Failed to delete file');
  }
}
