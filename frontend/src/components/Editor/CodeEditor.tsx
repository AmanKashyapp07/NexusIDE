import { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import * as Y from 'yjs'; // Yjs is a powerful library for building collaborative applications. It provides a shared data structure (Y.Doc) that can be synchronized across multiple clients in real-time. In this code, we use Yjs to enable collaborative editing in the Monaco code editor. The WebsocketProvider from y-websocket allows us to connect to a WebSocket server for real-time communication, while the MonacoBinding from y-monaco binds the Yjs document to the Monaco editor instance, ensuring that changes made by one user are reflected in all connected clients. This setup allows multiple users to edit the same code file simultaneously, with changes being synchronized seamlessly across all clients.
// @ts-ignore
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';
// websocket provider is a Yjs connector that enables real-time synchronization of shared data structures (Y.Doc) across multiple clients using WebSockets. It connects to a specified WebSocket server and room, allowing clients to join the same collaborative session and synchronize their changes in real-time. The MonacoBinding is a Yjs binding that connects a Y.Doc text type to a Monaco editor instance, enabling collaborative editing of code. It ensures that changes made in the Monaco editor are reflected in the Y.Doc and vice versa, allowing multiple users to edit the same code file simultaneously with real-time updates.
interface CodeEditorProps {
  workspaceId: string;
  fileId: string;
  language: string;
  currentUser: { username: string; id: string };
  onCodeChange?: (code: string) => void;
  onEditorReady?: (editor: any) => void;
  onAwarenessChange?: (users: any[]) => void;
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

export default function CodeEditor({ workspaceId, fileId, language, currentUser, onCodeChange, onEditorReady, onAwarenessChange }: CodeEditorProps) {
  const [editor, setEditor] = useState<any>(null);
  const [awarenessStates, setAwarenessStates] = useState<any[]>([]);

  useEffect(() => {
    if (!editor) return;

    const ydoc = new Y.Doc();
    const roomName = `${workspaceId}-${fileId}`;
    const wsProvider = new WebsocketProvider(
      'ws://localhost:4000',
      roomName,
      ydoc
    );

    wsProvider.awareness.setLocalStateField('user', {
      name: currentUser.username,
      color: getUserColor(currentUser.username)
    });

    const handleAwarenessChange = () => {
      const states = Array.from(wsProvider.awareness.getStates().entries());
      setAwarenessStates(states);
      
      if (onAwarenessChange) {
        const users = states.map(([, state]: any) => state.user).filter(Boolean);
        const uniqueUsers = Array.from(new Map(users.map(u => [u.name, u])).values());
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

    // The backend now handles loading the initial state from the database.
    // We no longer need to manually inject initialContent here, doing so 
    // causes duplication when the server loads state asynchronously.

    return () => {
      binding.destroy();
      wsProvider.destroy();
      ydoc.destroy();
    };
  }, [editor, workspaceId, fileId]);

  const handleEditorDidMount = (editorInstance: any) => {
    setEditor(editorInstance);
    if (onEditorReady) {
      onEditorReady(editorInstance);
    }
  };

  return (
    <div className="relative h-full w-full">
      <style>
        {awarenessStates.map(([clientId, state]) => {
          if (!state.user || !state.user.color) return '';
          return `
            .yRemoteSelection-${clientId} {
              background-color: ${state.user.color}40 !important;
            }
            .yRemoteSelectionHead-${clientId} {
              position: absolute;
              border-left: 2px solid ${state.user.color} !important;
              box-sizing: border-box;
              height: 100%;
            }
            .yRemoteSelectionHead-${clientId}::after {
              position: absolute;
              content: "${state.user.name}";
              top: -18px;
              left: -2px;
              background-color: ${state.user.color} !important;
              color: #fff;
              font-family: sans-serif;
              font-size: 10px;
              font-weight: 600;
              padding: 2px 4px;
              border-radius: 4px;
              border-bottom-left-radius: 0;
              white-space: nowrap;
              pointer-events: none;
              opacity: 0;
              transition: opacity 0.2s;
              box-shadow: 0 2px 5px rgba(0,0,0,0.3);
              z-index: 10;
            }
            .yRemoteSelectionHead-${clientId}:hover::after {
              opacity: 1;
            }
          `;
        }).join('\n')}
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
        }}
        onMount={handleEditorDidMount}
        onChange={(value) => onCodeChange && onCodeChange(value || '')}
      />
    </div>
  );
}
