import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import CodeEditor from '../components/Editor/CodeEditor';
import TerminalPanel from '../components/Terminal/TerminalPanel';
import Sidebar, { type AppFile } from '../components/Sidebar/Sidebar';
import VoiceChat from '../components/Voice/VoiceChat';
import CollaboratorsModal from '../components/Collaborators/CollaboratorsModal';
import { Users, LogOut, Loader2, TerminalSquare, RotateCcw, Download, ChevronRight, FileText, Code2, Play, Globe } from 'lucide-react';
import * as Y from 'yjs';
// @ts-expect-error y-websocket does not ship complete TypeScript declarations.
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
      socket.emit('join-workspace', { workspaceId: urlWorkspaceId });
    });

    socket.on('workspace-presence-update', (users: CollaboratorPresence[]) => {
      setActiveCollaborators(users);
    });

    socket.on('file-tree-update', () => {
      fetchFiles(urlWorkspaceId);
    });

    return () => {
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
      alert(err instanceof Error ? err.message : 'Failed to create file');
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
      alert(`Failed to export: ${message}`);
    }
  };

  if (!user || !workspaceId) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#1e1e1e] text-[#cccccc]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-[#007fd4]" />
          <p className="text-[13px] font-medium tracking-wide">Initializing Workspace...</p>
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
    <div className="flex h-screen w-full flex-col bg-[#1e1e1e] text-[#cccccc] overflow-hidden selection:bg-[#264f78]">
      
      {/* Title Bar */}
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-[#2b2b2b] bg-[#181818] px-4 shadow-sm z-50">
        
        {/* Left: Project Info */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-[13px]">
            <Code2 size={15} className="text-[#007fd4]" />
            <span className="font-medium text-[#cccccc] cursor-pointer hover:text-white transition-colors">{workspaceTitle}</span>
            {userRole && (
              <span className="ml-1 rounded-[3px] bg-[#2a2d2e] px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                {userRole}
              </span>
            )}
          </div>
        </div>

        {/* Center: Top Breadcrumbs (Optional, usually clear enough in tabs) */}
        
        {/* Right: Actions */}
        <div className="flex items-center gap-1.5">
          <VoiceChat workspaceId={workspaceId} user={user} />

          {/* Connection Status */}
          <div className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium cursor-default transition-colors mr-1">
            <span className="relative flex h-2 w-2">
              {connectionStatus === 'connected' && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              )}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${
                connectionStatus === 'connected' ? 'bg-emerald-500' : 
                connectionStatus === 'disconnected' ? 'bg-red-500' : 'bg-amber-500'
              }`} />
            </span>
            <span className={
                connectionStatus === 'connected' ? 'text-emerald-500' : 
                connectionStatus === 'disconnected' ? 'text-red-500' : 'text-amber-500'
            }>
              {connectionStatus === 'connected' ? 'Connected' : 
               connectionStatus === 'disconnected' ? 'Offline' : 'Connecting...'}
            </span>
          </div>

          {/* Active Members Dropdown */}
          {activeCollaborators.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setIsActiveMembersOpen((isOpen) => !isOpen)}
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                  isActiveMembersOpen 
                    ? 'bg-[#2a2d2e] border-[#404040] text-white' 
                    : 'bg-transparent border-transparent text-zinc-300 hover:bg-[#2a2d2e]'
                }`}
              >
                <Users size={14} />
                <span>{activeCollaborators.length} Online</span>
              </button>
              
              {isActiveMembersOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-56 rounded-md border border-[#333333] bg-[#1e1e1e] p-1 shadow-xl z-50">
                  <div className="mb-1 px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 border-b border-[#2b2b2b]">
                    Active Members
                  </div>
                  <div className="max-h-48 overflow-y-auto flex flex-col gap-0.5 ide-scrollbar">
                    {activeCollaborators.map((c) => (
                      <button 
                        key={c.userId} 
                        onClick={() => {
                          if (c.activeFileId && c.activeFileId !== activeFileId) {
                            navigate(`/ide/${workspaceId}/${c.activeFileId}`);
                            setIsActiveMembersOpen(false);
                          }
                        }}
                        className={`w-full flex items-center gap-2 rounded px-2 py-1.5 transition-colors ${
                          c.activeFileId ? 'hover:bg-[#2a2d2e] cursor-pointer' : 'opacity-70 cursor-default'
                        }`}
                        title={c.activeFileId ? 'Click to jump to their file' : 'Idle'}
                      >
                        <div 
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium text-white"
                          style={{ backgroundColor: c.color || '#8b5cf6' }}
                        >
                          {c.username ? c.username.substring(0, 2).toUpperCase() : '??'}
                        </div>
                        <div className="flex flex-col items-start min-w-0">
                          <span className="text-[12px] text-zinc-200 truncate w-full text-left leading-tight">{c.username || 'Unknown'}</span>
                          {c.activeFileId && (
                            <span className="text-[10px] text-zinc-400 truncate w-full text-left mt-0.5">
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

          <div className="h-4 w-px bg-[#333333] mx-1" />

          <button
            onClick={() => setIsCollabModalOpen(true)}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-zinc-300 transition-colors hover:bg-[#2a2d2e] hover:text-white"
          >
            <Users size={14} />
            Share
          </button>

          <button
            onClick={handleExportWorkspace}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-zinc-300 transition-colors hover:bg-[#2a2d2e] hover:text-white"
            title="Export Workspace as ZIP"
          >
            <Download size={14} />
            Export
          </button>

          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-400 ml-1"
            title="Logout"
          >
            <LogOut size={14} />
          </button>

        </div>
      </header>

      {/* Main IDE Layout */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        
        {/* Sidebar */}
        <div style={{ width: `${sidebarWidth}px` }} className="flex-shrink-0 flex h-full">
          <Sidebar
            files={files}
            activeFileId={activeFileId}
            readOnly={userRole === 'viewer'}
            onRefresh={() => {
              if (workspaceId) fetchFiles(workspaceId);
            }}
            onFileSelect={(file) => {
              navigate(`/ide/${urlWorkspaceId}/${file.id}`);
            }}
            onFileCreate={handleFileCreate}
            onFileDelete={handleFileDelete}
          />
        </div>

        {/* Editor & Terminal Area */}
        <main ref={mainSplitRef} className="flex min-h-0 flex-1 flex-col lg:flex-row overflow-hidden bg-[#1e1e1e]">
          
          {/* Editor Container */}
          <section 
            style={{ width: `${editorWidth}%` }}
            className="flex min-h-0 flex-col flex-shrink-0 border-r border-[#2b2b2b]"
          >
            {/* Editor Tab Bar */}
            <div className="flex h-9 items-center bg-[#181818] overflow-x-auto ide-scrollbar select-none">
              {activeFile ? (
                <div className="flex h-full items-center gap-2 border-t border-[#007fd4] bg-[#1e1e1e] px-4 pr-6">
                  <FileText size={14} className={getFileColor(activeFile.name)} />
                  <span className="text-[13px] text-white">{activeFile.name}</span>
                </div>
              ) : (
                <div className="flex h-full items-center px-4">
                  <span className="text-[12px] italic text-zinc-500">No file selected</span>
                </div>
              )}
            </div>

            {/* Breadcrumbs Ribbon (below tabs) */}
            <div className="flex h-6 items-center border-b border-[#2b2b2b] bg-[#1e1e1e] px-4 shadow-sm z-10">
              {activeFile && (
                <div className="flex items-center text-[11px] text-zinc-400">
                  {getFileBreadcrumbs().map((crumb, index, arr) => {
                    const isLast = index === arr.length - 1;
                    return (
                      <div key={crumb.id} className="flex items-center">
                        <span className={`transition-colors ${isLast ? 'text-[#cccccc]' : 'hover:text-[#cccccc] cursor-pointer'}`}>
                          {crumb.name}
                        </span>
                        {!isLast && <ChevronRight size={12} className="mx-0.5 text-zinc-600" />}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Monaco Canvas */}
            <div className="min-h-0 flex-1 relative bg-[#1e1e1e]">
              {activeFile ? (
                <CodeEditor
                  workspaceId={workspaceId}
                  fileId={activeFile.id}
                  language={activeFile.language || 'javascript'}
                  currentUser={user}
                  readOnly={userRole === 'viewer'}
                  onEditorReady={(editor) => {
                    editorRef.current = editor;
                  }}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-zinc-600">
                  <Code2 className="h-16 w-16 opacity-20" />
                  <p>Select a file from the explorer to start coding.</p>
                </div>
              )}
            </div>
          </section>

          {/* Terminal Container */}
          <section 
            style={{ width: `calc(${100 - editorWidth}%)` }}
            className="flex min-h-0 flex-col flex-shrink-0 bg-[#1e1e1e]"
          >
            {/* Terminal Tab Bar */}
            <div className="flex h-9 items-center justify-between border-b border-[#2b2b2b] bg-[#181818] pr-2">
              <div className="flex h-full items-center gap-2 border-t border-transparent bg-[#1e1e1e] px-4 pr-6">
                <TerminalSquare size={14} className="text-zinc-400" />
                <span className="text-[12px] uppercase tracking-wider text-zinc-300">Terminal</span>
              </div>
              
              <div className="flex items-center gap-1">
                <button
                  onClick={() => window.open(`http://localhost:4000/api/workspace/${workspaceId}/preview/?token=${localStorage.getItem('token')}`, '_blank')}
                  className="flex items-center gap-1.5 rounded-[3px] px-2 py-1 text-[11px] text-emerald-400 transition-colors hover:bg-[#2a2d2e]"
                  title="Open Live Web Preview"
                >
                  <Globe size={12} />
                  <span>Preview</span>
                </button>
                {userRole !== 'viewer' && (
                  <button
                    onClick={() => {
                      sessionStorage.setItem('resetTerminal', 'true');
                      setTerminalKey(prev => prev + 1);
                    }}
                    className="flex items-center gap-1.5 rounded-[3px] px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:bg-[#2a2d2e] hover:text-white"
                    title="Restart Container"
                  >
                    <RotateCcw size={12} />
                    <span>Restart</span>
                  </button>
                )}
              </div>
            </div>

            {/* Terminal Canvas */}
            <div className="min-h-0 flex-1 relative">
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