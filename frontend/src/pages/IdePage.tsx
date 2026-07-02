import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import CodeEditor from '../components/Editor/CodeEditor';
import TerminalPanel from '../components/Terminal/TerminalPanel';
import Sidebar, { type AppFile } from '../components/Sidebar/Sidebar';
import { useToast } from '../components/Toast/Toast';
import VoiceChat from '../components/Voice/VoiceChat';
import CollaboratorsModal from '../components/Collaborators/CollaboratorsModal';
import { Users, LogOut, Loader2, TerminalSquare, RotateCcw, Download, ChevronRight, FileText, Code2, Globe, Zap, Folder } from 'lucide-react';
import * as Y from 'yjs';
// @ts-ignore — y-websocket lacks complete TypeScript declarations
import { WebsocketProvider } from 'y-websocket';
import { io, type Socket } from 'socket.io-client';

type UserRole = 'admin' | 'editor' | 'viewer';
type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';

interface User {
  username: string;
  id: string;
}

interface CollaboratorPresence {
  userId: string;
  username: string;
  color: string;
  activeFileId: string | null;
}

interface WorkspaceProvider {
  doc: Y.Doc;
  on(event: 'status', handler: (event: { status: ConnectionStatus }) => void): void;
  destroy(): void;
}

interface EditorHandle {
  setValue(value: string): void;
}

// Helper to give a touch of color to files based on extension in the tab
const getFileColor = (name: string) => {
  const lower = name.toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'text-[#3178c6]';
  if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'text-[#f7df1e]';
  if (lower.endsWith('.py')) return 'text-[#3572A5]';
  if (lower.endsWith('.html')) return 'text-[#e34c26]';
  if (lower.endsWith('.css')) return 'text-[#563d7c]';
  if (lower.endsWith('.json')) return 'text-[#cbd5e1]';
  if (lower.endsWith('.md')) return 'text-[#3b82f6]';
  return 'text-zinc-400';
};

