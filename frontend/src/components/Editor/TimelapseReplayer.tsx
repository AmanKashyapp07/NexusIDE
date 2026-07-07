import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import * as Y from 'yjs';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { Play, Pause, RotateCcw, X, History, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { apiUrl } from '../../lib/backendUrls';

// =============================================================================
// WHY THIS FILE CHANGED
// -----------------------------------------------------------------------------
// The old replayer reconstructed a fake "delete clock" for every tombstoned
// character by starting at `maxInsertClock + 1` — i.e. it assumed every
// deletion in the file's history happened AFTER every insertion. Yjs's merged
// CRDT state has no record of *when* a delete happened, only *what* was
// deleted, so that assumption was standing in for real data. In practice
// people delete text constantly while they type (typo -> backspace -> retype),
// so anchoring every deletion at "the end of time" meant the replay showed the
// dirty, pre-correction text (e.g. "hewlllo") for most of the scrub range,
// only cleaning it up in the last few frames. That's the bug that was reported.
//
// Two things changed here:
//
// 1. Preferred path — full fidelity. If the backend sends the raw stream of
//    Yjs updates (`updates: string[]`, base64, in the order they were
//    received) instead of just the final merged state, we replay them by
//    applying each update to a fresh Y.Doc in order and reading the live text
//    after each one. That's exactly what happened, in the order it happened —
//    no heuristics, no synthetic clocks. This requires a small backend change
//    (see the note at the end of my reply) to start persisting that stream;
//    it only benefits edits captured after the change ships.
//
// 2. Fallback path — legacy files that only have the final `yjsState` blob.
//    We still can't know exact deletion timing here, so this is and remains
//    an approximation. But it's a much better one: each deleted run is now
//    anchored right after its OWN last insertion (the "type a typo, notice it,
//    fix it" pattern), instead of after every insertion in the entire file.
//    The UI flags this mode explicitly so nobody mistakes it for exact history.
// =============================================================================

// =============================================================================
// Types
// =============================================================================

interface AuthorInfo {
  userId:   string;
  username: string;
  color:    string;
}

type AuthorMap = Record<string, AuthorInfo>;

interface AuthorRange {
  start:    number;
  end:      number;
  clientId: number;
}

interface Snapshot {
  text:         string;
  authorRanges: AuthorRange[];
}

interface HistoryResponse {
  authorMap: AuthorMap;
  /** Preferred: ordered base64 Yjs update diffs, true chronological order. */
  updates?:  string[];
  /** Legacy: final merged CRDT state only — replay is an approximation. */
  yjsState?: string;
}

interface TimelapseReplayerProps {
  workspaceId: string;
  fileId:      string;
  filename:    string;
  language:    string;
  onClose:     () => void;
}

type ReplayMode = 'full' | 'legacy';

// =============================================================================
// Colour helpers
// =============================================================================

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const FALLBACK_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#3b82f6','#a855f7','#ec4899'];
function fallbackColor(clientId: number): string {
  return FALLBACK_COLORS[Math.abs(clientId) % FALLBACK_COLORS.length];
}

// =============================================================================
// Small pure helpers shared by both replay paths
// =============================================================================

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function offsetToPosition(text: string, offset: number): { lineNumber: number; column: number } {
  const lines = text.split('\n');
  let remaining = offset;
  for (let li = 0; li < lines.length; li++) {
    const lineLen = lines[li].length + (li < lines.length - 1 ? 1 : 0);
    if (remaining <= lines[li].length) return { lineNumber: li + 1, column: remaining + 1 };
    remaining -= lineLen;
  }
  return { lineNumber: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 };
}

/** Walks a Y.Text's live (non-tombstoned) items into a flat string + author runs. */
function snapshotFromYText(ytext: Y.Text): Snapshot {
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

interface BuiltTimeline {
  snapshots:     Snapshot[];
  activity:      number[]; // edit "size" per step, for the scrubber heatmap
  allClientIds:  number[];
}

// -----------------------------------------------------------------------------
// PREFERRED: replay the true update stream. Perfectly ordered — no heuristics.
// -----------------------------------------------------------------------------
function buildFullFidelityTimeline(updatesB64: string[]): BuiltTimeline {
  const ydoc  = new Y.Doc({ gc: false });
  const ytext = ydoc.getText('monaco');

  const snapshots: Snapshot[] = [snapshotFromYText(ytext)];
  const activity:  number[]   = [0];
  let prevLen = 0;

  for (const b64 of updatesB64) {
    Y.applyUpdate(ydoc, base64ToUint8Array(b64), 'timelapse-replay');
    const snap = snapshotFromYText(ytext);
    snapshots.push(snap);
    activity.push(Math.abs(snap.text.length - prevLen) + 1);
    prevLen = snap.text.length;
  }

  const allClientIds = new Set<number>();
  let node: any = (ytext as any)._start;
  while (node !== null) { allClientIds.add(node.id.client); node = node.right; }

  return { snapshots, activity, allClientIds: Array.from(allClientIds) };
}

// -----------------------------------------------------------------------------
// FALLBACK: only the final merged state is available. We can recover true
// insertion order (Yjs preserves that per-client), but not true deletion
// timing. Anchor each deleted run right after its own last insertion instead
// of after every insertion in the file — an approximation, not exact history.
// -----------------------------------------------------------------------------
function buildLegacyTimeline(yjsStateB64: string): BuiltTimeline {
  const ydoc = new Y.Doc({ gc: false });
  Y.applyUpdate(ydoc, base64ToUint8Array(yjsStateB64));
  const ytext = ydoc.getText('monaco');

  interface Item {
    str:         string;
    clientId:    number;
    insertClock: number;
    deleted:     boolean;
    deleteClock: number;
  }

  const items: Item[] = [];
  let node: any = (ytext as any)._start;
  while (node !== null) {
    const content = node.content?.getContent?.();
    const str = Array.isArray(content) ? content.join('') : (typeof content === 'string' ? content : '');
    for (let i = 0; i < str.length; i++) {
      items.push({
        str:         str[i],
        clientId:    node.id.client,
        insertClock: node.id.clock + i,
        deleted:     !!node.deleted,
        deleteClock: Infinity,
      });
    }
    node = node.right;
  }

  // Anchor each contiguous deleted run (same author, adjacent in the doc)
  // to just after ITS OWN last insertion, not after the whole file's max clock.
  let i = 0;
  while (i < items.length) {
    if (items[i].deleted) {
      let j = i;
      let localMax = items[i].insertClock;
      while (j < items.length && items[j].deleted && items[j].clientId === items[i].clientId) {
        localMax = Math.max(localMax, items[j].insertClock);
        j++;
      }
      const deleteClock = localMax + 0.5; // sorts right after this run, before later inserts
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

/** Downsamples a per-step activity array into a fixed number of bars for the scrubber. */
function downsampleActivity(activity: number[], buckets = 48): number[] {
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

// =============================================================================
// Component
// =============================================================================

export default function TimelapseReplayer({
  workspaceId,
  fileId,
  filename,
  language,
  onClose,
}: TimelapseReplayerProps) {
  const [mode, setMode]               = useState<ReplayMode>('full');
  const [snapshots, setSnapshots]     = useState<Snapshot[]>([]);
  const [activityBars, setActivityBars] = useState<number[]>([]);
  const [allClientIds, setAllClientIds] = useState<number[]>([]);
  const [maxClock, setMaxClock]       = useState(0);
  const [currentClock, setCurrentClock] = useState(0);
  const [isPlaying, setIsPlaying]     = useState(false);
  const [speed, setSpeed]             = useState(1);
  const [authorMap, setAuthorMap]     = useState<AuthorMap>({});
  const [isLoading, setIsLoading]     = useState(true);
  const [error, setError]             = useState<string | null>(null);

  useEffect(() => {
    (window as any).__timelapseSetClock = (val: number) => {
      setCurrentClock(val);
      setIsPlaying(false);
    };
    return () => { delete (window as any).__timelapseSetClock; };
  }, []);

  const editorRef         = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef         = useRef<typeof Monaco | null>(null);
  const authorDecorIdsRef = useRef<string[]>([]);
  const prevTextRef       = useRef<string | null>(null);

  // ── Fetch history ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const fetchHistory = async () => {
      setIsLoading(true);
      setError(null);
      prevTextRef.current = null; // don't flash-diff against a previous file
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(apiUrl(`/workspace/${workspaceId}/files/${fileId}/history`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`History fetch failed (${res.status}): ${text}`);
        }

        const json = await res.json() as HistoryResponse;
        if (cancelled) return;

        let built: BuiltTimeline;
        let resolvedMode: ReplayMode;

        if (json.updates && json.updates.length > 0) {
          built = buildFullFidelityTimeline(json.updates);
          resolvedMode = 'full';
        } else if (json.yjsState) {
          built = buildLegacyTimeline(json.yjsState);
          resolvedMode = 'legacy';
        } else {
          built = { snapshots: [{ text: '', authorRanges: [] }], activity: [0], allClientIds: [] };
          resolvedMode = 'full';
        }

        const maxC = built.snapshots.length - 1;
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
    fetchHistory();
    return () => { cancelled = true; };
  }, [workspaceId, fileId]);

  // ── Playback ticker ────────────────────────────────────────────────────────
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

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      if (e.code === 'Space')      { e.preventDefault(); setIsPlaying(p => !p); }
      else if (e.code === 'ArrowLeft')  { setIsPlaying(false); setCurrentClock(c => Math.max(0, c - 1)); }
      else if (e.code === 'ArrowRight') { setIsPlaying(false); setCurrentClock(c => Math.min(maxClock, c + 1)); }
      else if (e.code === 'Home')  { setIsPlaying(false); setCurrentClock(0); }
      else if (e.code === 'End')   { setIsPlaying(false); setCurrentClock(maxClock); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [maxClock]);

  // ── Single source of truth for "what's on screen right now" ────────────────
  const frame = useMemo(() => {
    const snap = snapshots[currentClock];
    if (!snap) return { text: '', decorationRanges: [] as Array<{ startPos: any; endPos: any; clientId: number }>, authors: [] as Array<{ info: AuthorInfo; clientId: number }> };

    const text = snap.text;
    const decorationRanges = snap.authorRanges.map(r => ({
      startPos: offsetToPosition(text, r.start),
      endPos:   offsetToPosition(text, r.end),
      clientId: r.clientId,
    }));

    const seen = new Map<string, { info: AuthorInfo; clientId: number }>();
    for (const r of snap.authorRanges) {
      const key = String(r.clientId);
      if (!seen.has(key)) {
        const info = authorMap[key] ?? {
          userId:   key,
          username: `User ${r.clientId}`,
          color:    fallbackColor(r.clientId),
        };
        seen.set(key, { info, clientId: r.clientId });
      }
    }
    return { text, decorationRanges, authors: Array.from(seen.values()) };
  }, [snapshots, currentClock, authorMap]);

  const { text: currentText, decorationRanges, authors: visibleAuthors } = frame;

  // ── Apply per-author decorations whenever the frame changes ────────────────
  const applyDecorations = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    if (!decorationRanges.length) {
      authorDecorIdsRef.current = editor.deltaDecorations(authorDecorIdsRef.current, []);
      return;
    }

    const newDecorations: Monaco.editor.IModelDeltaDecoration[] = decorationRanges.map(r => {
      const info = authorMap[String(r.clientId)];
      const color = info?.color ?? fallbackColor(r.clientId);
      const className = `timelapse-author-${r.clientId}`;
      return {
        range: new monaco.Range(
          r.startPos.lineNumber, r.startPos.column,
          r.endPos.lineNumber,   r.endPos.column
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
  }, [decorationRanges, authorMap]);

  useEffect(() => { applyDecorations(); }, [applyDecorations]);

  // ── Briefly flash newly-inserted text so scrubbing reads as a replay ───────
  useEffect(() => {
    const next = currentText;
    const prev = prevTextRef.current;
    prevTextRef.current = next;
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

    if (endNext <= start) return; // this step was a pure deletion — nothing new to flash

    const startPos = offsetToPosition(next, start);
    const endPos   = offsetToPosition(next, endNext);
    const ids = editor.deltaDecorations([], [{
      range: new monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column),
      options: { inlineClassName: 'timelapse-flash' },
    }]);
    const timer = setTimeout(() => { editor.deltaDecorations(ids, []); }, 450);
    return () => clearTimeout(timer);
  }, [currentText]);

  // ── Inject author + flash + scrubber styles ─────────────────────────────────
  useEffect(() => {
    const styleId = 'timelapse-author-styles';
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }
    const authorRules = allClientIds.map(clientId => {
      const info  = authorMap[String(clientId)];
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
  }, [authorMap, allClientIds]);

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setTimeout(applyDecorations, 100);
  };

  // ── Transport controls ──────────────────────────────────────────────────────
  const togglePlay   = () => setIsPlaying(p => !p);
  const rewind       = () => { setCurrentClock(0); setIsPlaying(false); };
  const stepBack     = () => { setIsPlaying(false); setCurrentClock(c => Math.max(0, c - 1)); };
  const stepForward  = () => { setIsPlaying(false); setCurrentClock(c => Math.min(maxClock, c + 1)); };
  const cycleSpeed   = () => setSpeed(s => (s === 4 ? 0.5 : s === 0.5 ? 1 : s === 1 ? 2 : 4));

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#1e1e1e] text-zinc-400 gap-3">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
        Loading timeline…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-[#1e1e1e] text-red-400 gap-2 px-6 text-center">
        <span className="text-sm font-medium">Failed to load history</span>
        <span className="text-xs text-zinc-500">{error}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full bg-[#1e1e1e] overflow-hidden shadow-2xl z-50">
      <div className="flex shrink-0 items-center justify-between px-4 py-2 bg-[#2d2d2d] border-b border-white/10">
        <div className="flex items-center gap-3 min-w-0">
          <History size={16} className="text-emerald-400 shrink-0" />
          <span className="text-zinc-300 text-sm font-semibold truncate">{filename}</span>
          <span className="text-emerald-400 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-400/10 border border-emerald-400/20 shrink-0">
            CRDT Timelapse
          </span>
          {mode === 'legacy' && (
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

      {visibleAuthors.length > 0 && (
        <div
          className="shrink-0 flex items-center gap-3 px-4 py-1.5 bg-[#1e1e1e] border-b border-white/[0.06] overflow-x-auto"
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

      <div className="flex-1 relative min-h-0 bg-[#1e1e1e]">
        <Editor
          height="100%"
          language={language}
          theme="vs-dark"
          value={currentText}
          onMount={handleEditorMount}
          options={{
            readOnly:              true,
            minimap:               { enabled: false },
            scrollBeyondLastLine:  false,
            wordWrap:              'on',
            domReadOnly:           true,
            automaticLayout:       true,
            renderValidationDecorations: 'off',
          }}
        />
      </div>

      <div className="shrink-0 bg-[#252526] border-t border-white/10">
        <div className="flex items-center gap-2 px-4 pt-3">
          <button
            onClick={rewind}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-700 hover:bg-zinc-600 text-white transition-colors shrink-0"
            title="Back to start (Home)"
          >
            <RotateCcw size={14} />
          </button>
          <button
            onClick={stepBack}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-700 hover:bg-zinc-600 text-white transition-colors shrink-0"
            title="Step back (←)"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={togglePlay}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500 hover:bg-indigo-600 text-white transition-colors shadow-lg shrink-0"
            title={isPlaying ? 'Pause (space)' : 'Play (space)'}
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} fill="currentColor" className="ml-0.5" />}
          </button>
          <button
            onClick={stepForward}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-700 hover:bg-zinc-600 text-white transition-colors shrink-0"
            title="Step forward (→)"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={cycleSpeed}
            className="flex h-8 items-center justify-center rounded-full bg-zinc-700 hover:bg-zinc-600 text-white transition-colors shrink-0 px-2.5 font-mono text-[11px]"
            title="Playback speed"
          >
            {speed}x
          </button>

          <div className="relative flex-1 h-8 flex items-center min-w-0 mx-1">
            <div className="absolute inset-x-0 bottom-1 h-3.5 flex items-end gap-px pointer-events-none">
              {activityBars.map((v, i) => (
                <div key={i} className="flex-1 bg-indigo-400/30 rounded-[1px]" style={{ height: `${Math.max(10, v * 100)}%` }} />
              ))}
            </div>
            <input
              type="range"
              min={0}
              max={maxClock}
              value={currentClock}
              onChange={e => { setCurrentClock(Number(e.target.value)); setIsPlaying(false); }}
              className="timelapse-scrubber relative z-10 w-full cursor-pointer"
            />
          </div>

          <div className="text-[11px] text-zinc-400 font-mono w-24 text-right bg-black/20 py-1 px-2 rounded border border-white/5 shrink-0">
            {currentClock} <span className="text-zinc-600">/</span> {maxClock}
          </div>
        </div>

        <div className="px-4 pb-2.5 pt-1.5 flex items-center justify-between">
          <span className="text-[10px] text-zinc-600">space play/pause · ←/→ step · home/end jump</span>
          {mode === 'legacy' && (
            <span className="text-[10px] text-amber-400/80 flex items-center gap-1">
              <AlertTriangle size={11} /> approximate replay — limited history data
            </span>
          )}
        </div>
      </div>
    </div>
  );
}