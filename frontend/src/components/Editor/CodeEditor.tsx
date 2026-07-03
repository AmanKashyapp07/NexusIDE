import { useEffect, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';
import { IndexeddbPersistence } from 'y-indexeddb';

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

  useEffect(() => {
    if (!editor) return;

    const ydoc = new Y.Doc();
    const roomName = `${workspaceId}-${fileId}`;
    const indexeddbProvider = new IndexeddbPersistence(roomName, ydoc);
    const token = localStorage.getItem('token') || '';
    const wsProvider = new WebsocketProvider(
      'ws://localhost:4000',
      roomName,
      ydoc,
      { params: { token } }
    ) as CollaborationProvider;

    let isActive = true;

    const handleStatusChange = (event: { status: ConnectionStatus }) => {
      if (isActive && onConnectionStatusChange) {
        onConnectionStatusChange(event.status);
      }
      if (isActive && event.status === 'connected') {
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

      if (onAwarenessChange) {
        const users = states
          .map(([, state]) => state.user)
          .filter((user): user is AwarenessUser => Boolean(user));
        const uniqueUsers = Array.from(new Map(users.map((user) => [user.name, user])).values());
        onAwarenessChange(uniqueUsers);
      }
    };

    wsProvider.awareness.on('change', handleAwarenessChange);
    handleAwarenessChange();

    const type = ydoc.getText('monaco');
    const model = editor.getModel();
    if (!model) return;

    // Yjs owns document reconciliation while Monaco stays focused on editor rendering.
    const binding = new MonacoBinding(
      type,
      model,
      new Set([editor]),
      wsProvider.awareness as ConstructorParameters<typeof MonacoBinding>[3]
    );

    return () => {
      isActive = false;
      wsProvider.off('status', handleStatusChange);
      wsProvider.awareness.off('change', handleAwarenessChange);
      binding.destroy();
      wsProvider.destroy();
      indexeddbProvider.destroy();
      ydoc.destroy();
    };
  }, [editor, workspaceId, fileId, currentUser.username, onAwarenessChange, onConnectionStatusChange]);

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
              const res = await fetch(`http://localhost:4000/api/workspace/${workspaceId}/autocomplete`, {
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
              background-color: ${color}25 !important;
            }
            .yRemoteSelectionHead-${clientId} {
              position: absolute;
              border-left: 2px solid ${color} !important;
              box-sizing: border-box;
              height: 100%;
              z-index: 10;
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
              opacity: 0;
              transform: translateY(2px);
              transition: opacity 0.15s ease-out, transform 0.15s ease-out;
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
              z-index: 20;
            }
            .yRemoteSelectionHead-${clientId}:hover::after {
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
          readOnly,
        }}
        onMount={handleEditorDidMount}
        onChange={(value) => onCodeChange?.(value || '')}
      />
    </div>
  );
}