function IdePage() {
  const [user, setUser] = useState<User | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceTitle, setWorkspaceTitle] = useState<string>('Loading...');
  const [files, setFiles] = useState<AppFile[]>([]);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [activeCollaborators, setActiveCollaborators] = useState<CollaboratorPresence[]>([]);
  const [isCollabModalOpen, setIsCollabModalOpen] = useState(false);
  const [isActiveMembersOpen, setIsActiveMembersOpen] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [terminalKey, setTerminalKey] = useState(0);
  const { addToast } = useToast();

  const handleConnectionStatusChange = (status: ConnectionStatus) => {
    setConnectionStatus((prevStatus) => {
      if (prevStatus !== status) {
        if (status === 'connected') {
          addToast('Editor synchronized with workspace.', 'success');
        } else if (status === 'disconnected') {
          addToast('Connection lost. Retrying...', 'error');
        }
      }
      return status;
    });
  };

  const sidebarWidth = 256;
  const editorWidth = 60;
  const mainSplitRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorHandle | null>(null);
  const workspaceWsProviderRef = useRef<WorkspaceProvider | null>(null);
  const presenceSocketRef = useRef<Socket | null>(null);
  const navigate = useNavigate();
  const { workspaceId: urlWorkspaceId, fileId: urlFileId } = useParams<{ workspaceId: string, fileId: string }>();

  const activeFile = useMemo(() => {
    const firstFile = files.find((file) => file.type === 'file') || null;
    if (!urlFileId) return firstFile;
    return files.find((file) => file.id === urlFileId && file.type === 'file') || firstFile;
  }, [files, urlFileId]);
  const activeFileId = activeFile?.id ?? null;
  
  const fetchFiles = async (wsId: string) => {
    try {
      const token = localStorage.getItem('token');
      const filesRes = await fetch(`http://localhost:4000/api/workspace/${wsId}/files`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (filesRes.ok) {
        const filesData = await filesRes.json();
        setFiles(filesData);
      }
    } catch (err) {
      console.error('Failed to fetch files', err);
    }
  };

  useEffect(() => {
    const initWorkspace = async () => {
      const token = localStorage.getItem('token');
      if (!token) {
        navigate('/login');
        return;
      }

      try {
        const userRes = await fetch('http://localhost:4000/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!userRes.ok) {
          localStorage.removeItem('token');
          navigate('/login');
          return;
        }

        const userData = await userRes.json();
        setUser(userData.user);

        const wsRes = await fetch(`http://localhost:4000/api/workspace/${urlWorkspaceId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!wsRes.ok) {
          navigate('/dashboard');
          return;
        }

        const wsData = await wsRes.json();
        setWorkspaceId(wsData.id);
        setWorkspaceTitle(wsData.title);
        setUserRole(wsData.userRole || 'viewer');

        await fetchFiles(wsData.id);
      } catch (err) {
        console.error(err);
        navigate('/login');
      }
    };

    if (urlWorkspaceId) {
      initWorkspace();
    } else {
      navigate('/dashboard');
    }
  }, [navigate, urlWorkspaceId]);

  useEffect(() => {
    if (!urlWorkspaceId || !user) return;

    const ydoc = new Y.Doc();
    const token = localStorage.getItem('token') || '';
    const wsProvider = new WebsocketProvider(
      'ws://localhost:4000',
      `workspace-${urlWorkspaceId}`,
      ydoc,
      { params: { token } }
    ) as WorkspaceProvider;
    workspaceWsProviderRef.current = wsProvider;

    const eventsMap = ydoc.getMap('workspace-events');
    eventsMap.observe(() => {
      fetchFiles(urlWorkspaceId);
    });

    wsProvider.on('status', (event: { status: ConnectionStatus }) => {
      setConnectionStatus(event.status);
    });

    return () => {
      wsProvider.destroy();
      ydoc.destroy();
      workspaceWsProviderRef.current = null;
    };
  }, [urlWorkspaceId, user]);

  useEffect(() => {
    if (!urlWorkspaceId || !user) return;

    const token = localStorage.getItem('token') || '';
    const socket = io('http://localhost:4000', {
      auth: { token },
    });
    presenceSocketRef.current = socket;

    socket.on('connect', () => {
      console.log('[Socket] Connected to server, joining workspace room:', urlWorkspaceId);
      socket.emit('join-workspace', { workspaceId: urlWorkspaceId });
    });

    socket.on('workspace-presence-update', (users: CollaboratorPresence[]) => {
      console.log('[Socket] Received presence update:', users);
      setActiveCollaborators(users);
    });

    socket.on('file-tree-update', () => {
      console.log('[Socket] Received file-tree-update, fetching fresh file tree...');
      fetchFiles(urlWorkspaceId);
    });

    return () => {
      console.log('[Socket] Disconnecting from workspace:', urlWorkspaceId);
      socket.emit('leave-workspace');
      socket.disconnect();
      presenceSocketRef.current = null;
    };
  }, [urlWorkspaceId, user]);

  useEffect(() => {
    if (presenceSocketRef.current && activeFileId) {
      presenceSocketRef.current.emit('active-file-change', { activeFileId });
    }
  }, [activeFileId]);

  useEffect(() => {
    if (files.length === 0) return;

    if (!urlFileId) {
      if (activeFileId) {
        navigate(`/ide/${urlWorkspaceId}/${activeFileId}`, { replace: true });
      }
      return;
    }

    if (activeFileId && activeFileId !== urlFileId) {
      navigate(`/ide/${urlWorkspaceId}/${activeFileId}`, { replace: true });
    }
  }, [urlFileId, files.length, urlWorkspaceId, navigate, activeFileId]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/login');
  };

  const broadcastFileTreeUpdate = () => {
    workspaceWsProviderRef.current?.doc.getMap('workspace-events').set('lastFileUpdate', Date.now());
  };

  const handleFileCreate = async (name: string, type: 'file' | 'directory', language: string | null, parentId: string | null) => {
    if (!workspaceId) return;

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`http://localhost:4000/api/workspace/${workspaceId}/files`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name, type, parent_id: parentId, language }),
      });

      const newFile = await res.json();
      if (!res.ok) throw new Error(newFile.error);

      setFiles((prev) => [...prev, newFile].sort((a, b) => a.name.localeCompare(b.name)));
      broadcastFileTreeUpdate();

      if (type === 'file') {
        navigate(`/ide/${urlWorkspaceId}/${newFile.id}`);
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to create file', 'error');
    }
  };

  const handleFileDelete = async (id: string) => {
    if (!workspaceId) return;

    try {
      const token = localStorage.getItem('token');
      await fetch(`http://localhost:4000/api/workspace/${workspaceId}/files/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      setFiles((prev) => prev.filter((f) => f.id !== id));
      if (activeFile?.id === id) {
        editorRef.current?.setValue('');
      }

      broadcastFileTreeUpdate();
    } catch (err) {
      console.error(err);
    }
  };

  const handleExportWorkspace = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`http://localhost:4000/api/workspace/${workspaceId}/export`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || 'Failed to export workspace');
      }
      
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${workspaceTitle || 'workspace'}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[Export Workspace Error]', err);
      const message = err instanceof Error ? err.message : 'Unknown export error';
      addToast(`Failed to export: ${message}`, 'error');
    }
  };

  if (!user || !workspaceId) {
    return (
      <div className="relative flex h-screen w-full items-center justify-center overflow-hidden bg-[#07060b] text-zinc-300">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="nx-orb nx-orb-1" />
          <div className="nx-orb nx-orb-2" />
        </div>
        <div className="relative flex flex-col items-center gap-4 rounded-[1.75rem] nx-glass-strong px-8 py-10 shadow-[0_24px_90px_rgba(0,0,0,0.5)]">
          <Loader2 className="h-8 w-8 animate-spin text-violet-300" />
          <p className="text-sm text-zinc-400">Initializing your workspace...</p>
        </div>
      </div>
    );
  }

  const getFileBreadcrumbs = () => {
    if (!activeFile) return [];

    const path = [activeFile];
    let currentParentId = activeFile.parent_id;
    let depth = 0;
    while (currentParentId && depth < 20) {
      const parent = files.find(f => f.id === currentParentId);
      if (parent) {
        path.unshift(parent);
        currentParentId = parent.parent_id;
        depth++;
      } else {
        break;
      }
    }
    return path;
  };

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden bg-[#07060b] text-zinc-300 selection:bg-violet-400/25">
      
      {/* Ambient Background Orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none nx-orb-dim">
        <div className="nx-orb nx-orb-1" />
        <div className="nx-orb nx-orb-2" />
      </div>

      {/* Frosted Glass Header */}
      <header className="relative z-50 flex shrink-0 items-center justify-between border-b border-violet-500/10 bg-[rgba(13,12,20,0.80)] px-5 py-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.25),0_0_1px_rgba(139,92,246,0.10)] backdrop-blur-2xl">

        {/* Left: Logo + Workspace title */}
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-violet-400/15 bg-violet-400/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <Zap className="text-violet-300" size={16} />
          </div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="font-semibold text-white">{workspaceTitle}</span>
            {userRole && (
              <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.22em] ${
                userRole === 'admin' ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' :
                userRole === 'editor' ? 'border-blue-400/20 bg-blue-400/10 text-blue-300' :
                'border-orange-400/20 bg-orange-400/10 text-orange-300'
              }`}>
                {userRole}
              </span>
            )}
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          <VoiceChat workspaceId={workspaceId} user={user} />

          {/* Connection Status */}
          <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
            connectionStatus === 'connected'
              ? 'border-emerald-400/15 bg-emerald-400/10 text-emerald-200'
              : connectionStatus === 'disconnected'
                ? 'border-red-400/15 bg-red-400/10 text-red-200'
                : 'border-amber-400/15 bg-amber-400/10 text-amber-200'
          }`}>
            <span className="relative flex h-2 w-2">
              {connectionStatus !== 'disconnected' && (
                <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-70 ${
                  connectionStatus === 'connected' ? 'bg-emerald-400' : 'bg-amber-400'
                }`} />
              )}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${
                connectionStatus === 'connected' ? 'bg-emerald-400' :
                connectionStatus === 'disconnected' ? 'bg-red-400' : 'bg-amber-400'
              }`} />
            </span>
            <span>{connectionStatus === 'connected' ? 'Live Sync' : connectionStatus === 'disconnected' ? 'Offline' : 'Connecting...'}</span>
          </div>

          {/* Active Members Dropdown */}
          {activeCollaborators.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setIsActiveMembersOpen((isOpen) => !isOpen)}
                className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20"
              >
                <div className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </div>
                {activeCollaborators.length} Online
              </button>

              {isActiveMembersOpen && (
                <div className="absolute right-0 top-full mt-2 w-52 rounded-2xl border border-white/10 bg-[#0d0c14] p-2 shadow-2xl z-50">
                  <div className="mb-2 px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 border-b border-white/5">
                    Active Members
                  </div>
                  <div className="max-h-48 overflow-y-auto flex flex-col gap-1">
                    {activeCollaborators.map((c) => (
                      <button
                        key={c.userId}
                        onClick={() => {
                          if (c.activeFileId && c.activeFileId !== activeFileId) {
                            navigate(`/ide/${workspaceId}/${c.activeFileId}`);
                            setIsActiveMembersOpen(false);
                          }
                        }}
                        className={`w-full flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors ${
                          c.activeFileId ? 'hover:bg-white/10 cursor-pointer' : 'opacity-70 cursor-default'
                        }`}
                        title={c.activeFileId ? 'Jump to their file' : 'Idle'}
                      >
                        <div
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white border border-white/10"
                          style={{ backgroundColor: c.color || '#8b5cf6' }}
                        >
                          {c.username ? c.username.substring(0, 2).toUpperCase() : '??'}
                        </div>
                        <div className="flex flex-col items-start min-w-0">
                          <span className="text-xs text-zinc-300 truncate w-full text-left">{c.username || 'Unknown'}</span>
                          {c.activeFileId && (
                            <span className="text-[10px] text-violet-400/80 truncate w-full text-left">
                              {files.find(f => f.id === c.activeFileId)?.name || 'Editing'}
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => setIsCollabModalOpen(true)}
            className="flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-300 transition-colors hover:bg-violet-500/20"
          >
            <Users size={14} />
            Share
          </button>

          <button
            onClick={handleExportWorkspace}
            className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/10"
            title="Export as ZIP"
          >
            <Download size={14} />
            Export
          </button>

          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/10"
          >
            Dashboard
          </button>

          <button
            onClick={handleLogout}
            className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-red-400/20 hover:bg-red-500/10 hover:text-red-300"
          >
            <LogOut size={14} />
            Logout
          </button>
        </div>
      </header>

      {/* Main IDE Layout — padded with rounded glass cards */}
      <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden p-3 gap-3">

        {/* Sidebar Panel */}
        <div
          style={{ width: `${sidebarWidth}px` }}
          className="flex-shrink-0 flex h-full rounded-[1.5rem] border border-white/[0.07] bg-[rgba(13,12,20,0.65)] shadow-[0_16px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl overflow-hidden"
        >
          <Sidebar
            files={files}
            activeFileId={activeFileId}
            readOnly={userRole === 'viewer'}
            onRefresh={() => { if (workspaceId) fetchFiles(workspaceId); }}
            onFileSelect={(file) => { navigate(`/ide/${urlWorkspaceId}/${file.id}`); }}
            onFileCreate={handleFileCreate}
            onFileDelete={handleFileDelete}
          />
        </div>

        {/* Editor + Terminal Row */}
        <main ref={mainSplitRef} className="flex min-h-0 flex-1 flex-row gap-3 overflow-hidden">

          {/* Editor Panel */}
          <section
            style={{ width: `${editorWidth}%` }}
            className="flex min-h-0 flex-col flex-shrink-0 rounded-[1.5rem] border border-white/[0.07] bg-[rgba(13,12,20,0.65)] shadow-[0_16px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl overflow-hidden"
          >
            {/* Breadcrumbs */}
            <div className="flex h-9 shrink-0 items-center border-b border-white/[0.05] bg-white/[0.02] px-4 select-none">
              {activeFile ? (
                <div className="flex items-center text-[13px] text-zinc-300 font-bold">
                  {getFileBreadcrumbs().map((crumb, index, arr) => {
                    const isLast = index === arr.length - 1;
                    return (
                      <div key={crumb.id} className="flex items-center gap-1">
                        <div
                          className={`flex items-center gap-1.5 px-2 py-0.5 rounded transition-colors ${
                            isLast ? 'text-white font-extrabold' : 'hover:bg-white/5 hover:text-white cursor-pointer'
                          }`}
                          onClick={() => {
                            if (!isLast && crumb.type === 'file') {
                              navigate(`/ide/${urlWorkspaceId}/${crumb.id}`);
                            }
                          }}
                        >
                          {crumb.type === 'directory' ? (
                            <Folder size={13} className="text-violet-400/80" />
                          ) : (
                            <FileText size={13} className={getFileColor(crumb.name)} />
                          )}
                          <span>{crumb.name}</span>
                        </div>
                        {!isLast && <ChevronRight size={12} className="text-zinc-650" />}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-[13px] italic font-semibold text-zinc-600">No file selected</div>
              )}
            </div>

            {/* Monaco Canvas */}
            <div className="min-h-0 flex-1">
              {activeFile ? (
                <CodeEditor
                  workspaceId={workspaceId}
                  fileId={activeFile.id}
                  language={activeFile.language || 'javascript'}
                  currentUser={user}
                  readOnly={userRole === 'viewer'}
                  onEditorReady={(editor) => { editorRef.current = editor; }}
                  onConnectionStatusChange={handleConnectionStatusChange}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-zinc-600">
                  <Code2 className="h-14 w-14 opacity-15" />
                  <p>Select a file to start coding.</p>
                </div>
              )}
            </div>
          </section>

          {/* Terminal Panel */}
          <section
            style={{ width: `calc(${100 - editorWidth}%)` }}
            className="flex min-h-0 flex-col flex-shrink-0 rounded-[1.5rem] border border-white/[0.07] bg-[rgba(13,12,20,0.65)] shadow-[0_16px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl overflow-hidden"
          >
            {/* Terminal Tab Bar */}
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-white/[0.06] bg-white/[0.025] px-3">
              <div className="flex items-center gap-2">
                <TerminalSquare size={13} className="text-violet-300/70" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-400">Terminal</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => window.open(`http://localhost:4000/api/workspace/${workspaceId}/preview/?token=${localStorage.getItem('token')}`, '_blank')}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 transition-colors hover:bg-emerald-500/20"
                  title="Open Live Web Preview"
                >
                  <Globe size={11} />
                  Preview
                </button>
                {userRole !== 'viewer' && (
                  <button
                    onClick={() => {
                      sessionStorage.setItem('resetTerminal', 'true');
                      setTerminalKey(prev => prev + 1);
                    }}
                    className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-200"
                    title="Reset Sandbox"
                  >
                    <RotateCcw size={11} />
                    Reset
                  </button>
                )}
              </div>
            </div>

            {/* Terminal Canvas */}
            <div className="min-h-0 flex-1">
              {workspaceId && (
                <TerminalPanel key={terminalKey} workspaceId={workspaceId} userRole={userRole} isVisible={true} />
              )}
            </div>
          </section>

        </main>
      </div>
      
      {isCollabModalOpen && workspaceId && userRole && (
        <CollaboratorsModal
          workspaceId={workspaceId}
          userRole={userRole}
          isOpen
          onClose={() => setIsCollabModalOpen(false)}
        />
      )}
    </div>
  );
}

export default IdePage;