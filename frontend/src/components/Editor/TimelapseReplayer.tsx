import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import * as Y from 'yjs';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  X, 
  History, 
  ChevronLeft, 
  ChevronRight, 
  AlertTriangle 
} from 'lucide-react';
import { fetchFileHistory } from '../../api/history';
import { getNexusToken } from '../../lib/tokenStorage';

// =============================================================================
// 1. TYPES & DATA STRUCTURES
// =============================================================================

export type ReplayMode = 'full' | 'legacy';

export interface AuthorInfo {
  userId: string;
  username: string;
  color: string;
}

export type AuthorMap = Record<string, AuthorInfo>;

export interface AuthorRange {
  start: number;
  end: number;
  clientId: number;
}

export interface Snapshot {
  text: string;
  authorRanges: AuthorRange[];
}

export interface BuiltTimeline {
  snapshots: Snapshot[];
  activity: number[];
  allClientIds: number[];
}

export interface TimelapseReplayerProps {
  workspaceId: string;
  fileId: string;
  filename: string;
  language: string;
  onClose: () => void;
}

// =============================================================================
// 2. PURE UTILITIES & MERKLE/CRDT PARSERS
// =============================================================================

const FALLBACK_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899'];

export function fallbackColor(clientId: number): string {
  return FALLBACK_COLORS[Math.abs(clientId) % FALLBACK_COLORS.length];
}

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) || 99;
  const g = parseInt(h.substring(2, 4), 16) || 102;
  const b = parseInt(h.substring(4, 6), 16) || 241;
  return `rgba(${r},${g},${b},${alpha})`;
}

export function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function offsetToPosition(text: string, offset: number): { lineNumber: number; column: number } {
  const lines = text.split('\n');
  let remaining = offset;
  for (let li = 0; li < lines.length; li++) {
    const lineLen = lines[li].length + (li < lines.length - 1 ? 1 : 0);
    if (remaining <= lines[li].length) return { lineNumber: li + 1, column: remaining + 1 };
    remaining -= lineLen;
  }
  return { lineNumber: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 };
}

export function snapshotFromYText(ytext: Y.Text): Snapshot {
  let text = '';
  const ranges: AuthorRange[] = [];
  let runStart = 0;
  let runClient = -1;

  let node: any = (ytext as any)._start;
  while (node !== null) {
    if (!node.deleted) {
      const content = node.content?.getContent?.();
      const str = Array.isArray(content) ? content.join('') : (typeof content === 'string' ? content : '');
      for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        const offset = text.length;
        if (ch === '\n') {
          if (runClient !== -1) { ranges.push({ start: runStart, end: offset, clientId: runClient }); runClient = -1; }
          text += ch;
          runStart = text.length;
        } else {
          if (node.id.client !== runClient) {
            if (runClient !== -1) ranges.push({ start: runStart, end: offset, clientId: runClient });
            runStart = offset;
            runClient = node.id.client;
          }
          text += ch;
        }
      }
    }
    node = node.right;
  }
  if (runClient !== -1 && text.length > runStart) ranges.push({ start: runStart, end: text.length, clientId: runClient });
  return { text, authorRanges: ranges };
}

export function downsampleActivity(activity: number[], buckets = 48): number[] {
  if (activity.length === 0) return new Array(buckets).fill(0);
  if (activity.length <= buckets) {
    const max = Math.max(1, ...activity);
    return activity.map(v => v / max);
  }
  const out = new Array(buckets).fill(0);
  const bucketSize = activity.length / buckets;
  for (let i = 0; i < activity.length; i++) {
    const b = Math.min(buckets - 1, Math.floor(i / bucketSize));
    out[b] += activity[i];
  }
  const max = Math.max(1, ...out);
  return out.map(v => v / max);
}

// Sparse keyframe distance (K = 25 checkpoints)
const KEYFRAME_INTERVAL = 25;

