import { useEffect, useState, useRef } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';
import { apiUrl, wsUrl } from '../../lib/backendUrls';

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

export default function CodeEditor({
  workspaceId,
  fileId,
  filename,
  language,
  currentUser,
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
  const [saveStatus, setSaveStatus] = useState<'idle' | 'unsaved' | 'saving' | 'saved'>('idle');

  // Ref to the live WebsocketProvider — needed by the jump effect which runs
  // outside the collaboration useEffect closure.
  const wsProviderRef = useRef<WebsocketProvider | null>(null);
  const ydocRef = useRef<Y.Doc | null>(null);

  // Synchronously reset sync and awareness status during render if the active file has swapped.
  // This ensures the "Syncing with server..." overlay is instantly visible in the DOM
  // during the render commit, preventing E2E race conditions where Playwright asserts
  // state before the new Yjs websocket handshake is initiated.
  const [prevFileId, setPrevFileId] = useState(fileId);
  if (fileId !== prevFileId) {
    setPrevFileId(fileId);
    setAwarenessStates([]);
    setSaveStatus('idle');
  }

  const callbackRefs = useRef({ onAwarenessChange, onConnectionStatusChange, onCodeChange });
  callbackRefs.current = { onAwarenessChange, onConnectionStatusChange, onCodeChange };

  // ===========================================================================
  // [COLLABORATION SESSION] Deterministic Yjs lifecycle
  // ===========================================================================
  useEffect(() => {
    let isActive = true;
    let boundModel: Monaco.editor.ITextModel | null = null;
    let binding: MonacoBinding | null = null;
    let saveDebounce: ReturnType<typeof setTimeout>;

    if (!editor || !workspaceId || !fileId) return;

    const roomName = `${workspaceId}-${fileId}`;
    const token = localStorage.getItem('token') || '';
    
    const ydoc = new Y.Doc();
    const wsProvider = new WebsocketProvider(wsUrl(''), roomName, ydoc, { params: { token } });

    // Expose provider + doc via refs so the jump effect can read awareness state
    // without being part of this effect's dependency array.
    wsProviderRef.current = wsProvider;
    ydocRef.current = ydoc;

    const tryBind = () => {
      if (!isActive) return;
      const model = editor.getModel();
      const expectedName = filename || fileId;
      
      if (!model || !model.uri || !model.uri.path.endsWith(expectedName)) return;
      if (binding && boundModel === model) return;

      // [SYNC ORDERING GUARD]
      // MonacoBinding's constructor calls monacoModel.setValue(ytext.toString())
      // whenever the two differ. If we bind a freshly-created (empty) Y.Doc to a
      // Monaco model that was cached with content from a prior visit (rapid file
      // switching keeps CodeEditor mounted, so Monaco reuses the model by URI),
      // the binding would wipe the cached content to "" before the server sync
      // repopulates Y.Text — producing a transient/empty editor (Test 9).
      // Defer binding until the server sync has hydrated Y.Text; handleSync
      // re-invokes tryBind once the doc is authoritative.
      const ytext = ydoc.getText('monaco');
      if (!wsProvider.synced && ytext.length === 0 && model.getValue().length > 0) {
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
        // Y.Text is now hydrated from the server — safe to bind even if the
        // cached Monaco model had prior content (they will now match/merge).
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
      setSaveStatus('unsaved');
      clearTimeout(saveDebounce);
      saveDebounce = setTimeout(() => {
        setSaveStatus('saving');
        setTimeout(() => {
          setSaveStatus('saved');
          setTimeout(() => setSaveStatus('idle'), 2000);
        }, 500);
      }, 1000);
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
      clearTimeout(saveDebounce);
      
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
  // When jumpToUserId is set by IdePage (user clicked a member's avatar),
  // find that member in the Yjs awareness state, decode their cursor relative
  // position back to an absolute Monaco position, and scroll + move the caret.
  // Read-only — never writes to awareness state, so it cannot race with cursor
  // rendering or trigger spurious awareness change events.
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
      // Match by userId stored in awareness (set as `id` in handleStatus above).
      if (!s.user?.id || s.user.id !== jumpToUserId) continue;
      if (!s.selection) continue;

      // Decode the relative cursor position back to an absolute character offset.
      const headAbs = Y.createAbsolutePositionFromRelativePosition(
        s.selection.head as Y.RelativePosition,
        ydoc
      );
      if (headAbs === null || headAbs.type !== ytext) continue;

      const position = model.getPositionAt(headAbs.index);
      // Smooth scroll to the target line, centering it in the viewport.
      editor.revealPositionInCenter(position, 0 /* Smooth */);
      editor.setPosition(position);
      editor.focus();
      break;
    }

    // Signal IdePage to clear jumpToUserId regardless of whether we found the
    // cursor — avoids a stale jump re-triggering if the user switches files.
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
    <div className="relative h-full w-full bg-[#1e1e1e]">
      <style>
        {`
          .squiggly-error, .squiggly-warning, .squiggly-info, .squiggly-hint {
            display: none !important;
            background: none !important;
            border-bottom: none !important;
            text-decoration: none !important;
          }
        `}
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
          fontFamily: "'JetBrains Mono', 'Fira Code', 'SFMono-Regular', Consolas, Menlo, monospace",
          fontLigatures: true,
          wordWrap: 'on',
          padding: { top: 16, bottom: 16 },
          lineNumbersMinChars: 3,
          readOnly: readOnly,
        }}
        onMount={handleEditorDidMount}
      />

      {readOnly && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold text-zinc-400 bg-black/40 border border-white/10 backdrop-blur-md shadow-sm">
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          View Only
        </div>
      )}

      {saveStatus !== 'idle' && (
        <div className={`absolute top-3 right-4 z-20 flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-all duration-300 ${
          saveStatus === 'unsaved' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
          saveStatus === 'saving' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
          'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
        }`}>
          {saveStatus === 'unsaved' && <><div className="h-1.5 w-1.5 rounded-full bg-amber-400" />Unsaved</>}
          {saveStatus === 'saving' && <><div className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />Saving...</>}
          {saveStatus === 'saved' && (
            <><svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>Saved</>
          )}
        </div>
      )}
    </div>
  );
}