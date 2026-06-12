import { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import * as Y from 'yjs'; 
// @ts-ignore
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';
import { IndexeddbPersistence } from 'y-indexeddb';
import { LspClient } from './lspClient';
import { type AppFile } from '../Sidebar/Sidebar';

interface CodeEditorProps {
  workspaceId: string;
  fileId: string;
  language: string;
  currentUser: { username: string; id: string };
  onCodeChange?: (code: string) => void;
  onEditorReady?: (editor: any) => void;
  onAwarenessChange?: (users: any[]) => void;
  onConnectionStatusChange?: (status: 'connected' | 'disconnected' | 'connecting') => void;
  readOnly?: boolean;
  files?: AppFile[];
}

const COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#a855f7', // purple
  '#ec4899', // pink
];

const getUserColor = (username: string) => {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
};

// Languages supported by our backend LSP relay
const LSP_SUPPORTED_LANGUAGES = new Set(['python', 'javascript', 'typescript']);

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
  files = [],
}: CodeEditorProps) {
  const [editor, setEditor] = useState<any>(null);
  const [monacoInstance, setMonacoInstance] = useState<any>(null);
  const [awarenessStates, setAwarenessStates] = useState<any[]>([]);

  // ── Collaborative editing (Yjs) ────────────────────────────────────────────
  useEffect(() => {
    if (!editor) return;

    const ydoc = new Y.Doc();
    const roomName = `${workspaceId}-${fileId}`;

    // Offline persistence
    const indexeddbProvider = new IndexeddbPersistence(roomName, ydoc);

    const token = localStorage.getItem('token') || '';
    const wsProvider = new WebsocketProvider(
      'ws://localhost:4000',
      roomName,
      ydoc,
      { params: { token } }
    );

    let isActive = true;

    const handleStatusChange = (event: { status: 'connected' | 'disconnected' | 'connecting' }) => {
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
        const users = states.map(([, state]: any) => state.user).filter(Boolean);
        const uniqueUsers = Array.from(new Map(users.map((u: any) => [u.name, u])).values());
        onAwarenessChange(uniqueUsers);
      }
    };

    wsProvider.awareness.on('change', handleAwarenessChange);
    handleAwarenessChange();

    const type = ydoc.getText('monaco');
    const binding = new MonacoBinding(
      type,
      editor.getModel(),
      new Set([editor]),
      wsProvider.awareness
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
  }, [editor, workspaceId, fileId]);

  // Compute relative file path inside container
  const computeFilePath = (fid: string, allFiles: AppFile[]): string => {
    const file = allFiles.find(f => f.id === fid);
    if (!file) return '';
    const parts = [file.name];
    let pId = file.parent_id;
    while (pId) {
      const parent = allFiles.find(f => f.id === pId);
      if (!parent) break;
      parts.unshift(parent.name);
      pId = parent.parent_id;
    }
    return parts.join('/');
  };

  const filePath = computeFilePath(fileId, files);

  // ── LSP integration (best-effort, never crashes the editor) ───────────────
  useEffect(() => {
    if (!editor || readOnly) return;
    if (!LSP_SUPPORTED_LANGUAGES.has(language)) return;

    const token = localStorage.getItem('token') || '';
    if (!token) {
      console.warn('[LSP] No auth token — skipping LSP');
      return;
    }

    // Validate JWT expiry client-side by decoding the payload (no secret required
    // for decoding — only for verifying). This catches stale tokens before we
    // even open the WebSocket, giving a clear console message instead of 4401.
    try {
      const payloadBase64 = token.split('.')[1];
      if (payloadBase64) {
        const payload = JSON.parse(atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/')));
        const nowSec = Math.floor(Date.now() / 1000);
        if (payload.exp && payload.exp < nowSec) {
          console.warn('[LSP] JWT token is expired — skipping LSP. Please log out and log back in.');
          return;
        }
      }
    } catch (_) {
      // malformed token, let the server reject it
    }

    const lspLang = language; // python | javascript | typescript
    const socketUrl = `ws://localhost:4000/ws/lsp/${workspaceId}/${lspLang}?token=${encodeURIComponent(token)}`;

    let lspClient: LspClient | null = null;
    try {
      lspClient = new LspClient(socketUrl, editor, monacoInstance, lspLang, filePath);
    } catch (err) {
      console.warn('[LSP] Failed to create LSP client (non-fatal):', err);
    }

    return () => {
      try {
        lspClient?.dispose();
      } catch (_) { /* ignore */ }
    };
  }, [editor, monacoInstance, workspaceId, language, readOnly, fileId, filePath]);


  const handleEditorDidMount = (editorInstance: any, monaco: any) => {
    setEditor(editorInstance);
    setMonacoInstance(monaco);
    if (onEditorReady) {
      onEditorReady(editorInstance);
    }
  };

  return (
    <div className="relative h-full w-full">
      <style>
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
              top: -24px;
              left: -2px;
              background-color: ${color} !important;
              color: #ffffff;
              font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
              font-size: 11px;
              font-weight: 600;
              line-height: 1;
              padding: 4px 6px;
              border-radius: 4px 4px 4px 0px;
              white-space: nowrap;
              pointer-events: none;
              opacity: 0;
              transform: translateY(4px);
              transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
              box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 2px 4px -1px rgba(0, 0, 0, 0.1);
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
        loading={<div className="h-full w-full bg-transparent" />}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
          wordWrap: 'on',
          padding: { top: 12 },
          lineNumbersMinChars: 3,
          scrollBeyondLastLine: false,
          renderLineHighlight: 'none',
          readOnly: readOnly,
        }}
        onMount={handleEditorDidMount}
        onChange={(value) => onCodeChange && onCodeChange(value || '')}
      />
    </div>
  );
}