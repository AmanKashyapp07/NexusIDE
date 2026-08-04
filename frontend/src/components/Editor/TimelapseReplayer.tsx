import { useEffect, useRef, useCallback } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { Play, Pause, RotateCcw, X, History, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { useTimelapsePlayer, fallbackColor, hexToRgba, offsetToPosition } from '../../hooks/useTimelapsePlayer';

interface TimelapseReplayerProps {
  workspaceId: string;
  fileId: string;
  filename: string;
  language: string;
  onClose: () => void;
}

const styles = {
  container: 'flex flex-col h-full w-full bg-ide-bg overflow-hidden shadow-2xl z-50',
  header: 'flex shrink-0 items-center justify-between px-4 py-2 bg-[#2d2d2d] border-b border-white/10',
  filename: 'text-zinc-300 text-sm font-semibold truncate',
  closeBtn: 'text-zinc-400 hover:text-red-400 transition-colors bg-white/5 hover:bg-red-500/20 p-1 rounded ml-2 shrink-0',
  authorBar: 'shrink-0 flex items-center gap-3 px-4 py-1.5 bg-ide-bg border-b border-white/[0.06] overflow-x-auto',
  editorContainer: 'flex-1 relative min-h-0 bg-ide-bg',
  controlsBar: 'shrink-0 bg-ide-panel border-t border-white/10',
  ctrlBtn: 'flex h-8 w-8 items-center justify-center rounded-full bg-zinc-700 hover:bg-zinc-600 text-white transition-colors shrink-0',
  playBtn: 'flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500 hover:bg-indigo-600 text-white transition-colors shadow-lg shrink-0',
};

/**
 * Presenter Component: TimelapseReplayer
 * Renders playback UI, Monaco readonly canvas, and author legend.
 * All timeline calculations & playback state machines are driven by useTimelapsePlayer hook.
 */
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

  // Flash newly inserted text
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

  // Inject author CSS rules
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
    <div className={styles.container}>
      <div className={styles.header}>
        <div className="flex items-center gap-3 min-w-0">
          <History size={16} className="text-emerald-400 shrink-0" />
          <span className={styles.filename}>{filename}</span>
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
          className={styles.closeBtn}
          title="Close timelapse"
        >
          <X size={16} />
        </button>
      </div>

      {visibleAuthors.length > 0 && (
        <div
          className={styles.authorBar}
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

      <div className={styles.editorContainer}>
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

      <div className={styles.controlsBar}>
        <div className="flex items-center gap-2 px-4 pt-3">
          <button
            onClick={player.rewind}
            className={styles.ctrlBtn}
            title="Back to start (Home)"
          >
            <RotateCcw size={14} />
          </button>
          <button
            onClick={player.stepBack}
            className={styles.ctrlBtn}
            title="Step back (←)"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={player.togglePlay}
            className={styles.playBtn}
            title={player.isPlaying ? 'Pause (space)' : 'Play (space)'}
          >
            {player.isPlaying ? <Pause size={14} /> : <Play size={14} fill="currentColor" className="ml-0.5" />}
          </button>
          <button
            onClick={player.stepForward}
            className={styles.ctrlBtn}
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

          <div className="relative flex-1 h-8 flex items-center min-w-0 mx-1">
            <div className="absolute inset-x-0 bottom-1 h-3.5 flex items-end gap-px pointer-events-none">
              {player.activityBars.map((v, i) => (
                <div key={i} className="flex-1 bg-indigo-400/30 rounded-[1px]" style={{ height: `${Math.max(10, v * 100)}%` }} />
              ))}
            </div>
            <input
              type="range"
              min={0}
              max={player.maxClock}
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