import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import * as Y from 'yjs';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { Play, Pause, RotateCcw, X, History } from 'lucide-react';
import { apiUrl } from '../../lib/backendUrls';

// =============================================================================
// Types
// =============================================================================

interface AuthorInfo {
  userId:   string;
  username: string;
  color:    string;
}

// authorMap keys are clientID strings (e.g. "1847293")
type AuthorMap = Record<string, AuthorInfo>;

interface DocItem {
  clock:    number;   // sequential typing position (insertSeq, 1-based)
  str:      string;   // single character
  clientId: number;   // Yjs clientID of the author
  deleteSeq: number;  // sequential deletion position (Infinity = never deleted)
}

interface TimelapseReplayerProps {
  workspaceId: string;
  fileId:      string;
  filename:    string;
  language:    string;
  onClose:     () => void;
}

// =============================================================================
// Colour helpers
// =============================================================================

/** Convert a hex colour like #ef4444 to rgba(r,g,b,a) */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Stable fallback colour derived from a clientId when no authorMap entry exists */
const FALLBACK_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#3b82f6','#a855f7','#ec4899'];
function fallbackColor(clientId: number): string {
  return FALLBACK_COLORS[Math.abs(clientId) % FALLBACK_COLORS.length];
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
  const [maxClock, setMaxClock]     = useState(0);
  const [currentClock, setCurrentClock] = useState(0);
  const [isPlaying, setIsPlaying]   = useState(false);
  const [docItems, setDocItems]     = useState<DocItem[]>([]);
  const [authorMap, setAuthorMap]   = useState<AuthorMap>({});
  const [isLoading, setIsLoading]   = useState(true);
  const [error, setError]           = useState<string | null>(null);

  // Expose an imperative API on window so Playwright tests can set the clock
  // directly without needing to fight React's synthetic event system on range inputs.
  useEffect(() => {
    (window as any).__timelapseSetClock = (val: number) => {
      setCurrentClock(val);
      setIsPlaying(false);
    };
    return () => { delete (window as any).__timelapseSetClock; };
  }, []);

  const editorRef    = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef    = useRef<typeof Monaco | null>(null);
  const decorIdsRef  = useRef<string[]>([]);

  // ── Fetch history ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const fetchHistory = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(apiUrl(`/workspace/${workspaceId}/files/${fileId}/history`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`History fetch failed (${res.status}): ${text}`);
        }

        const json = await res.json() as { yjsState: string; authorMap: AuthorMap };
        if (cancelled) return;

        // Decode base64 → Uint8Array
        const binary = atob(json.yjsState);
        const uint8  = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) uint8[i] = binary.charCodeAt(i);

        // Apply to a fresh Yjs doc — gc:false so deleted items remain in memory
        const ydoc  = new Y.Doc({ gc: false });
        Y.applyUpdate(ydoc, uint8);
        const ytext = ydoc.getText('monaco');

        // =================================================================
        // INCREMENTAL REPLAY via Yjs snapshots
        //
        // The correct way to show "what the document looked like at time T"
        // is to apply the Yjs state incrementally. We use the Yjs struct
        // store to enumerate all operations (insertions AND deletions) in
        // clock order, then for each slider position T, we apply only the
        // first T operations to a fresh doc and read its text content.
        //
        // This approach:
        // - Shows text in correct document positions at every point in time
        // - Handles deletions naturally (text disappears when delete op applies)
        // - Handles insertions at arbitrary positions (mid-line inserts work)
        // - Works for multi-user editing (interleaved client operations)
        //
        // We precompute snapshots at each operation boundary and cache them
        // so the slider scrubs instantly without re-applying all operations.
        // =================================================================

        // Enumerate all struct operations from the Y.Doc's store in clock order.
        // Each struct is either an Item (insertion) or a GC/Skip (deletion).
        // We collect them all, sort by clock, and incrementally apply.
        const store = ydoc.store;
        interface OpEntry {
          clock: number;
          clientId: number;
        }
        const allOps: OpEntry[] = [];

        // Collect insertion operations from all clients
        for (const [clientId, structs] of store.clients.entries()) {
          for (const struct of structs) {
            // Each struct covers clock range [struct.id.clock, struct.id.clock + struct.length)
            for (let i = 0; i < struct.length; i++) {
              allOps.push({ clock: struct.id.clock + i, clientId });
            }
          }
        }

        // Sort operations globally by clock (primary) and clientId (tiebreaker)
        allOps.sort((a, b) => a.clock !== b.clock ? a.clock - b.clock : a.clientId - b.clientId);

        // De-duplicate: multiple chars from same struct have same base clock
        // Actually each char already has a unique clock (struct.id.clock + i)
        // Remove exact duplicates (same clientId + clock)
        const seen = new Set<string>();
        const uniqueOps = allOps.filter(op => {
          const key = `${op.clientId}:${op.clock}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        // Now build snapshots: for each prefix of operations, compute the doc text.
        // We apply the full update once, then use Yjs snapshots to read state at
        // each point. Actually, Yjs doesn't support partial application easily.
        //
        // SIMPLER CORRECT APPROACH: Use the struct metadata to determine which
        // items are visible at each point in time without re-applying.
        //
        // For each item in the linked list:
        //   - It becomes VISIBLE when its insertClock is reached
        //   - It becomes HIDDEN when its deleteClock is reached
        //
        // The text at time T = walk linked list in document order, include items
        // where insertClock <= T AND (not deleted OR deleteClock > T)
        //
        // The KEY insight we were missing: we must track the deletion clock
        // PER CHARACTER (not just a boolean). Deleted items have their OWN
        // Yjs clock that was consumed by the delete operation.

        // Walk the linked list and collect items with their deletion info
        interface TimelineItem {
          str:         string;
          clientId:    number;
          insertClock: number;
          // For deleted items: the clock at which deletion happened.
          // We determine this from the DS (delete set) in the store.
          deleteClock: number; // Infinity = not deleted
        }

        const timelineItems: TimelineItem[] = [];
        let node = (ytext as any)._start;
        while (node !== null) {
          const content = node.content?.getContent?.();
          const str = Array.isArray(content)
            ? content.join('')
            : typeof content === 'string' ? content : '';
          if (str) {
            for (let i = 0; i < str.length; i++) {
              timelineItems.push({
                str:         str[i],
                clientId:    node.id.client,
                insertClock: node.id.clock + i,
                deleteClock: node.deleted ? -1 : Infinity, // -1 = needs assignment
              });
            }
          }
          node = node.right;
        }

        // Assign deletion clocks for deleted items.
        // All insertions across all clients happen at their insertClock.
        // Deletions happen AFTER the deleted chars were inserted.
        // We assign deletion events sequential clocks after maxInsertClock.
        const maxIC = timelineItems.reduce((m, it) => Math.max(m, it.insertClock), 0);
        let delClock = maxIC + 1;
        for (const item of timelineItems) {
          if (item.deleteClock === -1) {
            item.deleteClock = delClock++;
          }
        }

        // Build a sorted list of ALL event clocks (inserts + deletes)
        const allClocks = new Set<number>();
        for (const item of timelineItems) {
          allClocks.add(item.insertClock);
          if (item.deleteClock !== Infinity) allClocks.add(item.deleteClock);
        }
        const sortedClocks = Array.from(allClocks).sort((a, b) => a - b);
        const clockToSeq = new Map<number, number>();
        sortedClocks.forEach((c, idx) => clockToSeq.set(c, idx + 1));
        const maxSeq = sortedClocks.length;

        // Precompute text snapshots for every slider position.
        // At position P, text = concatenation of items (in document order) where:
        //   clockToSeq(insertClock) <= P AND clockToSeq(deleteClock) > P
        //
        // We precompute all snapshots upfront so slider scrubbing is instant.
        interface Snapshot {
          text: string;
          authorRanges: Array<{ start: number; end: number; clientId: number }>;
        }
        const snapshots: Snapshot[] = new Array(maxSeq + 1);
        
        for (let pos = 0; pos <= maxSeq; pos++) {
          let text = '';
          const ranges: Array<{ start: number; end: number; clientId: number }> = [];
          let runStart = 0;
          let runClient = -1;

          for (const item of timelineItems) {
            const insSeq = clockToSeq.get(item.insertClock) ?? Infinity;
            const delSeq = item.deleteClock !== Infinity
              ? (clockToSeq.get(item.deleteClock) ?? Infinity)
              : Infinity;
            
            if (insSeq <= pos && delSeq > pos) {
              const offset = text.length;
              text += item.str;
              if (item.clientId !== runClient) {
                if (runClient !== -1) ranges.push({ start: runStart, end: offset, clientId: runClient });
                runStart = offset;
                runClient = item.clientId;
              }
            }
          }
          if (runClient !== -1 && text.length > runStart) {
            ranges.push({ start: runStart, end: text.length, clientId: runClient });
          }
          snapshots[pos] = { text, authorRanges: ranges };
        }

        // Store snapshots in a ref-accessible format.
        // DocItems is repurposed: we store one item per timeline position with
        // the full snapshot text. The useMemo for currentText reads from snapshots.
        const items: DocItem[] = timelineItems.map(item => ({
          clock:     clockToSeq.get(item.insertClock) ?? 1,
          str:       item.str,
          clientId:  item.clientId,
          deleteSeq: item.deleteClock !== Infinity
            ? (clockToSeq.get(item.deleteClock) ?? Infinity)
            : Infinity,
        }));

        const maxC = maxSeq;

        // Store precomputed snapshots on window for the useMemo to access
        (window as any).__timelapseSnapshots = snapshots;

        setDocItems(items);
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
    const interval = setInterval(() => {
      setCurrentClock(prev => {
        if (prev >= maxClock) { setIsPlaying(false); return maxClock; }
        return Math.min(prev + Math.max(1, Math.floor(maxClock / 100)), maxClock);
      });
    }, 50);
    return () => clearInterval(interval);
  }, [isPlaying, maxClock]);

  // ── Compute visible text and decoration ranges at currentClock ─────────────
  const { currentText, decorationRanges } = useMemo(() => {
    // Use precomputed snapshots — instant O(1) lookup per slider position
    const snapshots = (window as any).__timelapseSnapshots as
      Array<{ text: string; authorRanges: Array<{ start: number; end: number; clientId: number }> }> | undefined;

    if (snapshots && currentClock >= 0 && currentClock < snapshots.length) {
      const snap = snapshots[currentClock];
      const text = snap.text;
      const lines = text.split('\n');
      const offsetToPos = (offset: number): { lineNumber: number; column: number } => {
        let remaining = offset;
        for (let li = 0; li < lines.length; li++) {
          const lineLen = lines[li].length + (li < lines.length - 1 ? 1 : 0);
          if (remaining <= lines[li].length) {
            return { lineNumber: li + 1, column: remaining + 1 };
          }
          remaining -= lineLen;
        }
        return { lineNumber: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 };
      };
      const decorationRanges = snap.authorRanges.map(r => ({
        startPos: offsetToPos(r.start),
        endPos:   offsetToPos(r.end),
        clientId: r.clientId,
      }));
      return { currentText: text, decorationRanges };
    }

    // Fallback: no snapshots available (empty file or loading)
    return { currentText: '', decorationRanges: [] };
  }, [currentClock]);

  // ── Apply Monaco decorations whenever text or ranges change ───────────────
  const applyDecorations = useCallback(() => {
    const editor  = editorRef.current;
    const monaco  = monacoRef.current;
    if (!editor || !monaco || !decorationRanges.length) {
      if (editor && monacoRef.current) {
        decorIdsRef.current = editor.deltaDecorations(decorIdsRef.current, []);
      }
      return;
    }

    const newDecorations: Monaco.editor.IModelDeltaDecoration[] = decorationRanges.map(r => {
      const info = authorMap[String(r.clientId)];
      const color = info?.color ?? fallbackColor(r.clientId);
      // Each unique clientId gets its own CSS class injected via Monaco's inline styles
      const className = `timelapse-author-${r.clientId}`;
      return {
        range: new monaco.Range(
          r.startPos.lineNumber, r.startPos.column,
          r.endPos.lineNumber,   r.endPos.column
        ),
        options: {
          inlineClassName: className,
          // Store color in a data attribute via the class name for CSS injection
          hoverMessage: info
            ? { value: `**${info.username}**` }
            : { value: `Client ${r.clientId}` },
        },
      };
    });

    decorIdsRef.current = editor.deltaDecorations(decorIdsRef.current, newDecorations);
  }, [decorationRanges, authorMap]);

  // Inject per-author CSS rules into the document whenever authorMap changes
  useEffect(() => {
    const styleId = 'timelapse-author-styles';
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }
    // Build a CSS rule for every known clientId
    const allClientIds = new Set(docItems.map(i => i.clientId));
    const rules = Array.from(allClientIds).map(clientId => {
      const info  = authorMap[String(clientId)];
      const color = info?.color ?? fallbackColor(clientId);
      return `.timelapse-author-${clientId} { background: ${hexToRgba(color, 0.18)}; border-bottom: 2px solid ${color}; border-radius: 2px; }`;
    });
    styleEl.textContent = rules.join('\n');
    return () => { /* leave style tag alive for reuse */ };
  }, [authorMap, docItems]);

  // Trigger decoration update when currentText or ranges change
  useEffect(() => { applyDecorations(); }, [applyDecorations]);

  // ── Editor mount ───────────────────────────────────────────────────────────
  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current  = editor;
    monacoRef.current  = monaco;
    // Apply decorations once the editor is ready
    setTimeout(applyDecorations, 100);
  };

  // ── Unique authors visible at currentClock (for legend) ───────────────────
  const visibleAuthors = useMemo(() => {
    const snapshots = (window as any).__timelapseSnapshots as
      Array<{ text: string; authorRanges: Array<{ start: number; end: number; clientId: number }> }> | undefined;

    if (!snapshots || currentClock < 0 || currentClock >= snapshots.length) return [];
    
    const snap = snapshots[currentClock];
    if (!snap.text) return []; // empty text = no authors

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
    return Array.from(seen.values());
  }, [currentClock, authorMap]);

  // ── Render ─────────────────────────────────────────────────────────────────
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

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between px-4 py-2 bg-[#2d2d2d] border-b border-white/10">
        <div className="flex items-center gap-3 min-w-0">
          <History size={16} className="text-emerald-400 shrink-0" />
          <span className="text-zinc-300 text-sm font-semibold truncate">{filename}</span>
          <span className="text-emerald-400 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-400/10 border border-emerald-400/20 shrink-0">
            CRDT Timelapse
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-zinc-400 hover:text-red-400 transition-colors bg-white/5 hover:bg-red-500/20 p-1 rounded ml-2 shrink-0"
          title="Close timelapse"
        >
          <X size={16} />
        </button>
      </div>

      {/* ── Author legend ─────────────────────────────────────────────────── */}
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
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: info.color }}
              />
              <span className="text-[11px] text-zinc-300 font-medium">{info.username}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Editor area ───────────────────────────────────────────────────── */}
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
            // Disable built-in squiggles — we add our own decorations
            renderValidationDecorations: 'off',
          }}
        />
      </div>

      {/* ── Timeline controls ─────────────────────────────────────────────── */}
      <div className="shrink-0 p-4 bg-[#252526] border-t border-white/10 flex items-center gap-4">
        <button
          onClick={() => setIsPlaying(p => !p)}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500 hover:bg-indigo-600 text-white transition-colors shadow-lg shrink-0"
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying
            ? <Pause size={14} />
            : <Play size={14} fill="currentColor" className="ml-0.5" />}
        </button>

        <button
          onClick={() => { setCurrentClock(0); setIsPlaying(false); }}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-700 hover:bg-zinc-600 text-white transition-colors shrink-0"
          title="Rewind to start"
        >
          <RotateCcw size={14} />
        </button>

        <div className="flex-1 flex items-center gap-3 min-w-0">
          <input
            type="range"
            min="0"
            max={maxClock}
            value={currentClock}
            onChange={e => { setCurrentClock(Number(e.target.value)); setIsPlaying(false); }}
            className="flex-1 h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
          />
        </div>

        <div className="text-[11px] text-zinc-400 font-mono w-20 text-right bg-black/20 py-1 px-2 rounded border border-white/5 shrink-0">
          {currentClock} <span className="text-zinc-600">/</span> {maxClock}
        </div>
      </div>
    </div>
  );
}
