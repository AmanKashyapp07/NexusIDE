import { useEffect, useState, useMemo } from 'react';
import * as Y from 'yjs';
import Editor from '@monaco-editor/react';
import { Play, Pause, RotateCcw, X, History } from 'lucide-react';
import { apiUrl } from '../../lib/backendUrls';

interface TimelapseReplayerProps {
  workspaceId: string;
  fileId: string;
  filename: string;
  language: string;
  onClose: () => void;
}

export default function TimelapseReplayer({ workspaceId, fileId, filename, language, onClose }: TimelapseReplayerProps) {
  const [maxClock, setMaxClock] = useState(0);
  const [currentClock, setCurrentClock] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [docItems, setDocItems] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchHistory = async () => {
      console.log('[TimelapseDebug] fetchHistory started. workspaceId:', workspaceId, 'fileId:', fileId);
      setIsLoading(true);
      try {
        const token = localStorage.getItem('token');
        const url = apiUrl(`/workspace/${workspaceId}/files/${fileId}/history`);
        console.log('[TimelapseDebug] Fetching from URL:', url);
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` }
        });
        console.log('[TimelapseDebug] Fetch response status:', res.status, 'ok:', res.ok);
        if (!res.ok) {
          const text = await res.text();
          console.error('[TimelapseDebug] Fetch error body:', text);
          throw new Error(`Failed to fetch history (status ${res.status}): ${text}`);
        }
        const arrayBuffer = await res.arrayBuffer();
        console.log('[TimelapseDebug] ArrayBuffer fetched. byteLength:', arrayBuffer.byteLength);
        const uint8Array = new Uint8Array(arrayBuffer);
        console.log('[TimelapseDebug] Uint8Array length:', uint8Array.length);

        // Parse Yjs doc
        const ydoc = new Y.Doc();
        Y.applyUpdate(ydoc, uint8Array);
        console.log('[TimelapseDebug] Yjs update applied successfully.');
        
        const ytext = ydoc.getText('monaco');
        console.log('[TimelapseDebug] Y.Text ("monaco") content length:', ytext.length, 'value preview:', ytext.toString().substring(0, 100));
        
        // Traverse the Y.Text linked list left-to-right
        const items = [];
        let maxC = 0;
        let curr = (ytext as any)._start;
        console.log('[TimelapseDebug] Starting linked list traversal. Initial _start is null?', curr === null);
        while (curr !== null) {
          if (!curr.deleted) {
            const content = curr.content.getContent();
            const str = Array.isArray(content) ? content.join('') : (typeof content === 'string' ? content : '');
            if (str) {
              for (let i = 0; i < str.length; i++) {
                const charClock = curr.id.clock + i;
                items.push({
                  clock: charClock,
                  str: str[i]
                });
                if (charClock > maxC) maxC = charClock;
              }
            }
          }
          curr = curr.right;
        }
        console.log('[TimelapseDebug] Traversal complete. Extracted char items:', items.length, 'maxClock calculated:', maxC);
        setDocItems(items);
        setMaxClock(maxC);
        setCurrentClock(maxC);
      } catch (err) {
        console.error('[TimelapseDebug] Error in fetchHistory flow:', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchHistory();
  }, [workspaceId, fileId]);

  useEffect(() => {
    let interval: ReturnType<typeof setTimeout>;
    if (isPlaying) {
      interval = setInterval(() => {
        setCurrentClock(prev => {
          if (prev >= maxClock) {
            setIsPlaying(false);
            return maxClock;
          }
          // Advance by a step to make playback smooth but fast enough
          return Math.min(prev + Math.max(1, Math.floor(maxClock / 100)), maxClock);
        });
      }, 50);
    }
    return () => clearInterval(interval);
  }, [isPlaying, maxClock]);

  const currentText = useMemo(() => {
    let text = '';
    for (const item of docItems) {
      if (item.clock <= currentClock) {
        text += item.str;
      }
    }
    console.log('[TimelapseDebug] Computed currentText. currentClock:', currentClock, 'maxClock:', maxClock, 'docItems size:', docItems.length, 'text length:', text.length, 'preview:', text.substring(0, 100));
    return text;
  }, [docItems, currentClock, maxClock]);

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#1e1e1e] text-zinc-400">
        Loading timeline data...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full bg-[#1e1e1e] overflow-hidden shadow-2xl z-50">
      <div className="flex shrink-0 items-center justify-between px-4 py-2 bg-[#2d2d2d] border-b border-white/10">
        <div className="flex items-center gap-3">
          <History size={16} className="text-emerald-400" />
          <span className="text-zinc-300 text-sm font-semibold">{filename}</span>
          <span className="text-emerald-400 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-400/10 border border-emerald-400/20">
            CRDT Timelapse
          </span>
        </div>
        <button onClick={onClose} className="text-zinc-400 hover:text-white transition-colors bg-white/5 hover:bg-red-500/20 hover:text-red-400 p-1 rounded">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 relative min-h-0 bg-[#1e1e1e]">
        <Editor
          height="100%"
          language={language}
          theme="vs-dark"
          value={currentText}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            domReadOnly: true,
            automaticLayout: true
          }}
        />
      </div>

      <div className="shrink-0 p-4 bg-[#252526] border-t border-white/10 flex items-center gap-4">
        <button 
          onClick={() => setIsPlaying(!isPlaying)}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500 hover:bg-indigo-600 text-white transition-colors shadow-lg"
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} fill="currentColor" className="ml-0.5" />}
        </button>
        <button 
          onClick={() => setCurrentClock(0)}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-700 hover:bg-zinc-600 text-white transition-colors"
          title="Rewind to start"
        >
          <RotateCcw size={14} />
        </button>
        
        <div className="flex-1 flex items-center gap-3">
          <input 
            type="range" 
            min="0" 
            max={maxClock} 
            value={currentClock} 
            onChange={(e) => {
              setCurrentClock(Number(e.target.value));
              setIsPlaying(false);
            }}
            className="flex-1 h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
          />
        </div>
        <div className="text-[11px] text-zinc-400 font-mono w-20 text-right bg-black/20 py-1 px-2 rounded border border-white/5">
          {currentClock} <span className="text-zinc-600">/</span> {maxClock}
        </div>
      </div>
    </div>
  );
}