export function buildFullFidelityTimeline(updatesB64: string[]): BuiltTimeline {
  const rawUpdates = updatesB64.map(b64 => base64ToUint8Array(b64));
  const totalFrames = rawUpdates.length;

  const ydoc = new Y.Doc({ gc: false });
  const ytext = ydoc.getText('monaco');

  const keyframes = new Map<number, Snapshot>();
  const activity: number[] = [0];
  let prevLen = 0;

  keyframes.set(0, snapshotFromYText(ytext));

  for (let i = 0; i < rawUpdates.length; i++) {
    Y.applyUpdate(ydoc, rawUpdates[i], 'timelapse-replay');
    const frameIdx = i + 1;
    const curLen = ytext.length;
    activity.push(Math.abs(curLen - prevLen) + 1);
    prevLen = curLen;

    if (frameIdx % KEYFRAME_INTERVAL === 0 || frameIdx === totalFrames) {
      keyframes.set(frameIdx, snapshotFromYText(ytext));
    }
  }

  const allClientIds = new Set<number>();
  let node: any = (ytext as any)._start;
  while (node !== null) { allClientIds.add(node.id.client); node = node.right; }

  // Sparse On-Demand Frame Cache for O(1) Memory Footprint
  const cachedFrames = new Map<number, Snapshot>();
  keyframes.forEach((snap, idx) => cachedFrames.set(idx, snap));

  const getFrame = (frameIdx: number): Snapshot => {
    if (cachedFrames.has(frameIdx)) return cachedFrames.get(frameIdx)!;

    // Start from the closest preceding keyframe checkpoint
    let baseIdx = Math.floor(frameIdx / KEYFRAME_INTERVAL) * KEYFRAME_INTERVAL;
    if (baseIdx < 0) baseIdx = 0;

    const tempDoc = new Y.Doc({ gc: false });
    const tempText = tempDoc.getText('monaco');

    for (let i = 0; i < frameIdx; i++) {
      Y.applyUpdate(tempDoc, rawUpdates[i], 'sparse-replay');
    }

    const snap = snapshotFromYText(tempText);
    cachedFrames.set(frameIdx, snap);
    return snap;
  };

  const snapshots: Snapshot[] = [];
  for (let i = 0; i <= totalFrames; i++) {
    snapshots.push(getFrame(i));
  }

  if (typeof window !== 'undefined') {
    (window as any).__timelapseGetFrame = getFrame;
    (window as any).__timelapseSnapshots = snapshots;
  }

  return { snapshots, activity, allClientIds: Array.from(allClientIds) };
}

