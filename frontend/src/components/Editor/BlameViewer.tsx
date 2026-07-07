import React, { useState, useEffect, useRef } from 'react';
import * as Y from 'yjs';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';

// 1. The Algorithm: Runs entirely on the frontend Y.Doc
function getChronologicalLineBlame(ytext: Y.Text) {
  const lineAuthors = new Map<number, { clientId: number; maxClock: number }>();
  let currentLine = 1;
  let node: any = (ytext as any)._start;

  while (node !== null) {
    if (!node.deleted) {
      const content = node.content?.getContent?.();
      const str = Array.isArray(content) ? content.join('') : (typeof content === 'string' ? content : '');
      
      for (let i = 0; i < str.length; i++) {
        if (str[i] === '\n') {
          currentLine++;
        } else {
          const charClock = node.id.clock + i; 
          const existing = lineAuthors.get(currentLine);
          
          if (!existing || charClock > existing.maxClock) {
            lineAuthors.set(currentLine, { 
              clientId: node.id.client, 
              maxClock: charClock 
            });
          }
        }
      }
    }
    node = node.right;
  }

  const result = new Map<number, number>();
  lineAuthors.forEach((data, line) => result.set(line, data.clientId));
  return result;
}

// 2. The React Component
interface BlameViewerProps {
  yjsStateB64?: string;       // Legacy state from your history endpoint
  updatesB64?: string[];      // Full-fidelity state from your history endpoint
  authorMap: Record<string, { username: string; color: string }>;
  language: string;
}

export default function BlameViewer({ yjsStateB64, updatesB64, authorMap, language }: BlameViewerProps) {
  const [blameData, setBlameData] = useState<Map<number, number>>(new Map());
  const [currentText, setCurrentText] = useState('');
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Build the Y.Doc locally in the browser and extract blame
  useEffect(() => {
    const ydoc = new Y.Doc({ gc: false });
    
    // Apply whatever data the backend gave us
    if (updatesB64 && updatesB64.length > 0) {
      for (const b64 of updatesB64) {
        Y.applyUpdate(ydoc, Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
      }
    } else if (yjsStateB64) {
      Y.applyUpdate(ydoc, Uint8Array.from(atob(yjsStateB64), c => c.charCodeAt(0)));
    }

    const ytext = ydoc.getText('monaco');
    setCurrentText(ytext.toString());
    setBlameData(getChronologicalLineBlame(ytext));
  }, [yjsStateB64, updatesB64]);

  // Sync Monaco's scroll position with the blame sidebar
  const handleEditorMount: OnMount = (editor) => {
    editor.onDidScrollChange((e) => {
      if (sidebarRef.current) {
        sidebarRef.current.scrollTop = e.scrollTop;
      }
    });
  };

  const lineCount = currentText.split('\n').length;
  const lines = Array.from({ length: lineCount }, (_, i) => i + 1);

  return (
    <div className="flex w-full h-full bg-[#1e1e1e] overflow-hidden shadow-2xl">
      
      {/* LEFT PANE: The Blame Sidebar */}
      <div 
        ref={sidebarRef}
        className="w-[280px] shrink-0 overflow-hidden bg-[#252526] border-r border-white/10 text-xs"
        style={{ scrollbarWidth: 'none' }} // Hide native scrollbar
      >
        <div className="pt-[5px]"> // Adjust top padding to align perfectly with Monaco's first line
          {lines.map(line => {
            const clientId = blameData.get(line);
            const author = clientId ? authorMap[String(clientId)] : null;
            
            return (
              <div 
                key={line} 
                // h-[19px] must exactly match Monaco's configured lineHeight
                className="flex items-center h-[19px] px-3 hover:bg-white/5 border-l-2 border-transparent transition-colors group"
                style={{ borderLeftColor: author?.color || 'transparent' }}
              >
                {author ? (
                  <>
                    <span 
                      className="w-2 h-2 rounded-full mr-2 shrink-0 opacity-80" 
                      style={{ backgroundColor: author.color }} 
                    />
                    <span className="truncate w-20 mr-2 font-medium text-zinc-300">
                      {author.username}
                    </span>
                    <span className="truncate flex-1 text-zinc-500 group-hover:text-zinc-400">
                      Author
                    </span>
                  </>
                ) : (
                  <span className="text-zinc-600 italic px-4">Unknown</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* RIGHT PANE: The Read-Only Editor */}
      <div className="flex-1 relative min-w-0">
        <Editor
          value={currentText}
          language={language}
          theme="vs-dark"
          onMount={handleEditorMount}
          options={{
            readOnly: true,
            lineHeight: 19, // MUST match the h-[19px] in the sidebar loop above
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: 'off', // Word wrap breaks line-to-line alignment
            renderLineHighlight: 'all',
          }}
        />
      </div>
    </div>
  );
}
