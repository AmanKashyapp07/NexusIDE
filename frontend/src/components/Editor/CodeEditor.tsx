import { useEffect, useState, useRef, useMemo } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';
import { apiUrl, wsUrl } from '../../lib/backendUrls';
import { useLspClient, type LspStatus } from '../../hooks/useLspClient';

// NOTE: Monaco Web Worker configuration lives in main.tsx (set globally before
// Monaco initializes). Routing language services to workers prevents main-thread
// starvation that would otherwise stall the Yjs sync handshake under load.

type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';
type MonacoInstance = typeof Monaco;
type MonacoCodeEditor = Monaco.editor.IStandaloneCodeEditor;

interface AwarenessUser { name: string; color: string; id?: string; }
interface AwarenessState { user?: AwarenessUser; selection?: { anchor: unknown; head: unknown }; }

interface CodeEditorProps {
  workspaceId: string;
  fileId: string;
  filename?: string;
  language: string;
  currentUser: { username: string; id: string };
  authorMap?: Record<string, { username: string; color: string }>; // Added for Blame
  isBlameOpen?: boolean; // External control for blame visibility
  onBlameToggle?: (open: boolean) => void; // Callback when blame is toggled
  onCodeChange?: (code: string) => void;
  onEditorReady?: (editor: MonacoCodeEditor) => void;
  onAwarenessChange?: (users: AwarenessUser[]) => void;
  onConnectionStatusChange?: (status: ConnectionStatus) => void;
  readOnly?: boolean;

  // Jump-to-member: set to a userId to scroll the editor to that user's cursor.
  // IdePage clears it via onJumpComplete once the jump is executed.
  jumpToUserId?: string | null;
  onJumpComplete?: () => void;
}

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899'];
const getUserColor = (username: string) => {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
};

class AutocompleteCache {
  private capacity: number;
  private cache: Map<string, string>;
  constructor(capacity = 50) {
    this.capacity = capacity;
    this.cache = new Map();
  }
  get(key: string): string | undefined {
    if (!this.cache.has(key)) return undefined;
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }
  set(key: string, value: string): void {
    if (this.cache.has(key)) this.cache.delete(key);
    else if (this.cache.size >= this.capacity) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, value);
  }
}
const ghostTextCache = new AutocompleteCache(50);

// ===========================================================================
// [BLAME FEATURE] Chronological Author Extraction
// ===========================================================================
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
            lineAuthors.set(currentLine, { clientId: node.id.client, maxClock: charClock });
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

