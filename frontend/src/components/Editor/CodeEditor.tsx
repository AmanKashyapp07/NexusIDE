import { useState, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { useLspClient, type LspStatus } from '../../hooks/useLspClient';
import { useCodeEditorSetup, type AwarenessUser } from '../../hooks/useCodeEditorSetup';
import { useBlameAnnotations } from '../../hooks/useBlameAnnotations';

type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';
type MonacoCodeEditor = Monaco.editor.IStandaloneCodeEditor;

interface CodeEditorProps {
  workspaceId: string;
  fileId: string;
  filename?: string;
  language: string;
  currentUser: { username: string; id: string };
  authorMap?: Record<string, { userId?: string; username: string; color: string }>;
  isBlameOpen?: boolean;
  onBlameToggle?: (open: boolean) => void;
  onCodeChange?: (code: string) => void;
  onEditorReady?: (editor: MonacoCodeEditor) => void;
  onAwarenessChange?: (users: AwarenessUser[]) => void;
  onConnectionStatusChange?: (status: ConnectionStatus) => void;
  readOnly?: boolean;
  jumpToUserId?: string | null;
  onJumpComplete?: () => void;
}

export default function CodeEditor({
  workspaceId,
  fileId,
  filename,
  language,
  currentUser,
  authorMap = {},
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
  const [lspStatus, setLspStatus] = useState<LspStatus>('off');

  // Callback to sync Monaco scroll with blame sidebar
  const handleScrollSidebar = useCallback((scrollTop: number) => {
    if (blame.sidebarRef.current) {
      blame.sidebarRef.current.scrollTop = scrollTop;
    }
  }, []);

  // 1. Setup Monaco + Yjs setup hook
  const setup = useCodeEditorSetup({
    workspaceId,
    fileId,
    filename,
    currentUser,
    onCodeChange,
    onEditorReady,
    onAwarenessChange,
    onConnectionStatusChange,
    jumpToUserId,
    onJumpComplete,
    onScrollSidebar: handleScrollSidebar,
  });

  // 2. Setup Blame annotations hook
  const blame = useBlameAnnotations({
    workspaceId,
    fileId,
    isBlameOpen,
    onBlameToggle,
    editor: setup.editor,
    ydoc: setup.ydoc,
    awarenessStates: setup.awarenessStates,
    authorMap,
  });

  // 3. LSP client hook
  useLspClient({
    workspaceId,
    fileId,
    filename: filename ?? fileId,
    language,
    readOnly,
    editor: setup.editor,
    monacoInstance: setup.monacoInstance,
    onStatusChange: setLspStatus,
  });

  return (
    <div className="relative flex h-full w-full bg-[#1e1e1e] overflow-hidden">
      {/* Remote cursor and selection styles */}
      <style>
        {setup.awarenessStates.map(([clientId, state]) => {
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

      {/* Blame Sidebar */}
      {blame.showBlame && (
        <div
          ref={blame.sidebarRef}
          className="w-[260px] shrink-0 overflow-hidden bg-[#252526] border-r border-white/10 text-xs z-10"
          style={{ scrollbarWidth: 'none' }}
        >
          <div className="pt-[16px] pb-[16px]">
            {Array.from({ length: blame.lineCount }, (_, i) => i + 1).map((line) => {
              const clientId = blame.blameData.get(line);
              const author = clientId ? blame.liveAuthorMap[String(clientId)] : null;

              return (
                <div
                  key={line}
                  className="flex items-center h-[21px] px-3 hover:bg-white/5 border-l-2 border-transparent group transition-colors cursor-default"
                  style={{ borderLeftColor: author?.color || 'transparent' }}
                >
                  {author ? (
                    <>
                      <span
                        className="w-2 h-2 rounded-full mr-2 shrink-0 opacity-80"
                        style={{ backgroundColor: author.color }}
                      />
                      <span
                        className="truncate w-24 mr-2 font-medium text-zinc-300"
                        title={author.userId ? `User: ${author.username} (${author.userId})` : author.username}
                      >
                        {author.username}
                      </span>
                      <span className="truncate flex-1 text-[10px] text-zinc-500 group-hover:text-zinc-400">
                        {author.userId ? `@${author.username}` : 'Live edit'}
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

      {/* Editor Canvas */}
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
            lineHeight: 21,
            fontFamily: "'JetBrains Mono', 'Fira Code', 'SFMono-Regular', Consolas, Menlo, monospace",
            fontLigatures: true,
            wordWrap: blame.showBlame ? 'off' : 'on',
            padding: { top: 16, bottom: 16 },
            lineNumbersMinChars: 3,
            readOnly: readOnly,
            automaticLayout: true,
          }}
          onMount={setup.handleEditorDidMount}
        />

        {/* Blame Toggle Overlay Button */}
        <button
          onClick={blame.toggleBlame}
          className="absolute top-4 right-6 z-30 flex items-center gap-1.5 rounded-md bg-[#2d2d2d] hover:bg-[#3d3d3d] px-3 py-1.5 text-xs font-medium text-zinc-300 border border-white/10 transition-colors shadow-lg"
        >
          <svg className={`w-3.5 h-3.5 transition-transform ${blame.showBlame ? 'text-indigo-400' : 'text-zinc-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {blame.showBlame ? 'Hide Blame' : 'Blame'}
        </button>

        {readOnly && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold text-zinc-400 bg-black/40 border border-white/10 backdrop-blur-md shadow-sm">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            View Only
          </div>
        )}

        {/* LSP Status Badge */}
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