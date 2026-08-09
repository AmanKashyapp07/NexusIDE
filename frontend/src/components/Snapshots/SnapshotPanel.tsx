import { useState, useEffect, useCallback, useRef } from 'react';
import { GitBranch, Clock, RotateCcw, FileText, Loader2, X, AlertTriangle, Plus, Minus, Equal, ChevronDown, ChevronUp } from 'lucide-react';
import { apiUrl } from '../../lib/backendUrls';
import { getNexusToken } from '../../lib/tokenStorage';

// =============================================================================
// TYPES
// =============================================================================

interface Snapshot {
  id: string;
  label: string;
  created_at: string;
  created_by: string;
}

interface SnapshotFile {
  path: string;
  language: string | null;
  snapshot_content: string | null;
  live_content: string | null;
}

type DiffLine =
  | { type: 'unchanged'; text: string; lineA: number; lineB: number }
  | { type: 'added'; text: string; lineB: number }
  | { type: 'removed'; text: string; lineA: number };

interface SnapshotPanelProps {
  workspaceId: string;
  userRole: 'admin' | 'editor' | 'viewer';
  onClose: () => void;
  onCreateSnapshot: (label: string) => Promise<void>;
  isCreating: boolean;
  onRestored?: () => void;
}

const styles = {
  overlay: 'fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 bg-black/60 backdrop-blur-sm',
  dialog: 'relative w-full max-w-5xl h-[78vh] flex flex-col rounded-2xl border border-white/[0.08] bg-[#0A0A0C] shadow-2xl overflow-hidden',
  header: 'flex h-12 shrink-0 items-center justify-between border-b border-white/[0.06] px-4 bg-[#0D0D10]',
  leftPanel: 'w-56 shrink-0 flex flex-col border-r border-white/[0.06] overflow-y-auto bg-[#0A0A0C]',
  fileListPanel: 'w-52 shrink-0 flex flex-col border-r border-white/[0.06] overflow-y-auto',
  diffPanel: 'flex min-h-0 flex-1 flex-col overflow-hidden',
  diffHeader: 'flex h-10 shrink-0 items-center justify-between border-b border-white/[0.05] px-4 bg-[#0D0D10]',
  restoreBtn: 'flex items-center gap-1.5 h-7 px-3 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-xs font-medium text-amber-400 border border-amber-500/20 transition-colors ml-4',
  confirmRestoreBtn: 'flex items-center gap-1.5 h-7 px-3 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-bold text-white disabled:opacity-50 transition-colors',
};

// =============================================================================
// DIFF ENGINE — pure Myers LCS diff
// =============================================================================

function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  const m = oldLines.length;
  const n = newLines.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  let i = m, j = n;
  const pending: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      pending.unshift({ type: 'unchanged', text: oldLines[i - 1], lineA: i, lineB: j });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      pending.unshift({ type: 'added', text: newLines[j - 1], lineB: j });
      j--;
    } else {
      pending.unshift({ type: 'removed', text: oldLines[i - 1], lineA: i });
      i--;
    }
  }

  return pending;
}

// =============================================================================
// COLLAPSED DIFF
// =============================================================================

interface CollapsedDiffProps {
  lines: DiffLine[];
}

function CollapsedDiff({ lines }: CollapsedDiffProps) {
  const CONTEXT = 3;
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  type Group = { lines: DiffLine[]; isHidden: boolean; groupIndex: number };
  const groups: Group[] = [];

  const changed = lines.map(l => l.type !== 'unchanged');
  const near = lines.map((_, idx) => {
    for (let d = -CONTEXT; d <= CONTEXT; d++) {
      if (changed[idx + d]) return true;
    }
    return false;
  });

  let current: DiffLine[] = [];
  let currentNear = near[0] ?? true;

  for (let idx = 0; idx < lines.length; idx++) {
    const isNear = near[idx];
    if (isNear !== currentNear) {
      groups.push({ lines: current, isHidden: !currentNear, groupIndex: groups.length });
      current = [];
      currentNear = isNear;
    }
    current.push(lines[idx]);
  }
  if (current.length > 0) {
    groups.push({ lines: current, isHidden: !currentNear, groupIndex: groups.length });
  }

  if (lines.length === 0 || !lines.some(l => l.type !== 'unchanged')) {
    return (
      <div className="flex items-center justify-center py-12 text-zinc-500 text-sm">
        <Equal size={16} className="mr-2" />
        Files are identical
      </div>
    );
  }

  return (
    <div className="font-mono text-xs leading-5">
      {groups.map((group) => {
        if (!group.isHidden) {
          return (
            <div key={group.groupIndex}>
              {group.lines.map((line, li) => (
                <DiffLineRow key={li} line={line} />
              ))}
            </div>
          );
        }
        const isExp = expanded.has(group.groupIndex);
        if (isExp) {
          return (
            <div key={group.groupIndex}>
              <button
                onClick={() => setExpanded(prev => { const s = new Set(prev); s.delete(group.groupIndex); return s; })}
                className="w-full flex items-center gap-1.5 px-4 py-0.5 text-[11px] text-indigo-400 hover:bg-indigo-500/10 transition-colors"
              >
                <ChevronUp size={11} /> Collapse {group.lines.length} unchanged lines
              </button>
              {group.lines.map((line, li) => (
                <DiffLineRow key={li} line={line} />
              ))}
            </div>
          );
        }
        return (
          <button
            key={group.groupIndex}
            onClick={() => setExpanded(prev => new Set(prev).add(group.groupIndex))}
            className="w-full flex items-center gap-1.5 px-4 py-0.5 text-[11px] text-zinc-500 hover:bg-white/5 border-y border-white/[0.04] transition-colors"
          >
            <ChevronDown size={11} />
            <span className="text-zinc-600">···</span>
            <span>{group.lines.length} unchanged lines</span>
            <ChevronDown size={11} />
          </button>
        );
      })}
    </div>
  );
}