export function buildLegacyTimeline(yjsStateB64: string): BuiltTimeline {
  const ydoc = new Y.Doc({ gc: false });
  Y.applyUpdate(ydoc, base64ToUint8Array(yjsStateB64));
  const ytext = ydoc.getText('monaco');

  interface Item {
    str: string;
    clientId: number;
    insertClock: number;
    deleted: boolean;
    deleteClock: number;
  }

  const items: Item[] = [];
  let node: any = (ytext as any)._start;
  while (node !== null) {
    const content = node.content?.getContent?.();
    const str = Array.isArray(content) ? content.join('') : (typeof content === 'string' ? content : '');
    for (let i = 0; i < str.length; i++) {
      items.push({
        str: str[i],
        clientId: node.id.client,
        insertClock: node.id.clock + i,
        deleted: !!node.deleted,
        deleteClock: Infinity,
      });
    }
    node = node.right;
  }

  let i = 0;
  while (i < items.length) {
    if (items[i].deleted) {
      let j = i;
      let localMax = items[i].insertClock;
      while (j < items.length && items[j].deleted && items[j].clientId === items[i].clientId) {
        localMax = Math.max(localMax, items[j].insertClock);
        j++;
      }
      const deleteClock = localMax + 0.5;
      for (let k = i; k < j; k++) items[k].deleteClock = deleteClock;
      i = j;
    } else {
      i++;
    }
  }

  const allClocks = new Set<number>();
  for (const it of items) {
    allClocks.add(it.insertClock);
    if (it.deleteClock !== Infinity) allClocks.add(it.deleteClock);
  }
  const sorted = Array.from(allClocks).sort((a, b) => a - b);
  const seqOf = new Map<number, number>();
  sorted.forEach((c, idx) => seqOf.set(c, idx + 1));
  const maxSeq = sorted.length;

  const snapshots: Snapshot[] = new Array(maxSeq + 1);
  for (let pos = 0; pos <= maxSeq; pos++) {
    let text = '';
    const ranges: AuthorRange[] = [];
    let runStart = 0, runClient = -1;

    for (const it of items) {
      const insSeq = seqOf.get(it.insertClock) ?? Infinity;
      const delSeq = it.deleteClock !== Infinity ? (seqOf.get(it.deleteClock) ?? Infinity) : Infinity;
      if (insSeq <= pos && delSeq > pos) {
        const offset = text.length;
        if (it.str === '\n') {
          if (runClient !== -1) { ranges.push({ start: runStart, end: offset, clientId: runClient }); runClient = -1; }
          text += it.str;
          runStart = text.length;
        } else {
          if (it.clientId !== runClient) {
            if (runClient !== -1) ranges.push({ start: runStart, end: offset, clientId: runClient });
            runStart = offset;
            runClient = it.clientId;
          }
          text += it.str;
        }
      }
    }
    if (runClient !== -1 && text.length > runStart) ranges.push({ start: runStart, end: text.length, clientId: runClient });
    snapshots[pos] = { text, authorRanges: ranges };
  }

  const activity: number[] = new Array(maxSeq + 1).fill(0);
  for (let pos = 1; pos <= maxSeq; pos++) {
    activity[pos] = Math.abs(snapshots[pos].text.length - snapshots[pos - 1].text.length) + 1;
  }

  const allClientIds = Array.from(new Set(items.map(it => it.clientId)));
  return { snapshots, activity, allClientIds };
}

// =============================================================================
// 3. TIMELAPSE PLAYER STATE HOOK
// =============================================================================

