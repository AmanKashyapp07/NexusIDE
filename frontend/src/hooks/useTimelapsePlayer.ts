import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import * as Y from 'yjs';
import { fetchFileHistory, type AuthorMap, type AuthorInfo } from '../api/history';
import { getNexusToken } from '../lib/tokenStorage';

export type ReplayMode = 'full' | 'legacy';

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

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const FALLBACK_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899'];
export function fallbackColor(clientId: number): string {
  return FALLBACK_COLORS[Math.abs(clientId) % FALLBACK_COLORS.length];
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

const KEYFRAME_INTERVAL = 50;

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

  if (typeof window !== 'undefined') {
    (window as any).__sparseTimeline = { totalFrames, keyframes, rawUpdates, activity, allClientIds: Array.from(allClientIds) };
  }

  const USE_FULL_PRECOMPUTE = totalFrames <= 5000;

  if (USE_FULL_PRECOMPUTE) {
    const ydoc2 = new Y.Doc({ gc: false });
    const ytext2 = ydoc2.getText('monaco');
    const snapshots: Snapshot[] = [snapshotFromYText(ytext2)];
    for (const raw of rawUpdates) {
      Y.applyUpdate(ydoc2, raw, 'timelapse-replay');
      snapshots.push(snapshotFromYText(ytext2));
    }
    return { snapshots, activity, allClientIds: Array.from(allClientIds) };
  }

  const snapshots: Snapshot[] = new Array(totalFrames + 1);
  for (const [idx, snap] of keyframes.entries()) {
    snapshots[idx] = snap;
  }

  (window as any).__timelapseGetFrame = (frameIdx: number): Snapshot => {
    if (snapshots[frameIdx]) return snapshots[frameIdx];

    let keyframeIdx = frameIdx - (frameIdx % KEYFRAME_INTERVAL);
    if (keyframeIdx > frameIdx) keyframeIdx -= KEYFRAME_INTERVAL;
    if (keyframeIdx < 0) keyframeIdx = 0;

    const tempDoc = new Y.Doc({ gc: false });
    const tempText = tempDoc.getText('monaco');

    for (let i = 0; i < keyframeIdx; i++) {
      Y.applyUpdate(tempDoc, rawUpdates[i], 'sparse-replay');
    }
    for (let i = keyframeIdx; i < frameIdx; i++) {
      Y.applyUpdate(tempDoc, rawUpdates[i], 'sparse-replay');
    }

    const snap = snapshotFromYText(tempText);
    snapshots[frameIdx] = snap;
    return snap;
  };

  const lastSnap = keyframes.get(totalFrames) ?? { text: '', authorRanges: [] };
  for (let i = 0; i <= totalFrames; i++) {
    if (!snapshots[i]) snapshots[i] = lastSnap;
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

interface UseTimelapsePlayerOptions {
  workspaceId: string;
  fileId: string;
}

export function useTimelapsePlayer({ workspaceId, fileId }: UseTimelapsePlayerOptions) {
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

  // Fetch history
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
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); setIsPlaying(p => !p); }
      else if (e.code === 'ArrowLeft') { setIsPlaying(false); setCurrentClock(c => Math.max(0, c - 1)); }
      else if (e.code === 'ArrowRight') { setIsPlaying(false); setCurrentClock(c => Math.min(maxClock, c + 1)); }
      else if (e.code === 'Home') { setIsPlaying(false); setCurrentClock(0); }
      else if (e.code === 'End') { setIsPlaying(false); setCurrentClock(maxClock); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [maxClock]);

  // Compute active frame
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

  // Control handlers
  const togglePlay = useCallback(() => setIsPlaying(p => !p), []);
  const rewind = useCallback(() => { setCurrentClock(0); setIsPlaying(false); }, []);
  const stepBack = useCallback(() => { setIsPlaying(false); setCurrentClock(c => Math.max(0, c - 1)); }, []);
  const stepForward = useCallback(() => { setIsPlaying(false); setCurrentClock(c => Math.min(maxClock, c + 1)); }, [maxClock]);
  const cycleSpeed = useCallback(() => setSpeed(s => (s === 4 ? 0.5 : s === 0.5 ? 1 : s === 1 ? 2 : 4)), []);
  const seek = useCallback((clock: number) => { setCurrentClock(clock); setIsPlaying(false); }, []);

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
    togglePlay,
    rewind,
    stepBack,
    stepForward,
    cycleSpeed,
    seek,
  };
}
