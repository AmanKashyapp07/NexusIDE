import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import CodeEditor from '../components/Editor/CodeEditor';
import TerminalPanel from '../components/Terminal/TerminalPanel';
import Sidebar, { type AppFile } from '../components/Sidebar/Sidebar';
import { useToast } from '../components/Toast/Toast';
import VoiceChat from '../components/Voice/VoiceChat';
import CollaboratorsModal from '../components/Collaborators/CollaboratorsModal';
import { Users, LogOut, Loader2, TerminalSquare, RotateCcw, Download, ChevronRight, FileText, Code2, Globe, Zap, Folder, Activity, ChevronDown, GitBranch, History } from 'lucide-react';
import { io, type Socket } from 'socket.io-client';
import { apiUrl, wsUrl } from '../lib/backendUrls';
import SnapshotPanel from '../components/Snapshots/SnapshotPanel';
import ConflictResolver from '../components/Conflict/ConflictResolver';
import TimelapseReplayer from '../components/Editor/TimelapseReplayer';

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

interface EditorHandle {
  setValue(value: string): void;
}

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
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const typingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Jump-to-member: userId of the collaborator whose cursor we want to jump to.
  // Set when the user clicks an avatar; cleared by CodeEditor via onJumpComplete.
  const [jumpToUserId, setJumpToUserId] = useState<string | null>(null);
  const [hasConflicts, setHasConflicts] = useState(false);
  const [showConflictResolver, setShowConflictResolver] = useState(false);
  const [isViewingTimelapse, setIsViewingTimelapse] = useState(false);
  const [authorMap, setAuthorMap] = useState<Record<string, { username: string; color: string }>>({});
  const [isBlameOpen, setIsBlameOpen] = useState(false);
  const { addToast } = useToast();

  const handleConnectionStatusChange = useCallback((status: ConnectionStatus) => {
    setConnectionStatus((prevStatus) => {
      if (prevStatus !== status) {
        if (status === 'connected') addToast('Editor synchronized with workspace.', 'success');
        else if (status === 'disconnected') addToast('Connection lost. Retrying...', 'error');
      }
      return status;
    });
  }, [addToast]);

  const handleAwarenessChange = useCallback((users: Array<{ name: string; color: string; id?: string }>) => {
    // Build authorMap from awareness users: map their id to username and color
    // Merge with existing authorMap to preserve historical data
    setAuthorMap(prev => {
      const newAuthorMap = { ...prev };
      users.forEach(user => {
        if (user.id) {
          newAuthorMap[user.id] = { username: user.name, color: user.color };
        }
      });
      return newAuthorMap;
    });
  }, []);

  const sidebarWidth = 260;
  const editorWidth = 62;
  const mainSplitRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorHandle | null>(null);
  const presenceSocketRef = useRef<Socket | null>(null);
  const navigate = useNavigate();
  const { workspaceId: urlWorkspaceId, fileId: urlFileId } = useParams<{ workspaceId: string, fileId: string }>();

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const activeFile = useMemo(() => {
    if (!urlFileId) return files.find((file) => file.type === 'file') || null;
    return files.find((file) => file.id === urlFileId && file.type === 'file') || null;
  }, [files, urlFileId]);
  
  const activeFileId = activeFile?.id ?? null;
  
  // Load author map from history when file changes
  useEffect(() => {
    if (!workspaceId || !activeFileId) return;
    
    const loadAuthorMap = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(apiUrl(`/workspace/${workspaceId}/files/${activeFileId}/history`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.authorMap) {
            // Convert backend format to frontend format (remove userId field)
            const frontendAuthorMap: Record<string, { username: string; color: string }> = {};
            for (const [clientId, info] of Object.entries(data.authorMap as Record<string, any>)) {
              frontendAuthorMap[clientId] = {
                username: info.username,
                color: info.color
              };
            }
            setAuthorMap(frontendAuthorMap);
          }
        }
      } catch (err) {
        console.error('Failed to load author map:', err);
      }
    };
    
    loadAuthorMap();
  }, [workspaceId, activeFileId]);
  
  const fetchFiles = useCallback(async (wsId: string) => {
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
  }, []);

  useEffect(() => {
    const initWorkspace = async () => {
      const token = localStorage.getItem('token');
      if (!token) return navigateRef.current('/login');

      try {
        const userRes = await fetch(apiUrl('/auth/me'), { headers: { Authorization: `Bearer ${token}` } });
        if (!userRes.ok) {
          localStorage.removeItem('token');
          return navigateRef.current('/login');
        }

        const userData = await userRes.json();
        setUser(userData.user);

        const wsRes = await fetch(apiUrl(`/workspace/${urlWorkspaceId}`), { headers: { Authorization: `Bearer ${token}` } });
        if (!wsRes.ok) return navigateRef.current('/dashboard');

        const wsData = await wsRes.json();
        setWorkspaceId(wsData.id);
        setWorkspaceTitle(wsData.title);
        setUserRole(wsData.userRole || 'viewer');

        await fetchFiles(wsData.id);
      } catch (err) {
        navigateRef.current('/login');
      }
    };

    if (urlWorkspaceId) initWorkspace();
    else navigateRef.current('/dashboard');
  }, [urlWorkspaceId, fetchFiles]);

  useEffect(() => {
    if (!urlWorkspaceId || !user?.id) return;

    const token = localStorage.getItem('token') || '';
    const socket = io(apiUrl('').replace(/\/api\/?$/, ''), { 
      auth: { token },
      transports: ['websocket']
    });
    presenceSocketRef.current = socket;

    socket.on('connect', () => {
      setConnectionStatus('connected');
      socket.emit('join-workspace', { workspaceId: urlWorkspaceId });
      fetchFiles(urlWorkspaceId); 
    });

    socket.on('disconnect', () => setConnectionStatus('disconnected'));
    socket.on('workspace-presence-update', (users: CollaboratorPresence[]) => setActiveCollaborators(users));
    socket.on('file-tree-update', () => fetchFiles(urlWorkspaceId));

    socket.on('snapshot-restored', ({ label }: { label: string }) => {
      addToast(`Workspace restored to snapshot: "${label}"`, 'success');
      setTimeout(() => window.location.reload(), 1000);
    });

    socket.on('conflict-resolved', ({ fileId }: { fileId: string }) => {
      if (activeFileId === fileId) {
        setHasConflicts(false);
        addToast('Merge conflict resolved.', 'success');
      }
    });

    socket.on('user-typing', ({ userId }: { userId: string }) => {
      setTypingUsers(prev => new Set(prev).add(userId));
      const existing = typingTimersRef.current.get(userId);
      if (existing) clearTimeout(existing);
      
      typingTimersRef.current.set(userId, setTimeout(() => {
        setTypingUsers(prev => {
          const next = new Set(prev);
          next.delete(userId);
          return next;
        });
        typingTimersRef.current.delete(userId);
      }, 2000));
    });

    return () => {
      socket.off();
      socket.disconnect();
      presenceSocketRef.current = null;
    };
  }, [urlWorkspaceId, user?.id, fetchFiles]);

  useEffect(() => {
    if (presenceSocketRef.current && activeFileId) {
      presenceSocketRef.current.emit('active-file-change', { activeFileId });
      
      const checkConflicts = async () => {
        if (!urlWorkspaceId) return;
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(apiUrl(`/workspace/${urlWorkspaceId}/files/${activeFileId}/conflicts`), {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (res.ok) {
            const data = await res.json();
            setHasConflicts(data.hasConflicts);
          }
        } catch (e) {
           console.error('Failed to check conflicts', e);
        }
      };
      checkConflicts();
    }
  }, [activeFileId, urlWorkspaceId]);

  // 1. Handle auto-navigating to the first file if none is selected
  useEffect(() => {
    if (files.length === 0) return;
    if (!urlFileId) {
      const firstFile = files.find(f => f.type === 'file');
      if (firstFile) {
        navigateRef.current(`/ide/${urlWorkspaceId}/${firstFile.id}`, { replace: true });
      }
    }
  }, [urlFileId, files, urlWorkspaceId]);

  // 2. ONLY close the timelapse when the user switches to a different file
  useEffect(() => {
    console.log('[TimelapseDebug] urlFileId changed. closing timelapse. urlFileId:', urlFileId);
    setIsViewingTimelapse(false);
  }, [urlFileId]);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('token');
    navigateRef.current('/login');
  }, []);

  const broadcastFileTreeUpdate = useCallback(() => {
    presenceSocketRef.current?.emit('broadcast-file-tree', { workspaceId: urlWorkspaceId });
  }, [urlWorkspaceId]);

  const lastTypingEmit = useRef(0);
  const handleTypingActivity = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingEmit.current > 500) {
      lastTypingEmit.current = now;
      presenceSocketRef.current?.emit('user-typing', { workspaceId: urlWorkspaceId });
    }
  }, [urlWorkspaceId]);

  const handleFileCreate = useCallback(async (name: string, type: 'file' | 'directory', language: string | null, parentId: string | null) => {
    if (!workspaceId) return;

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(apiUrl(`/workspace/${workspaceId}/files`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, type, parent_id: parentId, language }),
      });

      const newFile = await res.json();
      if (!res.ok) throw new Error(newFile.error);

      setFiles((prev) => [...prev, newFile].sort((a, b) => a.name.localeCompare(b.name)));
      broadcastFileTreeUpdate();

      if (type === 'file') navigateRef.current(`/ide/${urlWorkspaceId}/${newFile.id}`);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to create file', 'error');
    }
  }, [workspaceId, urlWorkspaceId, broadcastFileTreeUpdate, addToast]);

  const handleFileDelete = useCallback(async (id: string) => {
    if (!workspaceId) return;

    try {
      const token = localStorage.getItem('token');
      await fetch(apiUrl(`/workspace/${workspaceId}/files/${id}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      setFiles((prev) => prev.filter((f) => f.id !== id));
      if (activeFile?.id === id) editorRef.current?.setValue('');
      broadcastFileTreeUpdate();
    } catch (err) {
      console.error(err);
    }
  }, [workspaceId, activeFile?.id, broadcastFileTreeUpdate]);

  const handleExportWorkspace = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(apiUrl(`/workspace/${workspaceId}/export`), {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (!res.ok) throw new Error(await res.text() || 'Failed to export workspace');
      
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
      addToast(`Failed to export: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    }
  }, [workspaceId, workspaceTitle, addToast]);

  const [isSnapshotting, setIsSnapshotting] = useState(false);
  const [isSnapshotPanelOpen, setIsSnapshotPanelOpen] = useState(false);

  const handleCreateSnapshot = useCallback(async (label: string) => {
    if (!workspaceId || isSnapshotting) return;
    setIsSnapshotting(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(apiUrl(`/workspace/${workspaceId}/snapshot`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Snapshot failed' }));
        throw new Error(data.error || 'Snapshot failed');
      }
      const data = await res.json();
      addToast(`Snapshot saved: "${data.label}"`, 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to create snapshot', 'error');
    } finally {
      setIsSnapshotting(false);
    }
  }, [workspaceId, isSnapshotting, addToast]);

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
      } else break;
    }
    return path;
  };

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden bg-[#030303] text-zinc-300 font-sans selection:bg-indigo-500/30">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:32px_32px]" />
      <div className="pointer-events-none absolute -left-1/4 -top-1/4 h-[800px] w-[800px] rounded-full bg-indigo-500/10 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-1/4 -right-1/4 h-[600px] w-[600px] rounded-full bg-emerald-500/10 blur-[120px]" />

      <header className="relative z-50 flex h-14 shrink-0 items-center justify-between border-b border-white/[0.04] bg-[#030303]/80 px-4 shadow-sm backdrop-blur-xl">
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

        <div className="flex items-center gap-3">
          <VoiceChat workspaceId={workspaceId} user={user} />
          
          {/* Hide Blame Button - shows when blame is open */}
          {isBlameOpen && (
            <button
              onClick={() => setIsBlameOpen(false)}
              className="flex items-center gap-1.5 rounded-md bg-indigo-500/10 hover:bg-indigo-500/20 px-3 py-1.5 text-xs font-medium text-indigo-400 border border-indigo-500/20 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
              Hide Blame
            </button>
          )}
          
          <div className="h-6 w-[1px] bg-white/[0.08] mx-2" />

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
                      className="relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-2 border-[#030303] text-[10px] font-bold text-white shadow-sm transition-transform group-hover:-translate-y-0.5 hover:scale-110 hover:z-20"
                      style={{ backgroundColor: c.color || '#6366f1', zIndex: 10 - i }}
                      title={`Jump to ${c.username}'s cursor`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (c.activeFileId) {
                          if (c.activeFileId !== activeFileId) {
                            navigate(`/ide/${urlWorkspaceId}/${c.activeFileId}`);
                          }
                          setJumpToUserId(c.userId);
                          setIsActiveMembersOpen(false);
                        }
                      }}
                    >
                      {c.username ? c.username.substring(0, 2).toUpperCase() : '??'}
                      <div className="absolute bottom-0 right-0 h-2 w-2 rounded-full border-2 border-[#030303] bg-emerald-500" />
                      {typingUsers.has(c.userId) && <div className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-blue-400 animate-ping" />}
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
                          if (c.activeFileId) {
                            if (c.activeFileId !== activeFileId) {
                              navigate(`/ide/${workspaceId}/${c.activeFileId}`);
                            }
                            setJumpToUserId(c.userId);
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
                          <span className="text-sm font-medium text-zinc-200 truncate w-full text-left flex items-center gap-1.5">
                            {c.username || 'Unknown'}
                            {typingUsers.has(c.userId) && (
                              <span className="inline-flex gap-0.5 items-center">
                                <span className="h-1 w-1 rounded-full bg-blue-400 animate-bounce [animation-delay:0ms]" />
                                <span className="h-1 w-1 rounded-full bg-blue-400 animate-bounce [animation-delay:150ms]" />
                                <span className="h-1 w-1 rounded-full bg-blue-400 animate-bounce [animation-delay:300ms]" />
                              </span>
                            )}
                          </span>
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
              onClick={() => setIsSnapshotPanelOpen(true)}
              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
              title={userRole === 'admin' ? 'Create snapshot / view history' : 'View snapshot history'}
            >
              <History size={14} />
              History
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

      {connectionStatus !== 'connected' && (
        <div className="absolute inset-x-0 top-14 z-40 flex justify-center pointer-events-none">
          <div className="mt-2 flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-4 py-1.5 backdrop-blur-md shadow-lg pointer-events-auto">
            <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
            <span className="text-xs font-medium text-amber-500 tracking-wide">
              {connectionStatus === 'disconnected' ? 'Connection lost. Reconnecting...' : 'Connecting to workspace...'}
            </span>
          </div>
        </div>
      )}

      <div className="relative z-10 flex min-h-0 flex-1 gap-4 p-4 pt-4 pb-4 overflow-hidden">
        
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

        <main ref={mainSplitRef} className="flex min-h-0 flex-1 gap-4 overflow-hidden">
          
          <section
            style={{ width: `${editorWidth}%` }}
            className="flex flex-col overflow-hidden rounded-2xl border border-white/[0.05] bg-[#0A0A0A]/60 shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-2xl"
          >
            <div className="flex h-11 shrink-0 items-center border-b border-white/[0.04] bg-[#050505]/40 px-4 backdrop-blur-md">
              {activeFile ? (
                <div className="flex flex-1 items-center justify-between">
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
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      console.log('[TimelapseDebug] Timelapse button clicked. Current state:', isViewingTimelapse, 'activeFile:', activeFile?.id);
                      setIsViewingTimelapse(prev => !prev);
                    }}
                    className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                      isViewingTimelapse ? 'bg-indigo-500/20 text-indigo-400' : 'text-zinc-400 hover:bg-white/10 hover:text-zinc-200'
                    }`}
                  >
                    <History size={14} />
                    Timelapse
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs font-medium text-zinc-600">
                  <Activity size={14} />
                  Ready to code
                </div>
              )}
            </div>

            {hasConflicts && (
              <div className="flex shrink-0 items-center justify-between bg-amber-500/10 px-4 py-2 border-b border-amber-500/20">
                <div className="flex items-center gap-2 text-xs text-amber-500">
                  <GitBranch size={14} />
                  <span>This file has unmerged conflicts.</span>
                </div>
                <button 
                  onClick={() => setShowConflictResolver(true)}
                  className="rounded bg-amber-500 px-3 py-1 text-[10px] font-bold text-amber-950 hover:bg-amber-400 transition-colors"
                >
                  Resolve Conflicts
                </button>
              </div>
            )}

            <div className="relative min-h-0 flex-1 bg-[#020202]/50 flex">
              {activeFile ? (
                <>
                  <div className={`relative min-h-0 ${isViewingTimelapse ? 'hidden' : 'flex-1'}`}>
                    <CodeEditor
                      // [ARCHITECTURE] SEAMLESS IN-PLACE FILE SWITCHING
                      workspaceId={workspaceId}
                      fileId={activeFile.id}
                      filename={activeFile.name}
                      language={activeFile.language || 'javascript'}
                      currentUser={user}
                      authorMap={authorMap}
                      isBlameOpen={isBlameOpen}
                      onBlameToggle={setIsBlameOpen}
                      readOnly={userRole === 'viewer'}
                      onEditorReady={(editor) => { editorRef.current = editor; }}
                      onConnectionStatusChange={handleConnectionStatusChange}
                      onAwarenessChange={handleAwarenessChange}
                      onCodeChange={handleTypingActivity}
                      jumpToUserId={jumpToUserId}
                      onJumpComplete={() => setJumpToUserId(null)}
                    />
                  </div>
                  {isViewingTimelapse && (
                    <div className="relative flex flex-col flex-1 min-h-0 min-w-0">
                      <TimelapseReplayer
                        workspaceId={workspaceId}
                        fileId={activeFile.id}
                        filename={activeFile.name}
                        language={activeFile.language || 'javascript'}
                        onClose={() => setIsViewingTimelapse(false)}
                      />
                    </div>
                  )}
                </>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-4 text-zinc-500 w-full">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/5 bg-white/[0.02]">
                    <Code2 className="h-8 w-8 text-zinc-600" />
                  </div>
                  <p className="text-sm tracking-wide">Select a file from the explorer to begin.</p>
                </div>
              )}
            </div>
          </section>

          <section
            style={{ width: `calc(${100 - editorWidth}%)` }}
            className="flex flex-col overflow-hidden rounded-2xl border border-white/[0.05] bg-[#0A0A0A]/60 shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-2xl"
          >
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

      {isSnapshotPanelOpen && workspaceId && userRole && (
        <SnapshotPanel
          workspaceId={workspaceId}
          userRole={userRole}
          onClose={() => setIsSnapshotPanelOpen(false)}
          onCreateSnapshot={handleCreateSnapshot}
          isCreating={isSnapshotting}
        />
      )}

      {showConflictResolver && workspaceId && activeFileId && activeFile && (
        <ConflictResolver
          workspaceId={workspaceId}
          fileId={activeFileId}
          filename={activeFile.name}
          onClose={() => setShowConflictResolver(false)}
          onResolved={() => {
            setShowConflictResolver(false);
            setHasConflicts(false);
          }}
        />
      )}
    </div>
  );
}

export default IdePage;