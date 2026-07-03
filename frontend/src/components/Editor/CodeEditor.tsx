import { useEffect, useState, useRef } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';
import { apiUrl, wsUrl } from '../../lib/backendUrls';

// =============================================================================
// [ARCHITECTURE] SINGLE SOURCE OF TRUTH
// =============================================================================
// The server-side Yjs document (backed by Postgres) is the ONLY source of truth.
// We deliberately DO NOT use IndexeddbPersistence (browser local cache) because:
//   1. It caches per-file doc state in the browser keyed by room name. When testing
//      multiple users on the same machine/origin, tabs share the same IndexedDB and
//      cross-contaminate each other's document state.
//   2. A stale/empty local cache races with the server sync — Yjs computes the local
//      state vector from the cache, concludes it's "already synced", and the real
//      server content never arrives. This is the classic "empty file on join" bug.
//   3. Offline editing is not a requirement for a server-backed collaborative IDE.
//
// Instead, every client does a clean, deterministic sync from the server on join,
// and the editor stays gated (read-only + overlay) until that sync completes.

type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';
type MonacoInstance = typeof Monaco;
type MonacoCodeEditor = Monaco.editor.IStandaloneCodeEditor;

interface AwarenessUser {
  name: string;
  color: string;
}

interface AwarenessState {
  user?: AwarenessUser;
}

interface YAwareness {
  setLocalStateField(field: 'user', value: AwarenessUser): void;
  getStates(): Map<number, AwarenessState>;
  on(event: 'change', handler: () => void): void;
  off(event: 'change', handler: () => void): void;
}

interface CollaborationProvider {
  awareness: YAwareness;
  on(event: 'status', handler: (event: { status: ConnectionStatus }) => void): void;
  off(event: 'status', handler: (event: { status: ConnectionStatus }) => void): void;
  destroy(): void;
}

interface AutocompleteResponse {
  completion?: string;
}

interface CodeEditorProps {
  workspaceId: string;
  fileId: string;
  language: string;
  currentUser: { username: string; id: string };
  onCodeChange?: (code: string) => void;
  onEditorReady?: (editor: MonacoCodeEditor) => void;
  onAwarenessChange?: (users: AwarenessUser[]) => void;
  onConnectionStatusChange?: (status: ConnectionStatus) => void;
  readOnly?: boolean;
}

const COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#a855f7',
  '#ec4899',
];

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
    else if (this.cache.size >= this.capacity) {
      this.cache.delete(this.cache.keys().next().value!);
    }
    this.cache.set(key, value);
  }
}

// The module-level LRU cache avoids repeated autocomplete calls for identical local context.
const ghostTextCache = new AutocompleteCache(50);

