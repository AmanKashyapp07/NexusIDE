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
        // FULL HISTORY EXTRACTION (including deleted characters)
        //
        // The Y.Text linked list contains ALL items:
        //   • curr.deleted = false → exists in final document
        //   • curr.deleted = true  → was typed then deleted (tombstone)
        //
        // We collect ALL items in document order (position in text).
        // For deleted items, we mark them with a synthetic deleteClock
        // derived from the DeleteSet embedded in the yjs_state binary.
        //
        // The DeleteSet (Y.decodeUpdate → ds.clients) maps each client to
        // clock ranges that were deleted. We use these to identify WHICH
        // items were deleted. For WHEN they were deleted, we assign a
        // synthetic deletion clock = maxInsertionClock + sequentialOffset
        // since the exact wall-clock timing is not stored.
        //
        // Visibility rule at slider position T:
        //   visible = (insertSeq <= T) AND (deleteSeq > T)
        // =================================================================

        // Collect ALL items (including deleted) in document order
        interface RawItem {
          clientId:    number;
          insertClock: number;
          deleted:     boolean;
          str:         string;
        }
        const allItems: RawItem[] = [];
        let curr = (ytext as any)._start;
        while (curr !== null) {
          const content = curr.content?.getContent?.();
          const str = Array.isArray(content)
            ? content.join('')
            : typeof content === 'string' ? content : '';
          if (str) {
            for (let i = 0; i < str.length; i++) {
              allItems.push({
                clientId:    curr.id.client,
                insertClock: curr.id.clock + i,
                deleted:     !!curr.deleted,
                str:         str[i],
              });
            }
          }
          curr = curr.right;
        }

        // Find the max insertion clock to place deletions after all inserts
        const maxInsertClock = allItems.length > 0
          ? allItems.reduce((m, it) => Math.max(m, it.insertClock), 0)
          : 0;

        // Assign deletion clocks: deleted items get a clock after all inserts.
        // We group by the order they appear in the document (stable ordering).
        let deletionCounter = maxInsertClock + 1;
        const deletionClocks = new Map<number, number>(); // allItems index → deletionClock
        for (let i = 0; i < allItems.length; i++) {
          if (allItems[i].deleted) {
            deletionClocks.set(i, deletionCounter++);
          }
        }

        // Build a unified event timeline: all insertClocks + all deletionClocks
        const eventClocks = new Set<number>();
        for (const item of allItems) {
          eventClocks.add(item.insertClock);
        }
        for (const dc of deletionClocks.values()) {
          eventClocks.add(dc);
        }
        const sortedEvents = Array.from(eventClocks).sort((a, b) => a - b);

        // Map each raw clock to a 1-based sequential position (slider value)
        const clockToSeq = new Map<number, number>();
        sortedEvents.forEach((c, idx) => clockToSeq.set(c, idx + 1));
        const maxSeq = sortedEvents.length;

        // Build final DocItem array in document order
        const items: DocItem[] = allItems.map((item, idx) => ({
          clock:     clockToSeq.get(item.insertClock) ?? 1,
          str:       item.str,
          clientId:  item.clientId,
          deleteSeq: deletionClocks.has(idx)
            ? (clockToSeq.get(deletionClocks.get(idx)!) ?? Infinity)
            : Infinity,
        }));

        const maxC = maxSeq;

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
    if (!docItems.length) return { currentText: '', decorationRanges: [] };

    // Build text and track per-character author
    let text = '';
    // authorRuns: consecutive characters from the same author get one decoration
    const authorRuns: Array<{ startOffset: number; endOffset: number; clientId: number }> = [];
    let runStart = 0;
    let runClient = -1;

    for (const item of docItems) {
      // Character is visible if it was inserted at or before currentClock
      // AND either never deleted or deleted after currentClock.
      if (item.clock > currentClock) continue;
      if ((item.deleteSeq ?? Infinity) <= currentClock) continue;
      const offset = text.length;
      text += item.str;

      if (item.clientId !== runClient) {
        if (runClient !== -1) {
          authorRuns.push({ startOffset: runStart, endOffset: offset, clientId: runClient });
        }
        runStart  = offset;
        runClient = item.clientId;
      }
    }
    if (runClient !== -1 && text.length > runStart) {
      authorRuns.push({ startOffset: runStart, endOffset: text.length, clientId: runClient });
    }

    // Convert character offsets to Monaco line/column positions
    // We need to split text by lines to get line numbers
    const lines = text.split('\n');
    // Build a lookup: characterOffset → { lineNumber, column }
    const offsetToPos = (offset: number): { lineNumber: number; column: number } => {
      let remaining = offset;
      for (let li = 0; li < lines.length; li++) {
        const lineLen = lines[li].length + (li < lines.length - 1 ? 1 : 0); // +1 for \n
        if (remaining <= (li < lines.length - 1 ? lines[li].length : lines[li].length)) {
          return { lineNumber: li + 1, column: remaining + 1 };
        }
        remaining -= lineLen;
      }
      return { lineNumber: lines.length, column: lines[lines.length - 1].length + 1 };
    };

    const decorationRanges = authorRuns.map(run => ({
      startPos: offsetToPos(run.startOffset),
      endPos:   offsetToPos(run.endOffset),
      clientId: run.clientId,
    }));

    return { currentText: text, decorationRanges };
  }, [docItems, currentClock]);

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
    const seen = new Map<string, { info: AuthorInfo; clientId: number }>();
    for (const item of docItems) {
      if (item.clock > currentClock) continue;
      if ((item.deleteSeq ?? Infinity) <= currentClock) continue;
      const key = String(item.clientId);
      if (!seen.has(key)) {
        const info = authorMap[key] ?? {
          userId:   key,
          username: `User ${item.clientId}`,
          color:    fallbackColor(item.clientId),
        };
        seen.set(key, { info, clientId: item.clientId });
      }
    }
    return Array.from(seen.values());
  }, [docItems, currentClock, authorMap]);

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
