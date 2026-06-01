import { useEffect, useRef, useState } from 'react';
import Editor, { useMonaco } from '@monaco-editor/react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';

interface CodeEditorProps {
  workspaceId: string;
  language: string;
  onCodeChange?: (code: string) => void;
  onEditorReady?: (editor: any) => void;
}

export default function CodeEditor({ workspaceId, language, onCodeChange, onEditorReady }: CodeEditorProps) {
  const editorRef = useRef<any>(null);
  const [provider, setProvider] = useState<WebsocketProvider | null>(null);
  const ydocRef = useRef(new Y.Doc());
  const bindingRef = useRef<any>(null);

  useEffect(() => {
    const ydoc = ydocRef.current;
    
    // Connect to Yjs WebSocket server
    const wsProvider = new WebsocketProvider(
      'ws://localhost:4000',
      workspaceId,
      ydoc
    );

    // Provide user information for awareness (live cursors)
    wsProvider.awareness.setLocalStateField('user', {
      name: `User ${Math.floor(Math.random() * 1000)}`,
      color: '#' + Math.floor(Math.random()*16777215).toString(16)
    });

    setProvider(wsProvider);

    return () => {
      wsProvider.destroy();
      ydoc.destroy();
    };
  }, [workspaceId]);

  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor;
    
    if (provider) {
      const type = ydocRef.current.getText('monaco');
      
      // Bind Yjs to Monaco
      bindingRef.current = new MonacoBinding(
        type,
        editor.getModel(),
        new Set([editor]),
        provider.awareness
      );
    }
    
    if (onEditorReady) {
      onEditorReady(editor);
    }
  };

  return (
    <div className="h-full w-full rounded-md overflow-hidden border border-slate-700 shadow-xl">
      <Editor
        height="100%"
        language={language}
        theme="vs-dark"
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          wordWrap: 'on',
          padding: { top: 16 },
        }}
        onMount={handleEditorDidMount}
        onChange={(value) => onCodeChange && onCodeChange(value || '')}
      />
    </div>
  );
}
