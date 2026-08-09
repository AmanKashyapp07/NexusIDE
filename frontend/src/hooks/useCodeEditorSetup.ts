import { useState, useEffect, useRef, useCallback } from 'react';
import type { OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';
import { wsUrl } from '../lib/backendUrls';
import { getNexusToken } from '../lib/tokenStorage';
import { getUserColor } from '../constants/editor';

type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';
type MonacoInstance = typeof Monaco;
type MonacoCodeEditor = Monaco.editor.IStandaloneCodeEditor;

export interface AwarenessUser { name: string; color: string; id?: string; }
export interface AwarenessState { user?: AwarenessUser; selection?: { anchor: unknown; head: unknown }; }

interface UseCodeEditorSetupOptions {
  workspaceId: string;
  fileId: string;
  filename?: string;
  currentUser: { username: string; id: string };
  onCodeChange?: (code: string) => void;
  onEditorReady?: (editor: MonacoCodeEditor) => void;
  onAwarenessChange?: (users: AwarenessUser[]) => void;
  onConnectionStatusChange?: (status: ConnectionStatus) => void;
  jumpToUserId?: string | null;
  onJumpComplete?: () => void;
  onScrollSidebar?: (scrollTop: number) => void;
}

export function useCodeEditorSetup({
  workspaceId,
  fileId,
  filename,
  currentUser,
  onCodeChange,
  onEditorReady,
  onAwarenessChange,
  onConnectionStatusChange,
  jumpToUserId = null,
  onJumpComplete,
  onScrollSidebar,
}: UseCodeEditorSetupOptions) {
  const [editor, setEditor] = useState<MonacoCodeEditor | null>(null);
  const [monacoInstance, setMonacoInstance] = useState<MonacoInstance | null>(null);
  const [awarenessStates, setAwarenessStates] = useState<[number, AwarenessState][]>([]);

  const wsProviderRef = useRef<WebsocketProvider | null>(null);
  const ydocRef = useRef<Y.Doc | null>(null);
  const decorationsRef = useRef<string[]>([]);
  const modelCacheRef = useRef<Map<string, { ydoc: Y.Doc; wsProvider: WebsocketProvider; binding: MonacoBinding | null; lastUsed: number }>>(new Map());

  const [prevFileId, setPrevFileId] = useState(fileId);
  if (fileId !== prevFileId) {
    setPrevFileId(fileId);
    setAwarenessStates([]);
  }

  const callbackRefs = useRef({ onAwarenessChange, onConnectionStatusChange, onCodeChange });
  callbackRefs.current = { onAwarenessChange, onConnectionStatusChange, onCodeChange };

  // ===========================================================================
  // Yjs CRDT & Websocket Synchronization Lifecycle with Multi-Model Tab Caching
  // ===========================================================================
  useEffect(() => {
    let isActive = true;
    let boundModel: Monaco.editor.ITextModel | null = null;
    let binding: MonacoBinding | null = null;

    if (!editor || !workspaceId || !fileId) return;

    const roomName = `${workspaceId}-${fileId}`;
    const token = getNexusToken();

    // Check Multi-Model Tab Cache for instant 0ms switching
    let cached = modelCacheRef.current.get(roomName);
    let ydoc: Y.Doc;
    let wsProvider: WebsocketProvider;

    if (cached) {
      ydoc = cached.ydoc;
      wsProvider = cached.wsProvider;
      cached.lastUsed = Date.now();
    } else {
      ydoc = new Y.Doc();
      wsProvider = new WebsocketProvider(wsUrl(''), roomName, ydoc, { params: { token } });
      
      // LRU Eviction: Keep max 10 warm tabs
      if (modelCacheRef.current.size >= 10) {
        let oldestKey: string | null = null;
        let oldestTime = Infinity;
        for (const [k, v] of modelCacheRef.current.entries()) {
          if (v.lastUsed < oldestTime) {
            oldestTime = v.lastUsed;
            oldestKey = k;
          }
        }
        if (oldestKey) {
          const old = modelCacheRef.current.get(oldestKey);
          if (old) {
            old.binding?.destroy();
            old.wsProvider.destroy();
            old.ydoc.destroy();
            modelCacheRef.current.delete(oldestKey);
          }
        }
      }

      modelCacheRef.current.set(roomName, {
        ydoc,
        wsProvider,
        binding: null,
        lastUsed: Date.now(),
      });
    }

    wsProviderRef.current = wsProvider;
    ydocRef.current = ydoc;

    // Expose for E2E testing
    if (typeof window !== 'undefined') {
      (window as any).__yjsProvider = wsProvider;
      (window as any).__yjsDoc = ydoc;
    }

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
      const entry = modelCacheRef.current.get(roomName);
      if (entry) entry.binding = binding;
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

    // Direct Monaco deltaDecorations + requestAnimationFrame batching for 60fps render cap
    let animFrameId: number | null = null;
    const handleAwarenessDirect = () => {
      if (!isActive) return;
      const states = Array.from(wsProvider.awareness.getStates().entries()) as [number, AwarenessState][];
      setAwarenessStates(states);
      const users = states
        .map(([, state]) => state.user)
        .filter((user): user is AwarenessUser => Boolean(user));

      callbackRefs.current.onAwarenessChange?.(
        Array.from(new Map(users.map(u => [u.name, u])).values())
      );

      // Direct native Monaco decoration update
      if (editor && typeof editor.deltaDecorations === 'function' && monacoInstance) {
        const newDecorations: Monaco.editor.IModelDeltaDecoration[] = [];
        const model = editor.getModel();
        if (model) {
          states.forEach(([clientId, state]) => {
            if (state.user && state.selection && state.selection.head) {
              const headAbs = Y.createAbsolutePositionFromRelativePosition(
                state.selection.head as Y.RelativePosition,
                ydoc
              );
              if (headAbs && headAbs.type === ydoc.getText('monaco')) {
                const pos = model.getPositionAt(headAbs.index);
                newDecorations.push({
                  range: new monacoInstance.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
                  options: {
                    className: `remote-cursor-${clientId}`,
                    hoverMessage: { value: `**${state.user.name}** is editing here` },
                    zIndex: 100,
                  }
                });
              }
            }
          });
          decorationsRef.current = editor.deltaDecorations(decorationsRef.current, newDecorations);
        }
      }
    };

    const handleAwareness = () => {
      if (!isActive) return;
      if (animFrameId !== null) return;
      animFrameId = requestAnimationFrame(() => {
        animFrameId = null;
        handleAwarenessDirect();
      });
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
      if (animFrameId !== null) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
      }
      wsProviderRef.current = null;
      ydocRef.current = null;

      if (typeof window !== 'undefined') {
        delete (window as any).__yjsProvider;
        delete (window as any).__yjsDoc;
      }

      if (modelDisposable) modelDisposable.dispose();

      wsProvider.off('sync', handleSync);
      wsProvider.off('status', handleStatus as any);
      wsProvider.awareness.off('change', handleAwareness);
      ydoc.off('update', handleUpdate);

      if (binding) {
        binding.destroy();
        binding = null;
      }

      try {
        wsProvider.awareness.setLocalState(null);
      } catch (e) {
        // Ignore if already disconnected
      }

      wsProvider.destroy();
      ydoc.destroy();
      modelCacheRef.current.delete(roomName);

      // Clear Monaco native decorations on tab unmount
      if (editor && typeof editor.deltaDecorations === 'function' && decorationsRef.current.length > 0) {
        decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);
      }
    };
  }, [editor, workspaceId, fileId, currentUser.username, currentUser.id, monacoInstance]);

  // Handle model rebinding if filename updates while fileId remains the same
  useEffect(() => {
    if (!editor || !fileId || !ydocRef.current || !wsProviderRef.current) return;
    const model = editor.getModel();
    const expectedName = filename || fileId;
    if (model && model.uri && model.uri.path.endsWith(expectedName)) {
      const ytext = ydocRef.current.getText('monaco');
      const entry = modelCacheRef.current.get(`${workspaceId}-${fileId}`);
      if (entry && !entry.binding) {
        entry.binding = new MonacoBinding(
          ytext,
          model,
          new Set([editor]),
          wsProviderRef.current.awareness as any
        );
      }
    }
  }, [filename, editor, fileId, workspaceId]);

  // ===========================================================================
  // Jump-to-member Cursor Effect
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
  // Monaco Mount Handler
  // ===========================================================================
  const handleEditorDidMount: OnMount = useCallback((editorInstance, monaco) => {
    if (typeof window !== 'undefined') (window as any).monaco = monaco;
    setEditor(editorInstance);
    setMonacoInstance(monaco as MonacoInstance);

    if (typeof editorInstance.onDidScrollChange === 'function') {
      editorInstance.onDidScrollChange((e) => {
        onScrollSidebar?.(e.scrollTop);
      });
    }

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

    editorInstance.updateOptions({
      wordBasedSuggestions: 'off',
      inlineSuggest: { enabled: false },
      quickSuggestions: false,
      suggestOnTriggerCharacters: false,
      acceptSuggestionOnEnter: 'off',
    });

    onEditorReady?.(editorInstance);
  }, [onEditorReady, onScrollSidebar]);

  return {
    editor,
    monacoInstance,
    awarenessStates,
    ydoc: ydocRef.current,
    handleEditorDidMount,
  };
}