function DiffLineRow({ line }: { line: DiffLine }) {
  if (line.type === 'added') {
    return (
      <div className="flex group">
        <span className="w-10 shrink-0 text-right pr-2 text-emerald-700 select-none border-r border-emerald-500/10 bg-emerald-500/5">
          {'lineB' in line ? line.lineB : ''}
        </span>
        <span className="w-6 shrink-0 flex items-center justify-center text-emerald-400 bg-emerald-500/10 select-none">
          <Plus size={10} />
        </span>
        <span className="flex-1 px-2 py-0 bg-emerald-500/[0.07] text-emerald-300 whitespace-pre-wrap break-all">
          {line.text}
        </span>
      </div>
    );
  }
  if (line.type === 'removed') {
    return (
      <div className="flex group">
        <span className="w-10 shrink-0 text-right pr-2 text-red-700 select-none border-r border-red-500/10 bg-red-500/5">
          {'lineA' in line ? line.lineA : ''}
        </span>
        <span className="w-6 shrink-0 flex items-center justify-center text-red-400 bg-red-500/10 select-none">
          <Minus size={10} />
        </span>
        <span className="flex-1 px-2 py-0 bg-red-500/[0.07] text-red-300 whitespace-pre-wrap break-all">
          {line.text}
        </span>
      </div>
    );
  }
  return (
    <div className="flex group">
      <span className="w-10 shrink-0 text-right pr-2 text-zinc-700 select-none border-r border-white/[0.04]">
        {'lineA' in line ? line.lineA : ''}
      </span>
      <span className="w-6 shrink-0 bg-transparent select-none" />
      <span className="flex-1 px-2 py-0 text-zinc-500 whitespace-pre-wrap break-all">
        {line.text}
      </span>
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function SnapshotPanel({ workspaceId, userRole, onClose, onCreateSnapshot, isCreating, onRestored }: SnapshotPanelProps) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedSnapshot, setSelectedSnapshot] = useState<Snapshot | null>(null);
  const [snapshotFiles, setSnapshotFiles] = useState<SnapshotFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [selectedFile, setSelectedFile] = useState<SnapshotFile | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [labelInputOpen, setLabelInputOpen] = useState(false);

  const fetchSnapshots = useCallback(async () => {
    setLoadingList(true);
    try {
      const token = getNexusToken();
      const res = await fetch(apiUrl(`/workspace/${workspaceId}/snapshots`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setSnapshots(await res.json());
    } finally {
      setLoadingList(false);
    }
  }, [workspaceId]);

  useEffect(() => { fetchSnapshots(); }, [fetchSnapshots]);

  // Phase 2: Immutable SWR cache — snapshot file diffs are immutable once created
  const snapshotFilesCacheRef = useRef<Map<string, SnapshotFile[]>>(new Map());

  const abortControllerRef = useRef<AbortController | null>(null);

  const selectSnapshot = useCallback(async (snap: Snapshot) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setSelectedSnapshot(snap);
    setSelectedFile(null);
    setSnapshotFiles([]);
    setRestoreConfirm(false);
    setLoadingFiles(true);
    try {
      // Phase 2: Serve from SWR cache on repeated views (0ms, 0 network requests)
      if (snapshotFilesCacheRef.current.has(snap.id)) {
        const cached = snapshotFilesCacheRef.current.get(snap.id)!;
        setSnapshotFiles(cached);
        if (cached.length > 0) setSelectedFile(cached[0]);
        setLoadingFiles(false);
        return;
      }

      const token = getNexusToken();
      const res = await fetch(apiUrl(`/workspace/${workspaceId}/snapshots/${snap.id}/files`), {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (res.ok) {
        const files: SnapshotFile[] = await res.json();
        snapshotFilesCacheRef.current.set(snap.id, files); // Cache immutable result
        setSnapshotFiles(files);
        if (files.length > 0) setSelectedFile(files[0]);
      }
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') return;
    } finally {
      if (abortControllerRef.current === controller) {
        setLoadingFiles(false);
      }
    }
  }, [workspaceId]);

  const handleRestore = useCallback(async () => {
    if (!selectedSnapshot || restoring) return;
    setRestoring(true);
    try {
      const token = getNexusToken();
      const res = await fetch(apiUrl(`/workspace/${workspaceId}/snapshots/${selectedSnapshot.id}/restore`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setRestoreConfirm(false);
        onClose();
        // Phase 3: Soft state resync — no hard page reload, preserves WebSockets & PTY
        if (onRestored) {
          onRestored();
        } else {
          window.location.reload();
        }
      }
    } finally {
      setRestoring(false);
    }
  }, [selectedSnapshot, workspaceId, onClose, restoring]);

  const handleCreate = useCallback(async () => {
    await onCreateSnapshot(newLabel.trim());
    setNewLabel('');
    setLabelInputOpen(false);
    fetchSnapshots();
  }, [newLabel, onCreateSnapshot, fetchSnapshots]);

  const diffLines: DiffLine[] | null = selectedFile
    ? computeDiff(selectedFile.snapshot_content ?? '', selectedFile.live_content ?? '')
    : null;

  const fileStatus = (f: SnapshotFile) => {
    if (f.snapshot_content === null) return 'new';
    if (f.live_content === null) return 'deleted';
    if (f.snapshot_content === f.live_content) return 'unchanged';
    return 'modified';
  };

  const statusBadge = (s: string) => {
    if (s === 'new') return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">NEW</span>;
    if (s === 'deleted') return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">DEL</span>;
    if (s === 'modified') return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">MOD</span>;
    return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-zinc-700/50 text-zinc-500">—</span>;
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const changedCount = snapshotFiles.filter(f => fileStatus(f) !== 'unchanged').length;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div className="flex items-center gap-2.5">
            <GitBranch size={15} className="text-indigo-400" />
            <span className="text-sm font-semibold text-zinc-100">Snapshot History</span>
            <span className="text-xs text-zinc-600 font-mono">{snapshots.length}/10</span>
          </div>
          <div className="flex items-center gap-2">
            {userRole === 'admin' && (
              labelInputOpen ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={newLabel}
                    onChange={e => setNewLabel(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setLabelInputOpen(false); }}
                    placeholder="Snapshot label (optional)"
                    className="h-7 w-52 rounded-lg bg-white/5 border border-white/10 px-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50"
                  />
                  <button
                    onClick={handleCreate}
                    disabled={isCreating}
                    className="h-7 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white disabled:opacity-50 transition-colors flex items-center gap-1.5"
                  >
                    {isCreating ? <Loader2 size={12} className="animate-spin" /> : null}
                    Save
                  </button>
                  <button onClick={() => setLabelInputOpen(false)} className="h-7 w-7 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-white/5">
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setLabelInputOpen(true)}
                  disabled={isCreating}
                  className="flex items-center gap-1.5 h-7 px-3 rounded-lg bg-indigo-600/80 hover:bg-indigo-600 text-xs font-medium text-white disabled:opacity-50 transition-colors"
                >
                  {isCreating ? <Loader2 size={12} className="animate-spin" /> : <GitBranch size={12} />}
                  New Snapshot
                </button>
              )
            )}
            <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors">
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Snapshot list */}
          <div className={styles.leftPanel}>
            {loadingList ? (
              <div className="flex items-center justify-center flex-1 text-zinc-600 text-sm gap-2">
                <Loader2 size={14} className="animate-spin" /> Loading...
              </div>
            ) : snapshots.length === 0 ? (
              <div className="flex flex-col items-center justify-center flex-1 gap-3 px-4 text-center">
                <GitBranch size={24} className="text-zinc-700" />
                <p className="text-xs text-zinc-600">No snapshots yet.</p>
                {userRole === 'admin' && (
                  <p className="text-xs text-zinc-700">Create one to begin tracking history.</p>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-0.5 p-2">
                {snapshots.map((snap, idx) => (
                  <button
                    key={snap.id}
                    onClick={() => selectSnapshot(snap)}
                    className={`w-full text-left rounded-xl px-3 py-2.5 transition-all ${
                      selectedSnapshot?.id === snap.id
                        ? 'bg-indigo-600/20 border border-indigo-500/30'
                        : 'hover:bg-white/[0.04] border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      {idx === 0 && (
                        <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-indigo-500/20 text-indigo-400 shrink-0">LATEST</span>
                      )}
                      <span className="text-xs font-medium text-zinc-200 truncate">{snap.label}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[11px] text-zinc-600">
                      <Clock size={10} />
                      {formatDate(snap.created_at)}
                    </div>
                    <div className="text-[10px] text-zinc-700 mt-0.5">by {snap.created_by}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right panel: file list + diff */}
          {!selectedSnapshot ? (
            <div className="flex flex-1 items-center justify-center text-zinc-600 text-sm flex-col gap-3">
              <GitBranch size={32} className="text-zinc-800" />
              <span>Select a snapshot to view changes</span>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 overflow-hidden">
              {/* File list */}
              <div className={styles.fileListPanel}>
                <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.05] shrink-0">
                  <FileText size={12} className="text-zinc-600" />
                  <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Files</span>
                  {changedCount > 0 && (
                    <span className="ml-auto text-[10px] text-amber-400 font-bold">{changedCount} changed</span>
                  )}
                </div>
                {loadingFiles ? (
                  <div className="flex items-center justify-center flex-1 text-zinc-600 text-xs gap-1.5">
                    <Loader2 size={12} className="animate-spin" /> Loading...
                  </div>
                ) : (
                  <div className="flex flex-col gap-0.5 p-1.5 overflow-y-auto">
                    {snapshotFiles.map(f => {
                      const s = fileStatus(f);
                      return (
                        <button
                          key={f.path}
                          onClick={() => setSelectedFile(f)}
                          className={`w-full text-left rounded-lg px-2.5 py-2 flex items-center gap-2 transition-all ${
                            selectedFile?.path === f.path
                              ? 'bg-white/[0.07] text-zinc-100'
                              : 'hover:bg-white/[0.04] text-zinc-400'
                          }`}
                        >
                          <FileText size={11} className="shrink-0 text-zinc-600" />
                          <span className="text-[11px] truncate flex-1 text-left">{f.path.split('/').pop()}</span>
                          {statusBadge(s)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Diff viewer */}
              <div className={styles.diffPanel}>
                {!selectedFile ? (
                  <div className="flex flex-1 items-center justify-center text-zinc-700 text-sm">
                    Select a file to view diff
                  </div>
                ) : (
                  <>
                    <div className={styles.diffHeader}>
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText size={12} className="text-zinc-600 shrink-0" />
                        <span className="text-xs font-medium text-zinc-300 truncate">{selectedFile.path}</span>
                        {statusBadge(fileStatus(selectedFile))}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-4">
                        <span className="flex items-center gap-1 text-[10px] text-emerald-500"><Plus size={10} /> Added</span>
                        <span className="flex items-center gap-1 text-[10px] text-red-500"><Minus size={10} /> Removed</span>
                        {userRole === 'admin' && !restoreConfirm && (
                          <button onClick={() => setRestoreConfirm(true)} className={styles.restoreBtn}>
                            <RotateCcw size={11} />
                            Restore to this snapshot
                          </button>
                        )}
                        {userRole === 'admin' && restoreConfirm && (
                          <div className="flex items-center gap-2 ml-4">
                            <AlertTriangle size={12} className="text-amber-400 shrink-0" />
                            <span className="text-[11px] text-amber-400">This will overwrite live files.</span>
                            <button onClick={handleRestore} disabled={restoring} className={styles.confirmRestoreBtn}>
                              {restoring ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                              Confirm Restore
                            </button>
                            <button onClick={() => setRestoreConfirm(false)} className="h-7 px-2 rounded-lg text-xs text-zinc-500 hover:text-zinc-300 hover:bg-white/5">
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {selectedFile.snapshot_content === null ? (
                      <div className="flex flex-1 items-center justify-center flex-col gap-3 text-zinc-600">
                        <Plus size={28} className="text-emerald-700" />
                        <p className="text-sm text-emerald-600">File added after this snapshot</p>
                        <p className="text-xs text-zinc-700">This file did not exist when the snapshot was taken.</p>
                      </div>
                    ) : selectedFile.live_content === null ? (
                      <div className="flex flex-1 items-center justify-center flex-col gap-3 text-zinc-600">
                        <Minus size={28} className="text-red-700" />
                        <p className="text-sm text-red-600">File deleted since this snapshot</p>
                        <p className="text-xs text-zinc-700">This file exists in the snapshot but was removed from the workspace.</p>
                      </div>
                    ) : (
                      <div className="flex-1 overflow-auto bg-[#080809]">
                        {diffLines && <CollapsedDiff lines={diffLines} />}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