export default function CodeEditor({
  workspaceId,
  fileId,
  filename,
  language,
  currentUser,
  authorMap = {}, // Added for Blame
  isBlameOpen = false,
  onBlameToggle,
  onCodeChange,
  onEditorReady,
  onAwarenessChange,
  onConnectionStatusChange,
  readOnly = false,
  jumpToUserId = null,
  onJumpComplete,
}: CodeEditorProps) {
  const [editor, setEditor] = useState<MonacoCodeEditor | null>(null);
  const [monacoInstance, setMonacoInstance] = useState<MonacoInstance | null>(null);
  const [awarenessStates, setAwarenessStates] = useState<[number, AwarenessState][]>([]);
  const [lspStatus, setLspStatus] = useState<LspStatus>('off');

  // ===========================================================================
  // [BLAME FEATURE] UI States
  // ===========================================================================
  const [showBlame, setShowBlame] = useState(false);
  const [blameData, setBlameData] = useState<Map<number, number>>(new Map());
  const [lineCount, setLineCount] = useState(1);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Sync with parent component's blame state
  useEffect(() => {
    setShowBlame(isBlameOpen);
  }, [isBlameOpen]);

  // Notify parent when blame is toggled locally
  const toggleBlame = () => {
    const newState = !showBlame;
    setShowBlame(newState);
    onBlameToggle?.(newState);
  };

  // Build authorMap from awareness states (map Yjs clientId to user info)
  const liveAuthorMap = useMemo(() => {
    const map: Record<string, { username: string; color: string }> = {};
    awarenessStates.forEach(([clientId, state]) => {
      if (state.user) {
        map[String(clientId)] = { username: state.user.name, color: state.user.color };
      }
    });
    // Merge with provided authorMap (from parent) for historical data
    return { ...authorMap, ...map };
  }, [awarenessStates, authorMap]);

  // ===========================================================================
  // [FEATURE] LSP Client — real-time diagnostics, hover, completions
  // ===========================================================================
  useLspClient({
    workspaceId,
    fileId,
    filename: filename ?? fileId,
    language,
    readOnly,
    editor,
    monacoInstance,
    onStatusChange: setLspStatus,
  });

  const wsProviderRef = useRef<WebsocketProvider | null>(null);
  const ydocRef = useRef<Y.Doc | null>(null);

  const [prevFileId, setPrevFileId] = useState(fileId);
  if (fileId !== prevFileId) {
    setPrevFileId(fileId);
    setAwarenessStates([]);
    // Reset blame state when switching files
    setShowBlame(false);
    setBlameData(new Map());
    setLineCount(1);
  }

  const callbackRefs = useRef({ onAwarenessChange, onConnectionStatusChange, onCodeChange });
  callbackRefs.current = { onAwarenessChange, onConnectionStatusChange, onCodeChange };

  // ===========================================================================
  // [BLAME FEATURE] Isolated Live Calculation
  // ===========================================================================
  useEffect(() => {
    if (!showBlame || !editor || !ydocRef.current) return;
    
    const updateBlame = () => {
      const ydoc = ydocRef.current;
      if (!ydoc) return;
      const ytext = ydoc.getText('monaco');
      setBlameData(getChronologicalLineBlame(ytext));
      setLineCount(editor.getModel()?.getLineCount() || 1);
    };

    updateBlame();
    // Safely hook into Monaco's native model changes without touching Yjs binding
    const disposable = editor.onDidChangeModelContent(updateBlame);
    return () => disposable.dispose();
  }, [showBlame, editor]);

  // ===========================================================================
  // [COLLABORATION SESSION] Deterministic Yjs lifecycle
  // ===========================================================================
  useEffect(() => {
    let isActive = true;
    let boundModel: Monaco.editor.ITextModel | null = null;
    let binding: MonacoBinding | null = null;

    if (!editor || !workspaceId || !fileId) return;

    const roomName = `${workspaceId}-${fileId}`;
    const token = localStorage.getItem('token') || '';
    
    const ydoc = new Y.Doc();
    const wsProvider = new WebsocketProvider(wsUrl(''), roomName, ydoc, { params: { token } });

    wsProviderRef.current = wsProvider;
    ydocRef.current = ydoc;

    const tryBind = () => {
      if (!isActive) return;
      const model = editor.getModel();
      const expectedName = filename || fileId;
      
      if (!model || !model.uri || !model.uri.path.endsWith(expectedName)) return;
      if (binding && boundModel === model) return;

      const ytext = ydoc.getText('monaco');
      if (!(wsProvider as any).synced && ytext.length === 0 && model.getValue().length > 0) {
        return;
      }
      
      if (binding) {
        binding.destroy();
        binding = null;
      }
      
      binding = new MonacoBinding(
        ytext,
        model,
        new Set([editor]),
        wsProvider.awareness as any
      );
      boundModel = model;
    };

    const handleSync = (synced: boolean) => {
      if (synced && isActive) {
        if (binding) {
          binding.destroy();
          binding = null;
          boundModel = null;
        }
        tryBind();
      }
    };

    const handleStatus = (event: { status: ConnectionStatus }) => {
      if (!isActive) return;
      callbackRefs.current.onConnectionStatusChange?.(event.status);
      if (event.status === 'connected') {
        wsProvider.awareness.setLocalStateField('user', {
          name: currentUser.username,
          color: getUserColor(currentUser.username),
          id: currentUser.id,
        });
      }
    };

    const handleAwareness = () => {
      if (!isActive) return;
      const states = Array.from(wsProvider.awareness.getStates().entries()) as [number, AwarenessState][];
      setAwarenessStates(states);
      const users = states
        .map(([, state]) => state.user)
        .filter((user): user is AwarenessUser => Boolean(user));
      
      callbackRefs.current.onAwarenessChange?.(
        Array.from(new Map(users.map(u => [u.name, u])).values())
      );
    };

    const handleUpdate = (_update: Uint8Array, origin: any) => {
      if (!isActive || origin !== binding) return;
      callbackRefs.current.onCodeChange?.(editor.getValue());
    };

    wsProvider.on('sync', handleSync);
    wsProvider.on('status', handleStatus as any);
    wsProvider.awareness.on('change', handleAwareness);
    ydoc.on('update', handleUpdate);
    
    tryBind();
    const modelDisposable = typeof editor.onDidChangeModel === 'function'
      ? editor.onDidChangeModel(() => tryBind())
      : null;

    return () => {
      isActive = false;
      wsProviderRef.current = null;
      ydocRef.current = null;
      if (modelDisposable) modelDisposable.dispose();
      
      wsProvider.off('sync', handleSync);
      wsProvider.off('status', handleStatus as any);
      wsProvider.awareness.off('change', handleAwareness);
      ydoc.off('update', handleUpdate);
      
      if (binding) binding.destroy();
      
      wsProvider.destroy();
      ydoc.destroy();
    };
  }, [editor, workspaceId, fileId, filename, currentUser.username]);

  // ===========================================================================
  // [FEATURE] Jump-to-member cursor
  // ===========================================================================
  useEffect(() => {
    if (!jumpToUserId || !editor || !wsProviderRef.current || !ydocRef.current) return;

    const provider = wsProviderRef.current;
    const ydoc = ydocRef.current;
    const model = editor.getModel();
    if (!model) return;

    const ytext = ydoc.getText('monaco');
    const states = provider.awareness.getStates();

    for (const [, state] of states) {
      const s = state as AwarenessState & { user?: AwarenessUser & { id?: string } };
      if (!s.user?.id || s.user.id !== jumpToUserId) continue;
      if (!s.selection) continue;

      const headAbs = Y.createAbsolutePositionFromRelativePosition(
        s.selection.head as Y.RelativePosition,
        ydoc
      );
      if (headAbs === null || headAbs.type !== ytext) continue;

      const position = model.getPositionAt(headAbs.index);
      editor.revealPositionInCenter(position, 0 /* Smooth */);
      editor.setPosition(position);
      editor.focus();
      break;
    }

    onJumpComplete?.();
  }, [jumpToUserId, editor, onJumpComplete]);

  // ===========================================================================
  // [INTEGRATION] Autocomplete Provider
  // ===========================================================================
  useEffect(() => {
    if (!editor || !monacoInstance || readOnly) return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let activeAbortController: AbortController | null = null;
    const emptyCompletions = { items: [] };

    const provider = monacoInstance.languages.registerInlineCompletionsProvider('*', {
      provideInlineCompletions: async (model, position, _context, token) => {
        const startLine = Math.max(1, position.lineNumber - 500);
        const endLine = Math.min(model.getLineCount(), position.lineNumber + 500);

        const textUntilPosition = model.getValueInRange({
          startLineNumber: startLine, startColumn: 1,
          endLineNumber: position.lineNumber, endColumn: position.column,
        });
        const textAfterPosition = model.getValueInRange({
          startLineNumber: position.lineNumber, startColumn: position.column,
          endLineNumber: endLine, endColumn: model.getLineMaxColumn(endLine),
        });

        const cacheKey = `${language}:${textUntilPosition}|${textAfterPosition}`;
        const cachedCompletion = ghostTextCache.get(cacheKey);

        if (cachedCompletion) {
          return {
            items: [{
              insertText: cachedCompletion,
              range: new monacoInstance.Range(position.lineNumber, position.column, position.lineNumber, position.column)
            }]
          };
        }

        return new Promise((resolve) => {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(async () => {
            if (token.isCancellationRequested) return resolve(emptyCompletions);
            if (activeAbortController) activeAbortController.abort();
            activeAbortController = new AbortController();
            token.onCancellationRequested(() => activeAbortController?.abort());

            try {
              const reqToken = localStorage.getItem('token');
              const res = await fetch(apiUrl(`/workspace/${workspaceId}/autocomplete`), {
                method: 'POST',
                signal: activeAbortController.signal,
                headers: {
                  'Content-Type': 'application/json',
                  ...(reqToken ? { Authorization: `Bearer ${reqToken}` } : {})
                },
                body: JSON.stringify({ prefix: textUntilPosition, suffix: textAfterPosition, language })
              });

              if (!res.ok) return resolve(emptyCompletions);
              const data = await res.json() as { completion?: string };
              if (token.isCancellationRequested || !data.completion) return resolve(emptyCompletions);

              let finalCompletion = data.completion.replace(/^```[a-z]*\n/i, '').replace(/```$/i, '');
              const maxCheckLength = Math.min(textUntilPosition.length, finalCompletion.length, 1000);
              let overlapLength = 0;

              for (let i = maxCheckLength; i > 0; i--) {
                if (finalCompletion.startsWith(textUntilPosition.slice(-i))) {
                  overlapLength = i;
                  break;
                }
              }

              if (overlapLength > 0) finalCompletion = finalCompletion.slice(overlapLength);
              if (!finalCompletion.trim()) return resolve(emptyCompletions);

              ghostTextCache.set(cacheKey, finalCompletion);
              resolve({
                items: [{
                  insertText: finalCompletion,
                  range: new monacoInstance.Range(position.lineNumber, position.column, position.lineNumber, position.column)
                }]
              });
            } catch (error) {
              resolve(emptyCompletions);
            }
          }, 350);
        });
      },
      disposeInlineCompletions: () => {}
    });

    return () => {
      provider.dispose();
      if (debounceTimer) clearTimeout(debounceTimer);
      if (activeAbortController) activeAbortController.abort();
    };
  }, [editor, monacoInstance, readOnly, workspaceId, language]);

  const handleEditorDidMount: OnMount = (editorInstance, monaco) => {
    if (typeof window !== 'undefined') (window as any).monaco = monaco;
    setEditor(editorInstance);
    setMonacoInstance(monaco as MonacoInstance);

    // [BLAME FEATURE] Sync editor scroll to blame sidebar
    editorInstance.onDidScrollChange((e) => {
      if (sidebarRef.current) {
        sidebarRef.current.scrollTop = e.scrollTop;
      }
    });

    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ES2020,
      allowNonTsExtensions: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monaco.languages.typescript.ModuleKind.CommonJS,
      noEmit: true,
      esModuleInterop: true,
    });
    
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ES2020,
      allowNonTsExtensions: true,
    });

    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true });
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true });
    monaco.languages.css.cssDefaults.setDiagnosticsOptions({ validate: false });
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({ validate: false });

    editorInstance.updateOptions({ wordBasedSuggestions: 'currentDocument', inlineSuggest: { enabled: true } });
    onEditorReady?.(editorInstance);
  };

  return (
    // Replaced absolute wrapper with flex for split pane architecture
    <div className="relative flex h-full w-full bg-[#1e1e1e] overflow-hidden">
      <style>
        {awarenessStates.map(([clientId, state]) => {
            if (!state.user?.color) return '';
            const color = state.user.color;
            const name = state.user.name || 'Anonymous';
            return `
            .yRemoteSelection-${clientId} { background-color: ${color}35 !important; }
            .yRemoteSelectionHead-${clientId} {
              position: absolute;
              border-left: 2px solid ${color} !important;
              box-sizing: border-box;
              height: 100%;
              z-index: 10;
              animation: cursorFadeIn-${clientId} 0.15s ease-out;
            }
            .yRemoteSelectionHead-${clientId}::before {
              content: ''; position: absolute; top: -2px; left: -2px; width: 4px; height: 4px; background-color: ${color}; border-radius: 1px;
            }
            .yRemoteSelectionHead-${clientId}::after {
              position: absolute; content: "${name}"; top: -22px; left: -2px; background-color: ${color} !important;
              color: #ffffff; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 11px; font-weight: 500;
              padding: 4px 8px; border-radius: 4px 4px 4px 0px; white-space: nowrap; pointer-events: none; z-index: 20;
              animation: cursorLabelFade-${clientId} 4s ease-out forwards;
            }
            @keyframes cursorLabelFade-${clientId} {
              0% { opacity: 1; transform: translateY(0); }
              75% { opacity: 1; transform: translateY(0); }
              100% { opacity: 0; transform: translateY(2px); }
            }
            @keyframes cursorFadeIn-${clientId} { from { opacity: 0; } to { opacity: 1; } }
            .yRemoteSelectionHead-${clientId}:hover::after { animation: none; opacity: 1; transform: translateY(0); }
          `;
          }).join('\n')}
      </style>
      
      {/* ===========================================================================
          [BLAME FEATURE] Custom React Blame Sidebar
          =========================================================================== */}
      {showBlame && (
        <div 
          ref={sidebarRef}
          className="w-[260px] shrink-0 overflow-hidden bg-[#252526] border-r border-white/10 text-xs z-10"
          style={{ scrollbarWidth: 'none' }} 
        >
          {/* pt/pb-[16px] perfectly matches Monaco's { top: 16, bottom: 16 } padding options */}
          <div className="pt-[16px] pb-[16px]"> 
            {Array.from({ length: lineCount }, (_, i) => i + 1).map(line => {
              const clientId = blameData.get(line);
              const author = clientId ? liveAuthorMap[String(clientId)] : null;
              
              return (
                <div 
                  key={line} 
                  // h-[21px] must exactly match Monaco's configured lineHeight
                  className="flex items-center h-[21px] px-3 hover:bg-white/5 border-l-2 border-transparent group transition-colors cursor-default"
                  style={{ borderLeftColor: author?.color || 'transparent' }}
                >
                  {author ? (
                    <>
                      <span 
                        className="w-2 h-2 rounded-full mr-2 shrink-0 opacity-80" 
                        style={{ backgroundColor: author.color }} 
                      />
                      <span className="truncate w-24 mr-2 font-medium text-zinc-300">
                        {author.username}
                      </span>
                      <span className="truncate flex-1 text-[10px] text-zinc-500 group-hover:text-zinc-400">
                        Live edit
                      </span>
                    </>
                  ) : (
                    <span className="text-zinc-600 italic px-4">No history</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Editor Main Canvas Wrapper */}
      <div className="flex-1 relative min-w-0">
        <Editor
          path={filename || fileId}
          height="100%"
          language={language}
          theme="vs-dark"
          loading={
            <div className="flex h-full w-full items-center justify-center bg-[#1e1e1e]">
              <div className="flex flex-col items-center gap-4">
                <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-[#3b82f6] border-t-transparent" />
                <span className="text-sm font-medium tracking-wide text-gray-400 font-mono">Loading Editor...</span>
              </div>
            </div>
          }
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            lineHeight: 21, // Added to enforce perfect alignment with the React sidebar h-[21px]
            fontFamily: "'JetBrains Mono', 'Fira Code', 'SFMono-Regular', Consolas, Menlo, monospace",
            fontLigatures: true,
            // Dynamically disable word wrap when blame is open to preserve row-to-row alignment
            wordWrap: showBlame ? 'off' : 'on',
            padding: { top: 16, bottom: 16 },
            lineNumbersMinChars: 3,
            readOnly: readOnly,
            automaticLayout: true,
          }}
          onMount={handleEditorDidMount}
        />
        
        {/* ===========================================================================
            [BLAME FEATURE] Toggle Button Overlay
            =========================================================================== */}
        <button
          onClick={toggleBlame}
          className="absolute top-4 right-6 z-30 flex items-center gap-1.5 rounded-md bg-[#2d2d2d] hover:bg-[#3d3d3d] px-3 py-1.5 text-xs font-medium text-zinc-300 border border-white/10 transition-colors shadow-lg"
        >
          <svg className={`w-3.5 h-3.5 transition-transform ${showBlame ? 'text-indigo-400' : 'text-zinc-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {showBlame ? 'Hide Blame' : 'Blame'}
        </button>

        {readOnly && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold text-zinc-400 bg-black/40 border border-white/10 backdrop-blur-md shadow-sm">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            View Only
          </div>
        )}

        {/* LSP status badge */}
        {lspStatus !== 'off' && !readOnly && ['typescript', 'javascript', 'typescriptreact', 'javascriptreact', 'python'].includes(language) && (
          <div
            data-testid="lsp-status-badge"
            data-lsp-status={lspStatus}
            className={`absolute bottom-3 right-3 z-20 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold backdrop-blur-md border transition-all ${
              lspStatus === 'ready'
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : lspStatus === 'connecting'
                ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                : 'bg-red-500/10 text-red-400 border-red-500/20'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${
              lspStatus === 'ready'      ? 'bg-emerald-400'
              : lspStatus === 'connecting' ? 'bg-blue-400 animate-pulse'
              : 'bg-red-400'
            }`} />
            {lspStatus === 'ready' ? 'LSP' : lspStatus === 'connecting' ? 'LSP…' : 'LSP ✕'}
          </div>
        )}
      </div>
    </div>
  );
}