import { apiUrl } from '../lib/backendUrls';

export interface Snapshot {
  id: string;
  label: string;
  created_at: string;
  created_by: string;
}

export interface SnapshotFile {
  path: string;
  language: string | null;
  snapshot_content: string | null;
  live_content: string | null;
}

export async function createSnapshot(token: string, wsId: string, label: string): Promise<Snapshot> {
  const res = await fetch(apiUrl(`/workspace/${wsId}/snapshot`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ label }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Snapshot creation failed');
  }
  return data;
}

export async function fetchSnapshots(token: string, wsId: string): Promise<Snapshot[]> {
  const res = await fetch(apiUrl(`/workspace/${wsId}/snapshots`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error('Failed to fetch snapshots');
  }
  return res.json();
}

export async function fetchSnapshotFiles(token: string, wsId: string, snapshotId: string): Promise<SnapshotFile[]> {
  const res = await fetch(apiUrl(`/workspace/${wsId}/snapshot/${snapshotId}/files`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error('Failed to fetch snapshot files');
  }
  return res.json();
}

export async function restoreSnapshot(token: string, wsId: string, snapshotId: string): Promise<void> {
  const res = await fetch(apiUrl(`/workspace/${wsId}/snapshot/${snapshotId}/restore`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Restore failed' }));
    throw new Error(data.error || 'Restore failed');
  }
}