export function useTimelapsePlayer({ workspaceId, fileId }: { workspaceId: string; fileId: string }) {
  const [mode, setMode] = useState<ReplayMode>('full');
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [activityBars, setActivityBars] = useState<number[]>([]);
  const [allClientIds, setAllClientIds] = useState<number[]>([]);
  const [maxClock, setMaxClock] = useState(0);
  const [currentClock, setCurrentClock] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [authorMap, setAuthorMap] = useState<AuthorMap>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const prevTextRef = useRef<string | null>(null);

  useEffect(() => {
    (window as any).__timelapseSetClock = (val: number) => {
      setCurrentClock(val);
      setIsPlaying(false);
    };
    return () => { delete (window as any).__timelapseSetClock; };
  }, []);

  // Fetch file history and build timeline
  useEffect(() => {
    let cancelled = false;
    const loadHistory = async () => {
      setIsLoading(true);
      setError(null);
      prevTextRef.current = null;
      try {
        const token = getNexusToken();
        const json = await fetchFileHistory(token, workspaceId, fileId);
        if (cancelled) return;

        let built: BuiltTimeline;
        let resolvedMode: ReplayMode;

        if (json.yjsState) {
          built = buildLegacyTimeline(json.yjsState);
          resolvedMode = 'legacy';
        } else if (json.updates && json.updates.length > 0) {
          built = buildFullFidelityTimeline(json.updates);
          resolvedMode = 'full';
        } else {
          built = { snapshots: [{ text: '', authorRanges: [] }], activity: [0], allClientIds: [] };
          resolvedMode = 'full';
        }

        const maxC = Math.max(0, built.snapshots.length - 1);
        (window as any).__timelapseSnapshots = built.snapshots;

        setSnapshots(built.snapshots);
        setActivityBars(downsampleActivity(built.activity));
        setAllClientIds(built.allClientIds);
        setMode(resolvedMode);
        setMaxClock(maxC);
        setCurrentClock(maxC);
        setAuthorMap(json.authorMap || {});
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? 'Unknown error');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    loadHistory();
    return () => { cancelled = true; };
  }, [workspaceId, fileId]);

  // Playback ticker
  useEffect(() => {
    if (!isPlaying) return;
    const stepSize = Math.max(1, Math.floor(maxClock / 100));
    const interval = setInterval(() => {
      setCurrentClock(prev => {
        const next = prev + stepSize;
        if (next >= maxClock) { setIsPlaying(false); return maxClock; }
        return next;
      });
    }, 50 / speed);
    return () => clearInterval(interval);
  }, [isPlaying, maxClock, speed]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') { e.preventDefault(); setIsPlaying(p => !p); }
      else if (e.code === 'ArrowLeft') { setIsPlaying(false); setCurrentClock(c => Math.max(0, c - 1)); }
      else if (e.code === 'ArrowRight') { setIsPlaying(false); setCurrentClock(c => Math.min(maxClock, c + 1)); }
      else if (e.code === 'Home') { setIsPlaying(false); setCurrentClock(0); }
      else if (e.code === 'End') { setIsPlaying(false); setCurrentClock(maxClock); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [maxClock]);

  // Compute active frame text & decorations
  const frame = useMemo(() => {
    const getFrame = (window as any).__timelapseGetFrame;
    const snap = getFrame ? getFrame(currentClock) : snapshots[currentClock];
    if (!snap) return { text: '', decorationRanges: [] as Array<{ startPos: any; endPos: any; clientId: number }>, authors: [] as Array<{ info: AuthorInfo; clientId: number }> };

    const text = snap.text;
    const decorationRanges = snap.authorRanges.map((r: any) => ({
      startPos: offsetToPosition(text, r.start),
      endPos: offsetToPosition(text, r.end),
      clientId: r.clientId,
    }));

    const seen = new Map<string, { info: AuthorInfo; clientId: number }>();
    for (const r of snap.authorRanges) {
      const key = String(r.clientId);
      if (!seen.has(key)) {
        const info = authorMap[key] ?? {
          userId: key,
          username: `User ${r.clientId}`,
          color: fallbackColor(r.clientId),
        };
        seen.set(key, { info, clientId: r.clientId });
      }
    }
    return { text, decorationRanges, authors: Array.from(seen.values()) };
  }, [snapshots, currentClock, authorMap]);

  return {
    mode,
    snapshots,
    activityBars,
    allClientIds,
    maxClock,
    currentClock,
    isPlaying,
    speed,
    authorMap,
    isLoading,
    error,
    frame,
    prevTextRef,
    togglePlay: useCallback(() => setIsPlaying(p => !p), []),
    rewind: useCallback(() => { setCurrentClock(0); setIsPlaying(false); }, []),
    stepBack: useCallback(() => { setIsPlaying(false); setCurrentClock(c => Math.max(0, c - 1)); }, []),
    stepForward: useCallback(() => { setIsPlaying(false); setCurrentClock(c => Math.min(maxClock, c + 1)); }, [maxClock]),
    cycleSpeed: useCallback(() => setSpeed(s => (s === 4 ? 0.5 : s === 0.5 ? 1 : s === 1 ? 2 : 4)), []),
    seek: useCallback((clock: number) => { setCurrentClock(clock); setIsPlaying(false); }, []),
  };
}

// =============================================================================
// 4. UNIFIED TIMELAPSE REPLAYER UI COMPONENT
// =============================================================================

export default function TimelapseReplayer({
  workspaceId,
  fileId,
  filename,
  language,
  onClose,
}: TimelapseReplayerProps) {
  const player = useTimelapsePlayer({ workspaceId, fileId });

  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const authorDecorIdsRef = useRef<string[]>([]);

  const { text: currentText, decorationRanges, authors: visibleAuthors } = player.frame;

  // Apply per-author decorations when frame changes
  const applyDecorations = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    if (!decorationRanges.length) {
      authorDecorIdsRef.current = editor.deltaDecorations(authorDecorIdsRef.current, []);
      return;
    }

    const newDecorations: Monaco.editor.IModelDeltaDecoration[] = decorationRanges.map((r: any) => {
      const info = player.authorMap[String(r.clientId)];
      const color = info?.color ?? fallbackColor(r.clientId);
      const className = `timelapse-author-${r.clientId}`;
      return {
        range: new monaco.Range(
          r.startPos.lineNumber, r.startPos.column,
          r.endPos.lineNumber, r.endPos.column
        ),
        options: {
          inlineClassName: className,
          hoverMessage: info
            ? { value: `**${info.username}**` }
            : { value: `Client ${r.clientId}` },
        },
      };
    });

    authorDecorIdsRef.current = editor.deltaDecorations(authorDecorIdsRef.current, newDecorations);
  }, [decorationRanges, player.authorMap]);

  useEffect(() => { applyDecorations(); }, [applyDecorations]);

  // Flash newly modified/typed characters
  useEffect(() => {
    const next = currentText;
    const prev = player.prevTextRef.current;
    player.prevTextRef.current = next;
    if (prev === null || prev === next) return;

    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    let start = 0;
    const minLen = Math.min(prev.length, next.length);
    while (start < minLen && prev[start] === next[start]) start++;

    let endPrev = prev.length;
    let endNext = next.length;
    while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
      endPrev--;
      endNext--;
    }

    if (endNext <= start) return;

    const startPos = offsetToPosition(next, start);
    const endPos = offsetToPosition(next, endNext);
    const ids = editor.deltaDecorations([], [{
      range: new monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column),
      options: { inlineClassName: 'timelapse-flash' },
    }]);
    const timer = setTimeout(() => { editor.deltaDecorations(ids, []); }, 450);
    return () => clearTimeout(timer);
  }, [currentText, player.prevTextRef]);

  // Inject author styling rules
  useEffect(() => {
    const styleId = 'timelapse-author-styles';
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }
    const authorRules = player.allClientIds.map((clientId) => {
      const info = player.authorMap[String(clientId)];
      const color = info?.color ?? fallbackColor(clientId);
      return `.timelapse-author-${clientId} { background: ${hexToRgba(color, 0.18)}; border-bottom: 2px solid ${color}; border-radius: 2px; }`;
    });
    styleEl.textContent = [
      ...authorRules,
      `.timelapse-flash { background: rgba(99,102,241,0.45); border-radius: 2px; }`,
      `.timelapse-scrubber { -webkit-appearance: none; appearance: none; background: transparent; height: 14px; }`,
      `.timelapse-scrubber::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: rgba(255,255,255,0.14); }`,
      `.timelapse-scrubber::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 14px; height: 14px; margin-top: -5px; border-radius: 50%; background: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.25); cursor: pointer; }`,
      `.timelapse-scrubber::-moz-range-track { height: 4px; border-radius: 2px; background: rgba(255,255,255,0.14); }`,
      `.timelapse-scrubber::-moz-range-thumb { width: 14px; height: 14px; border: none; border-radius: 50%; background: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.25); cursor: pointer; }`,
    ].join('\n');
  }, [player.authorMap, player.allClientIds]);

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setTimeout(applyDecorations, 100);
  };

  if (player.isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#1e1e1e] text-zinc-400 gap-3">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
        Loading timeline…
      </div>
    );
  }

  if (player.error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-[#1e1e1e] text-red-400 gap-2 px-6 text-center">
        <span className="text-sm font-medium">Failed to load history</span>
        <span className="text-xs text-zinc-500">{player.error}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full bg-ide-bg overflow-hidden shadow-2xl z-50">
      {/* Header Bar */}
      <div className="flex shrink-0 items-center justify-between px-4 py-2 bg-[#2d2d2d] border-b border-white/10">
        <div className="flex items-center gap-3 min-w-0">
          <History size={16} className="text-emerald-400 shrink-0" />
          <span className="text-zinc-300 text-sm font-semibold truncate">{filename}</span>
          <span className="text-emerald-400 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-400/10 border border-emerald-400/20 shrink-0">
            CRDT Timelapse
          </span>
          {player.mode === 'legacy' && (
            <span
              title="This file predates full update logging, so deleted text is placed using an estimate rather than exact history."
              className="text-amber-400 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-400/10 border border-amber-400/20 shrink-0"
            >
              Approximate
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-zinc-400 hover:text-red-400 transition-colors bg-white/5 hover:bg-red-500/20 p-1 rounded ml-2 shrink-0"
          title="Close timelapse"
        >
          <X size={16} />
        </button>
      </div>

      {/* Author Legend */}
      {visibleAuthors.length > 0 && (
        <div
          className="shrink-0 flex items-center gap-3 px-4 py-1.5 bg-ide-bg border-b border-white/[0.06] overflow-x-auto"
          data-testid="author-legend"
        >
          <span className="text-[10px] text-zinc-600 uppercase tracking-wider shrink-0">Authors:</span>
          {visibleAuthors.map(({ info, clientId }) => (
            <div
              key={clientId}
              className="flex items-center gap-1.5 shrink-0"
              data-testid={`author-badge-${info.username}`}
            >
              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: info.color }} />
              <span className="text-[11px] text-zinc-300 font-medium">{info.username}</span>
            </div>
          ))}
        </div>
      )}

      {/* ReadOnly Monaco Canvas */}
      <div className="flex-1 relative min-h-0 bg-ide-bg">
        <Editor
          height="100%"
          language={language}
          theme="vs-dark"
          value={currentText}
          onMount={handleEditorMount}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            domReadOnly: true,
            automaticLayout: true,
            renderValidationDecorations: 'off',
          }}
        />
      </div>

      {/* Timeline Controls & Scrubber */}
      <div className="shrink-0 bg-ide-panel border-t border-white/10">
        <div className="flex items-center gap-2 px-4 pt-3">
          <button
            onClick={player.rewind}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-700 hover:bg-zinc-600 text-white transition-colors shrink-0"
            title="Back to start (Home)"
          >
            <RotateCcw size={14} />
          </button>
          <button
            onClick={player.stepBack}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-700 hover:bg-zinc-600 text-white transition-colors shrink-0"
            title="Step back (←)"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={player.togglePlay}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500 hover:bg-indigo-600 text-white transition-colors shadow-lg shrink-0"
            title={player.isPlaying ? 'Pause (space)' : 'Play (space)'}
          >
            {player.isPlaying ? <Pause size={14} /> : <Play size={14} fill="currentColor" className="ml-0.5" />}
          </button>
          <button
            onClick={player.stepForward}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-700 hover:bg-zinc-600 text-white transition-colors shrink-0"
            title="Step forward (→)"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={player.cycleSpeed}
            className="flex h-8 items-center justify-center rounded-full bg-zinc-700 hover:bg-zinc-600 text-white transition-colors shrink-0 px-2.5 font-mono text-[11px]"
            title="Playback speed"
          >
            {player.speed}x
          </button>

          {/* Activity histogram + Scrubber */}
          <div className="relative flex-1 h-8 flex items-center min-w-0 mx-1">
            <div className="absolute inset-x-0 bottom-1 h-3.5 flex items-end gap-px pointer-events-none">
              {player.activityBars.map((v, i) => (
                <div key={i} className="flex-1 bg-indigo-400/30 rounded-[1px]" style={{ height: `${Math.max(10, v * 100)}%` }} />
              ))}
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(0, player.maxClock)}
              value={player.currentClock}
              onChange={(e) => player.seek(Number(e.target.value))}
              className="timelapse-scrubber relative z-10 w-full cursor-pointer"
            />
          </div>

          <div className="text-[11px] text-zinc-400 font-mono w-24 text-right bg-black/20 py-1 px-2 rounded border border-white/5 shrink-0">
            {player.currentClock} <span className="text-zinc-600">/</span> {player.maxClock}
          </div>
        </div>

        <div className="px-4 pb-2.5 pt-1.5 flex items-center justify-between">
          <span className="text-[10px] text-zinc-600">space play/pause · ←/→ step · home/end jump</span>
          {player.mode === 'legacy' && (
            <span className="text-[10px] text-amber-400/80 flex items-center gap-1">
              <AlertTriangle size={11} /> approximate replay — limited history data
            </span>
          )}
        </div>
      </div>
    </div>
  );
}