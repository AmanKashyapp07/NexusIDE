import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import CodeEditor from '../components/Editor/CodeEditor';
import TerminalPanel from '../components/Terminal/TerminalPanel';
import Sidebar, { type AppFile } from '../components/Sidebar/Sidebar';
import { useToast } from '../components/Toast/Toast';
import VoiceChat from '../components/Voice/VoiceChat';
import CollaboratorsModal from '../components/Collaborators/CollaboratorsModal';
import { Users, LogOut, Loader2, TerminalSquare, RotateCcw, Download, ChevronRight, FileText, Code2, Globe, Zap, Folder, Activity, ChevronDown } from 'lucide-react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { io, type Socket } from 'socket.io-client';
import { apiUrl, wsUrl } from '../lib/backendUrls';

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
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'text-blue-400';
  if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'text-yellow-400';
  if (lower.endsWith('.py')) return 'text-sky-400';
  if (lower.endsWith('.html')) return 'text-orange-400';
  if (lower.endsWith('.css')) return 'text-indigo-400';
  if (lower.endsWith('.json')) return 'text-zinc-400';
  if (lower.endsWith('.md')) return 'text-emerald-400';
  return 'text-zinc-500';
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

  const sidebarWidth = 260;
  const editorWidth = 62;
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
      const filesRes = await fetch(apiUrl(`/workspace/${wsId}/files`), {
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
        const userRes = await fetch(apiUrl('/auth/me'), {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!userRes.ok) {
          localStorage.removeItem('token');
          navigate('/login');
          return;
        }

        const userData = await userRes.json();
        setUser(userData.user);

        const wsRes = await fetch(apiUrl(`/workspace/${urlWorkspaceId}`), {
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
      wsUrl(''),
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
    const socket = io(wsUrl('').replace(/^ws/, 'http'), {
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
      const res = await fetch(apiUrl(`/workspace/${workspaceId}/files`), {
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
      await fetch(apiUrl(`/workspace/${workspaceId}/files/${id}`), {
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
      const res = await fetch(apiUrl(`/workspace/${workspaceId}/export`), {
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
      <div className="relative flex h-screen w-full items-center justify-center bg-[#050505] text-zinc-300">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] bg-[size:24px_24px]"></div>
        <div className="absolute left-0 right-0 top-0 -z-10 m-auto h-[400px] w-[400px] rounded-full bg-indigo-500 opacity-20 blur-[120px]"></div>
        <div className="relative flex flex-col items-center gap-6 rounded-3xl border border-white/5 bg-white/5 p-12 backdrop-blur-2xl shadow-2xl">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-400" />
          <p className="text-sm font-medium tracking-wide text-zinc-400">Booting environment...</p>
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
    <div className="relative flex h-screen w-full flex-col overflow-hidden bg-[#030303] text-zinc-300 font-sans selection:bg-indigo-500/30">
      
      {/* Background Texture & Glows */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:32px_32px]" />
      <div className="pointer-events-none absolute -left-1/4 -top-1/4 h-[800px] w-[800px] rounded-full bg-indigo-500/10 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-1/4 -right-1/4 h-[600px] w-[600px] rounded-full bg-emerald-500/10 blur-[120px]" />

      {/* Header Area */}
      <header className="relative z-50 flex h-14 shrink-0 items-center justify-between border-b border-white/[0.04] bg-[#030303]/80 px-4 shadow-sm backdrop-blur-xl">
        
        {/* Left: Branding & Status */}
        <div className="flex items-center gap-4">
          <div className="group flex cursor-pointer items-center gap-3 transition-opacity hover:opacity-80" onClick={() => navigate('/dashboard')}>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-inner">
              <Zap className="text-white" size={16} strokeWidth={2.5} />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tracking-tight text-zinc-100">{workspaceTitle}</span>
                <div
                  className={`h-2 w-2 rounded-full ${
                    connectionStatus === 'connected' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' :
                    connectionStatus === 'disconnected' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]' :
                    'bg-amber-500 animate-pulse'
                  }`}
                  title={`Status: ${connectionStatus}`}
                />
              </div>
              <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">{userRole} workspace</span>
            </div>
          </div>
        </div>

        {/* Right: Actions & Collaborators */}
        <div className="flex items-center gap-3">
          <VoiceChat workspaceId={workspaceId} user={user} />
          
          {/* Divider */}
          <div className="h-6 w-[1px] bg-white/[0.08] mx-2" />

          {/* Active Collaborators Avatars */}
          {activeCollaborators.length > 0 && (
            <div className="relative flex items-center">
              <button 
                onClick={() => setIsActiveMembersOpen(!isActiveMembersOpen)}
                className="group flex items-center gap-1 rounded-full p-1 pr-2 transition-colors hover:bg-white/5"
              >
                <div className="flex items-center -space-x-2 mr-1">
                  {activeCollaborators.slice(0, 3).map((c, i) => (
                    <div
                      key={c.userId}
                      className="relative flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#030303] text-[10px] font-bold text-white shadow-sm transition-transform group-hover:-translate-y-0.5"
                      style={{ backgroundColor: c.color || '#6366f1', zIndex: 10 - i }}
                      title={c.username}
                    >
                      {c.username ? c.username.substring(0, 2).toUpperCase() : '??'}
                      <div className="absolute bottom-0 right-0 h-2 w-2 rounded-full border-2 border-[#030303] bg-emerald-500" />
                    </div>
                  ))}
                  {activeCollaborators.length > 3 && (
                    <div className="relative z-0 flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#030303] bg-zinc-800 text-[10px] font-bold text-white shadow-sm">
                      +{activeCollaborators.length - 3}
                    </div>
                  )}
                </div>
                <ChevronDown size={14} className="text-zinc-500 transition-transform group-hover:text-zinc-300" />
              </button>

              {isActiveMembersOpen && (
                <div className="absolute right-0 top-full mt-2 w-56 rounded-2xl border border-white/[0.08] bg-[#0A0A0A]/95 p-2 shadow-2xl backdrop-blur-xl z-50">
                  <div className="mb-2 flex items-center gap-2 px-2 pb-2 text-xs font-semibold text-zinc-400 border-b border-white/5">
                    <Activity size={12} className="text-emerald-500" />
                    Online Members
                  </div>
                  <div className="max-h-60 overflow-y-auto flex flex-col gap-1">
                    {activeCollaborators.map((c) => (
                      <button
                        key={c.userId}
                        onClick={() => {
                          if (c.activeFileId && c.activeFileId !== activeFileId) {
                            navigate(`/ide/${workspaceId}/${c.activeFileId}`);
                            setIsActiveMembersOpen(false);
                          }
                        }}
                        className={`w-full flex items-center gap-3 rounded-xl px-2 py-2 transition-all ${
                          c.activeFileId ? 'hover:bg-white/5 cursor-pointer' : 'opacity-60 cursor-default'
                        }`}
                      >
                        <div className="relative">
                          <div
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-sm"
                            style={{ backgroundColor: c.color || '#6366f1' }}
                          >
                            {c.username ? c.username.substring(0, 2).toUpperCase() : '??'}
                          </div>
                          <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0A0A0A] bg-emerald-500" />
                        </div>
                        <div className="flex flex-col items-start min-w-0">
                          <span className="text-sm font-medium text-zinc-200 truncate w-full text-left">{c.username || 'Unknown'}</span>
                          {c.activeFileId && (
                            <span className="text-[11px] text-zinc-500 truncate w-full text-left flex items-center gap-1">
                              <FileText size={10} />
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

          <div className="flex items-center gap-1.5 bg-[#121214] rounded-lg p-1 border border-white/[0.04] shadow-sm">
            <button
              onClick={() => setIsCollabModalOpen(true)}
              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Users size={14} />
              Share
            </button>
            <button
              onClick={handleExportWorkspace}
              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Download size={14} />
              Export
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center justify-center rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
              title="Logout"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace Layout */}
      <div className="relative z-10 flex min-h-0 flex-1 gap-4 p-4 pt-4 pb-4 overflow-hidden">
        
        {/* Sidebar Navigation */}
        <div
          style={{ width: `${sidebarWidth}px` }}
          className="flex flex-col overflow-hidden rounded-2xl border border-white/[0.05] bg-[#0A0A0A]/60 shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-2xl"
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

        {/* Editor & Terminal Area */}
        <main ref={mainSplitRef} className="flex min-h-0 flex-1 gap-4 overflow-hidden">
          
          {/* Code Editor Panel */}
          <section
            style={{ width: `${editorWidth}%` }}
            className="flex flex-col overflow-hidden rounded-2xl border border-white/[0.05] bg-[#0A0A0A]/60 shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-2xl"
          >
            {/* Context/Breadcrumbs Bar */}
            <div className="flex h-11 shrink-0 items-center border-b border-white/[0.04] bg-[#050505]/40 px-4 backdrop-blur-md">
              {activeFile ? (
                <div className="flex items-center text-xs font-medium text-zinc-400">
                  {getFileBreadcrumbs().map((crumb, index, arr) => {
                    const isLast = index === arr.length - 1;
                    return (
                      <div key={crumb.id} className="flex items-center">
                        <div
                          className={`flex items-center gap-1.5 rounded-md px-2 py-1 transition-all ${
                            isLast ? 'text-zinc-100 bg-white/5 shadow-sm' : 'hover:bg-white/5 hover:text-zinc-200 cursor-pointer'
                          }`}
                          onClick={() => {
                            if (!isLast && crumb.type === 'file') {
                              navigate(`/ide/${urlWorkspaceId}/${crumb.id}`);
                            }
                          }}
                        >
                          {crumb.type === 'directory' ? (
                            <Folder size={14} className="text-zinc-500" />
                          ) : (
                            <FileText size={14} className={getFileColor(crumb.name)} />
                          )}
                          <span>{crumb.name}</span>
                        </div>
                        {!isLast && <ChevronRight size={14} className="mx-0.5 text-zinc-700" />}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs font-medium text-zinc-600">
                  <Activity size={14} />
                  Ready to code
                </div>
              )}
            </div>

            {/* Monaco Container */}
            <div className="relative min-h-0 flex-1 bg-[#020202]/50">
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
                <div className="flex h-full flex-col items-center justify-center gap-4 text-zinc-500">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/5 bg-white/[0.02]">
                    <Code2 className="h-8 w-8 text-zinc-600" />
                  </div>
                  <p className="text-sm tracking-wide">Select a file from the explorer to begin.</p>
                </div>
              )}
            </div>
          </section>

          {/* Terminal Panel */}
          <section
            style={{ width: `calc(${100 - editorWidth}%)` }}
            className="flex flex-col overflow-hidden rounded-2xl border border-white/[0.05] bg-[#0A0A0A]/60 shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-2xl"
          >
            {/* Terminal Actions Bar */}
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-white/[0.04] bg-[#050505]/40 px-4 backdrop-blur-md">
              <div className="flex items-center gap-2.5">
                <TerminalSquare size={14} className="text-indigo-400" />
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300">Sandbox</span>
              </div>
              <div className="flex items-center gap-2 bg-[#121214] p-1 rounded-lg border border-white/[0.04]">
                <button
                  onClick={() => window.open(apiUrl(`/workspace/${workspaceId}/preview/?token=${localStorage.getItem('token')}`), '_blank')}
                  className="group flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 transition-all hover:bg-emerald-500/20"
                >
                  <Globe size={12} className="transition-transform group-hover:scale-110" />
                  Preview
                </button>
                {userRole !== 'viewer' && (
                  <button
                    onClick={() => {
                      sessionStorage.setItem('resetTerminal', 'true');
                      setTerminalKey(prev => prev + 1);
                    }}
                    className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <RotateCcw size={12} />
                    Restart
                  </button>
                )}
              </div>
            </div>

            {/* Terminal Instance */}
            <div className="min-h-0 flex-1 bg-[#020202]/80">
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