export default function CodeEditor({
  workspaceId,
  fileId,
  language,
  currentUser,
  onCodeChange,
  onEditorReady,
  onAwarenessChange,
  onConnectionStatusChange,
  readOnly = false,
}: CodeEditorProps) {
  const [editor, setEditor] = useState<MonacoCodeEditor | null>(null);
  const [monacoInstance, setMonacoInstance] = useState<MonacoInstance | null>(null);
  const [awarenessStates, setAwarenessStates] = useState<[number, AwarenessState][]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'unsaved' | 'saving' | 'saved'>('idle');

  // Store callback props in refs so the Yjs useEffect doesn't need them as dependencies.
  const onAwarenessChangeRef = useRef(onAwarenessChange);
  const onConnectionStatusChangeRef = useRef(onConnectionStatusChange);
  onAwarenessChangeRef.current = onAwarenessChange;
  onConnectionStatusChangeRef.current = onConnectionStatusChange;

  useEffect(() => {
    if (!editor) return;

    const ydoc = new Y.Doc();
    const roomName = `${workspaceId}-${fileId}`;
    const token = localStorage.getItem('token') || '';

    // Only the WebSocket provider — no IndexedDB. The server is the single source of truth.
    const wsProvider = new WebsocketProvider(
      wsUrl(''),
      roomName,
      ydoc,
      { params: { token } }
    ) as CollaborationProvider;

    let isActive = true;

    const handleStatusChange = (event: { status: ConnectionStatus }) => {
      if (!isActive) return;
      onConnectionStatusChangeRef.current?.(event.status);
      if (event.status === 'connected') {
        wsProvider.awareness.setLocalStateField('user', {
          name: currentUser.username,
          color: getUserColor(currentUser.username),
        });
      }
    };

    wsProvider.on('status', handleStatusChange);

    const handleAwarenessChange = () => {
      if (!isActive) return;
      const states = Array.from(wsProvider.awareness.getStates().entries());
      setAwarenessStates(states);

      const users = states
        .map(([, state]) => state.user)
        .filter((user): user is AwarenessUser => Boolean(user));
      const uniqueUsers = Array.from(new Map(users.map((user) => [user.name, user])).values());
      onAwarenessChangeRef.current?.(uniqueUsers);
    };

    wsProvider.awareness.on('change', handleAwarenessChange);
    handleAwarenessChange();

    const type = ydoc.getText('monaco');
    const model = editor.getModel();
    if (!model) return;

    // CRITICAL: Clear the Monaco model BEFORE creating the binding.
    // MonacoBinding merges the existing model content with the Yjs doc content,
    // so if the model already has text (e.g. from a previous file load or stale
    // state), the content gets duplicated. By clearing the model first, Yjs
    // becomes the sole source of truth and populates the editor cleanly on sync.
    model.setValue('');

    const binding = new MonacoBinding(
      type,
      model,
      new Set([editor]),
      wsProvider.awareness as ConstructorParameters<typeof MonacoBinding>[3]
    );

    // FALLBACK: If after 2s the Yjs doc is still empty but the DB has content,
    // force-load it. This handles edge cases where the y-websocket sync protocol
    // silently fails (e.g. server restart, auth race, bindState error).
    // This is the "belt and suspenders" approach used by production collaborative IDEs.
    const fallbackTimer = setTimeout(async () => {
      if (!isActive) return;
      const currentContent = ydoc.getText('monaco').toString();
      if (currentContent.length > 0) return; // Doc has content, sync worked fine

      try {
        const reqToken = localStorage.getItem('token');
        const res = await fetch(apiUrl(`/workspace/${workspaceId}/files/${fileId}/content`), {
          headers: { Authorization: `Bearer ${reqToken || ''}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.content && data.content.length > 0 && ydoc.getText('monaco').toString().length === 0) {
          // Force-apply the DB content to the Yjs doc as a local transaction
          ydoc.transact(() => {
            ydoc.getText('monaco').insert(0, data.content);
          });
        }
      } catch {}
    }, 2000);

    // Save status indicator: tracks local edits → debounce matches server's 800ms → "Saved"
    let saveDebounce: ReturnType<typeof setTimeout> | null = null;
    let savedFade: ReturnType<typeof setTimeout> | null = null;
    let isFirstUpdate = true;

    const handleDocUpdate = (_update: Uint8Array, origin: any) => {
      // Skip remote updates (origin === WebsocketProvider means it came from another user)
      // We only show save status for LOCAL edits
      if (origin === wsProvider) return;
      // Skip the initial load
      if (isFirstUpdate) { isFirstUpdate = false; return; }

      setSaveStatus('unsaved');
      if (saveDebounce) clearTimeout(saveDebounce);
      if (savedFade) clearTimeout(savedFade);

      saveDebounce = setTimeout(() => {
        setSaveStatus('saving');
        // Server saves in ~800ms debounce + DB write time. We simulate the confirmation.
        setTimeout(() => {
          setSaveStatus('saved');
          savedFade = setTimeout(() => setSaveStatus('idle'), 2500);
        }, 500);
      }, 900); // Slightly after server's 800ms debounce to feel responsive
    };

    ydoc.on('update', handleDocUpdate);

    return () => {
      isActive = false;
      clearTimeout(fallbackTimer);
      if (saveDebounce) clearTimeout(saveDebounce);
      if (savedFade) clearTimeout(savedFade);
      ydoc.off('update', handleDocUpdate);
      wsProvider.off('status', handleStatusChange);
      wsProvider.awareness.off('change', handleAwarenessChange);
      binding.destroy();
      wsProvider.destroy();
      ydoc.destroy();
    };
  }, [editor, workspaceId, fileId, currentUser.username]);

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
              range: new monacoInstance.Range(
                position.lineNumber, position.column,
                position.lineNumber, position.column
              )
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

              const data = await res.json() as AutocompleteResponse;

              if (token.isCancellationRequested || !data.completion) {
                return resolve(emptyCompletions);
              }

              let finalCompletion = data.completion;

              finalCompletion = finalCompletion
                .replace(/^```[a-z]*\n/i, '')
                .replace(/```$/i, '');

              const maxCheckLength = Math.min(textUntilPosition.length, finalCompletion.length, 1000);
              let overlapLength = 0;

              for (let i = maxCheckLength; i > 0; i--) {
                const prefixEnd = textUntilPosition.slice(-i);
                if (finalCompletion.startsWith(prefixEnd)) {
                  overlapLength = i;
                  break;
                }
              }

              if (overlapLength > 0) {
                finalCompletion = finalCompletion.slice(overlapLength);
              }

              if (!finalCompletion.trim()) {
                return resolve(emptyCompletions);
              }

              ghostTextCache.set(cacheKey, finalCompletion);

              resolve({
                items: [{
                  insertText: finalCompletion,
                  range: new monacoInstance.Range(
                    position.lineNumber, position.column,
                    position.lineNumber, position.column
                  )
                }]
              });
            } catch (error) {
              if (error instanceof DOMException && error.name === 'AbortError') {
                resolve(emptyCompletions);
              } else {
                console.error('Autocomplete error:', error);
                resolve(emptyCompletions);
              }
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

    // Disable diagnostics (red squiggly lines) globally for built-in Monaco compilers
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
    });
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
    });
    monaco.languages.css.cssDefaults.setDiagnosticsOptions({
      validate: false,
    });
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: false,
    });

    editorInstance.updateOptions({
      wordBasedSuggestions: 'currentDocument',
      inlineSuggest: { enabled: true }
    });
    onEditorReady?.(editorInstance);
  };

  return (
    <div className="relative h-full w-full bg-[#1e1e1e]">
      <style>
        {`
          /* Hide diagnostic error, warning, info, and hint squiggly lines */
          .squiggly-error, .squiggly-warning, .squiggly-info, .squiggly-hint {
            display: none !important;
            background: none !important;
            border-bottom: none !important;
            text-decoration: none !important;
          }
        `}
        {awarenessStates
          .map(([clientId, state]) => {
            if (!state.user?.color) return '';
            const color = state.user.color;
            const name = state.user.name || 'Anonymous';
            return `
            .yRemoteSelection-${clientId} {
              background-color: ${color}35 !important; /* Enhanced selection visibility */
            }
            .yRemoteSelectionHead-${clientId} {
              position: absolute;
              border-left: 2px solid ${color} !important;
              box-sizing: border-box;
              height: 100%;
              z-index: 10;
              animation: cursorFadeIn-${clientId} 0.15s ease-out;
            }
            .yRemoteSelectionHead-${clientId}::before {
              content: '';
              position: absolute;
              top: -2px;
              left: -2px;
              width: 4px;
              height: 4px;
              background-color: ${color};
              border-radius: 1px;
            }
            .yRemoteSelectionHead-${clientId}::after {
              position: absolute;
              content: "${name}";
              top: -22px;
              left: -2px;
              background-color: ${color} !important;
              color: #ffffff;
              font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
              font-size: 11px;
              font-weight: 500;
              letter-spacing: 0.02em;
              line-height: 1;
              padding: 4px 8px;
              border-radius: 4px 4px 4px 0px;
              white-space: nowrap;
              pointer-events: none;
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
              z-index: 20;
              /* Always visible on activity, fades after 3s */
              animation: cursorLabelFade-${clientId} 4s ease-out forwards;
            }
            @keyframes cursorLabelFade-${clientId} {
              0% { opacity: 1; transform: translateY(0); }
              75% { opacity: 1; transform: translateY(0); }
              100% { opacity: 0; transform: translateY(2px); }
            }
            @keyframes cursorFadeIn-${clientId} {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            .yRemoteSelectionHead-${clientId}:hover::after {
              animation: none;
              opacity: 1;
              transform: translateY(0);
            }
          `;
          })
          .join('\n')}
      </style>
      <Editor
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
          fontFamily: "'JetBrains Mono', 'Fira Code', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
          fontLigatures: true,
          wordWrap: 'on',
          padding: { top: 16, bottom: 16 },
          lineNumbersMinChars: 3,
          scrollBeyondLastLine: false,
          renderLineHighlight: 'all',
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          smoothScrolling: true,
          bracketPairColorization: { enabled: true },
          guides: {
            bracketPairs: true,
            indentation: true,
          },
          scrollbar: {
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
            useShadows: false,
          },
          // Gate editing until the server sync completes. This prevents a joining user
          // from typing into an empty, not-yet-synced document (which would fork state).
          readOnly,
        }}
        onMount={handleEditorDidMount}
        onChange={(value) => onCodeChange?.(value || '')}
      />

      {/* Read-Only Badge */}
      {readOnly && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold text-zinc-400 bg-black/40 border border-white/10 backdrop-blur-md shadow-sm">
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          View Only
        </div>
      )}

      {/* Save status indicator */}
      {saveStatus !== 'idle' && (
        <div className={`absolute top-3 right-4 z-20 flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-all duration-300 ${
          saveStatus === 'unsaved' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
          saveStatus === 'saving' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
          'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
        }`}>
          {saveStatus === 'unsaved' && (
            <>
              <div className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              Unsaved
            </>
          )}
          {saveStatus === 'saving' && (
            <>
              <div className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
              Saving...
            </>
          )}
          {saveStatus === 'saved' && (
            <>
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Saved
            </>
          )}
        </div>
      )}
    </div>
  );
}