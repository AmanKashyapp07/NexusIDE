import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import CodeEditor from '../components/Editor/CodeEditor';
import TerminalPanel from '../components/Terminal/TerminalPanel';
import Sidebar, { type AppFile } from '../components/Sidebar/Sidebar';
import { useToast } from '../components/Toast/Toast';
import CollaboratorsModal from '../components/Collaborators/CollaboratorsModal';
import { Loader2, TerminalSquare, RotateCcw, Globe, Code2, FileText, Folder, ChevronRight, Activity, GitBranch, History } from 'lucide-react';
import { io, type Socket } from 'socket.io-client';
import { apiUrl, getSocketIoOptions } from '../lib/backendUrls';
import { getNexusToken, removeNexusToken } from '../lib/tokenStorage';
import SnapshotPanel from '../components/Snapshots/SnapshotPanel';
import ConflictResolver from '../components/Conflict/ConflictResolver';
import TimelapseReplayer from '../components/Editor/TimelapseReplayer';
import IdeHeader from '../components/Ide/IdeHeader';
import { SIDEBAR_WIDTH, EDITOR_WIDTH_PERCENT } from '../constants/layout';
import { fetchCurrentUser } from '../api/auth';
import {
  fetchWorkspace,
  fetchWorkspaceFiles,
  createFile as apiCreateFile,
  deleteFile as apiDeleteFile,
  exportWorkspace as apiExportWorkspace,
} from '../api/workspace';
import { createSnapshot as apiCreateSnapshot } from '../api/snapshots';
import { fetchFileHistory, fetchFileConflicts } from '../api/history';
import { WorkspaceProvider } from '../context/WorkspaceContext';
import { ConnectionProvider } from '../context/ConnectionContext';


type UserRole = 'admin' | 'editor' | 'viewer';
type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';

interface User { username: string; id: string; }

interface CollaboratorPresence {
  userId: string;
  username: string;
  color: string;
  activeFileId: string | null;
}

interface EditorHandle { setValue(value: string): void; }

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
  const [jumpToUserId, setJumpToUserId] = useState<string | null>(null);
  const [hasConflicts, setHasConflicts] = useState(false);
  const [showConflictResolver, setShowConflictResolver] = useState(false);
  const [isViewingTimelapse, setIsViewingTimelapse] = useState(false);
  const [authorMap, setAuthorMap] = useState<Record<string, { username: string; color: string }>>({});
  const [isBlameOpen, setIsBlameOpen] = useState(false);
  const [isSnapshotting, setIsSnapshotting] = useState(false);
  const [isSnapshotPanelOpen, setIsSnapshotPanelOpen] = useState(false);

  const { addToast } = useToast();
  const sidebarWidth = SIDEBAR_WIDTH;
  const editorWidth = EDITOR_WIDTH_PERCENT;
  const mainSplitRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorHandle | null>(null);
  const presenceSocketRef = useRef<Socket | null>(null);
  const navigate = useNavigate();
  const { workspaceId: urlWorkspaceId, fileId: urlFileId } = useParams<{ workspaceId: string, fileId: string }>();

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  /* ─── Derived state ──────────────────────────────────────────────────── */
  const activeFile = useMemo(() => {
    if (!urlFileId) return files.find((file) => file.type === 'file') || null;
    return files.find((file) => file.id === urlFileId && file.type === 'file') || null;
  }, [files, urlFileId]);

  const activeFileId = activeFile?.id ?? null;

  /* ─── Callbacks ──────────────────────────────────────────────────────── */
  const handleConnectionStatusChange = useCallback((status: ConnectionStatus) => {
    setConnectionStatus((prev) => {
      if (prev !== status) {
        if (status === 'connected') addToast('Editor synchronized with workspace.', 'success');
        else if (status === 'disconnected') addToast('Connection lost. Retrying...', 'error');
      }
      return status;
    });
  }, [addToast]);

  const handleAwarenessChange = useCallback((users: Array<{ name: string; color: string; id?: string }>) => {
    setAuthorMap(prev => {
      const next = { ...prev };
      users.forEach(u => { if (u.id) next[u.id] = { username: u.name, color: u.color }; });
      return next;
    });
  }, []);

  const fetchFiles = useCallback(async (wsId: string) => {
    try {
      const token = getNexusToken();
      const data = await fetchWorkspaceFiles(token, wsId);
      setFiles(data);
    } catch (err) { console.error('Failed to fetch files', err); }
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

  const handleLogout = useCallback(() => {
    removeNexusToken();
    navigateRef.current('/login');
  }, []);

  const handleJumpToUser = useCallback((userId: string, fileId: string | null) => {
    if (fileId) {
      if (fileId !== activeFileId) navigate(`/${urlWorkspaceId}/${fileId}`);
      setJumpToUserId(userId);
      setIsActiveMembersOpen(false);
    }
  }, [activeFileId, navigate, urlWorkspaceId]);

  /* ─── File operations with Optimistic UI updates ────────────────────── */
  const handleFileCreate = useCallback(async (name: string, type: 'file' | 'directory', language: string | null, parentId: string | null) => {
    if (!workspaceId) return;
    const tempId = `temp_${Date.now()}`;
    const optimisticFile: AppFile = {
      id: tempId,
      name,
      type,
      parent_id: parentId,
      language: language || (type === 'file' ? 'plaintext' : null),
    };

    // 1. Optimistically apply to local tree state immediately (0ms UI latency)
    setFiles(prev => [...prev, optimisticFile].sort((a, b) => a.name.localeCompare(b.name)));

    try {
      const token = getNexusToken();
      const newFile = await apiCreateFile(token, workspaceId, { name, type, parent_id: parentId, language });
      // 2. Reconcile temporary ID with permanent database ID
      setFiles(prev => prev.map(f => f.id === tempId ? newFile : f));
      broadcastFileTreeUpdate();
      if (type === 'file') navigateRef.current(`/${urlWorkspaceId}/${newFile.id}`);
    } catch (err) {
      // 3. Roll back on network or validation error
      setFiles(prev => prev.filter(f => f.id !== tempId));
      addToast(err instanceof Error ? err.message : 'Failed to create file', 'error');
    }
  }, [workspaceId, urlWorkspaceId, broadcastFileTreeUpdate, addToast]);

  const handleFileDelete = useCallback(async (id: string) => {
    if (!workspaceId) return;
    const targetFile = files.find(f => f.id === id);
    // 1. Optimistically remove from tree
    setFiles(prev => prev.filter(f => f.id !== id));
    if (activeFile?.id === id) editorRef.current?.setValue('');

    try {
      const token = getNexusToken();
      await apiDeleteFile(token, workspaceId, id);
      broadcastFileTreeUpdate();
    } catch (err) {
      // 2. Roll back deletion on error
      if (targetFile) {
        setFiles(prev => [...prev, targetFile].sort((a, b) => a.name.localeCompare(b.name)));
      }
      addToast('Failed to delete file', 'error');
    }
  }, [workspaceId, activeFile?.id, files, broadcastFileTreeUpdate, addToast]);

  const handleExportWorkspace = useCallback(async () => {
    try {
      const token = getNexusToken();
      const blob = await apiExportWorkspace(token, workspaceId!);
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

  const handleCreateSnapshot = useCallback(async (label: string) => {
    if (!workspaceId || isSnapshotting) return;
    setIsSnapshotting(true);
    try {
      const token = getNexusToken();
      const data = await apiCreateSnapshot(token, workspaceId, label);
      addToast(`Snapshot saved: "${data.label}"`, 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to create snapshot', 'error');
    } finally {
      setIsSnapshotting(false);
    }
  }, [workspaceId, isSnapshotting, addToast]);

  /* ─── Effects ────────────────────────────────────────────────────────── */
  // Initialize workspace from URL param using parallelized Promise.all batching
  useEffect(() => {
    const initWorkspace = async () => {
      const token = getNexusToken();
      if (!token) return navigateRef.current('/login');
      try {
        const [userData, wsData, filesData] = await Promise.all([
          fetchCurrentUser(token),
          fetchWorkspace(token, urlWorkspaceId!),
          fetchWorkspaceFiles(token, urlWorkspaceId!),
        ]);

        setUser(userData);
        setWorkspaceId(wsData.id);
        setWorkspaceTitle(wsData.title);
        setUserRole((wsData.userRole || wsData.user_role || 'viewer') as UserRole);
        setFiles(filesData);
      } catch { navigateRef.current('/login'); }
    };
    if (urlWorkspaceId) initWorkspace(); else navigateRef.current('/dashboard');
  }, [urlWorkspaceId]);

  // Presence socket
  useEffect(() => {
    if (!urlWorkspaceId || !user?.id) return;
    const token = getNexusToken();
    const { url: socketServerUrl, path: socketIoPath } = getSocketIoOptions();
    const socket = io(socketServerUrl, { path: socketIoPath, auth: { token }, transports: ['websocket'] });
    presenceSocketRef.current = socket;

    socket.on('connect', () => {
      setConnectionStatus('connected');
      socket.emit('join-workspace', { workspaceId: urlWorkspaceId });
      fetchFiles(urlWorkspaceId);
    });
    socket.on('disconnect', () => setConnectionStatus('disconnected'));
    socket.on('workspace-presence-update', (users: CollaboratorPresence[]) => setActiveCollaborators(users));
    socket.on('file-created', ({ file }: { file: AppFile }) => {
      if (file) {
        setFiles(prev => prev.some(f => f.id === file.id) ? prev : [...prev, file]);
      }
    });
    socket.on('file-deleted', ({ fileId }: { fileId: string }) => {
      if (fileId) {
        setFiles(prev => prev.filter(f => f.id !== fileId));
      }
    });
    socket.on('file-tree-update', () => fetchFiles(urlWorkspaceId));
    socket.on('snapshot-restored', ({ label }: { label: string }) => {
      addToast(`Workspace restored to snapshot: "${label}"`, 'success');
      // Phase 3: Soft state resync — refreshes file tree without destroying WebSockets or terminal PTY sessions
      fetchFiles(urlWorkspaceId!);
    });
    socket.on('conflict-resolved', ({ fileId }: { fileId: string }) => {
      if (activeFileId === fileId) { setHasConflicts(false); addToast('Merge conflict resolved.', 'success'); }
    });
    socket.on('user-typing', ({ userId }: { userId: string }) => {
      setTypingUsers(prev => new Set(prev).add(userId));
      const existing = typingTimersRef.current.get(userId);
      if (existing) clearTimeout(existing);
      typingTimersRef.current.set(userId, setTimeout(() => {
        setTypingUsers(prev => { const next = new Set(prev); next.delete(userId); return next; });
        typingTimersRef.current.delete(userId);
      }, 2000));
    });

    return () => { socket.off(); socket.disconnect(); presenceSocketRef.current = null; };
  }, [urlWorkspaceId, user?.id, fetchFiles]);

  // Conflict check when active file changes
  useEffect(() => {
    if (presenceSocketRef.current && activeFileId) {
      presenceSocketRef.current.emit('active-file-change', { activeFileId });
      const checkConflicts = async () => {
        if (!urlWorkspaceId) return;
        try {
          const token = getNexusToken();
          const data = await fetchFileConflicts(token, urlWorkspaceId, activeFileId);
          setHasConflicts(data.hasConflicts);
        } catch (e) { console.error('Failed to check conflicts', e); }
      };
      checkConflicts();
    }
  }, [activeFileId, urlWorkspaceId]);

  // Load author map from history when file changes
  useEffect(() => {
    if (!workspaceId || !activeFileId) return;
    const loadAuthorMap = async () => {
      try {
        const token = getNexusToken();
        const data = await fetchFileHistory(token, workspaceId, activeFileId);
        if (data.authorMap) {
          const frontendMap: Record<string, { username: string; color: string }> = {};
          for (const [clientId, info] of Object.entries(data.authorMap)) {
            frontendMap[clientId] = { username: info.username, color: info.color };
          }
          setAuthorMap(frontendMap);
        }
      } catch (err) { console.error('Failed to load author map:', err); }
    };
    loadAuthorMap();
  }, [workspaceId, activeFileId]);

  // Auto-navigate to first file if none selected
  useEffect(() => {
    if (files.length === 0) return;
    if (!urlFileId) {
      const firstFile = files.find(f => f.type === 'file');
      if (firstFile) navigateRef.current(`/${urlWorkspaceId}/${firstFile.id}`, { replace: true });
    }
  }, [urlFileId, files, urlWorkspaceId]);

  // Close timelapse on file switch
  const prevUrlFileIdRef = useRef(urlFileId);
  useEffect(() => {
    if (prevUrlFileIdRef.current && prevUrlFileIdRef.current !== urlFileId) {
      setIsViewingTimelapse(false);
    }
    prevUrlFileIdRef.current = urlFileId;
  }, [urlFileId]);

  /* ─── Loading screen ─────────────────────────────────────────────────── */
  if (!user || !workspaceId) {
    return (
      <div className="relative flex h-screen w-full items-center justify-center bg-[#050505] text-zinc-300">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] bg-[size:24px_24px]" />
        <div className="absolute left-0 right-0 top-0 -z-10 m-auto h-[400px] w-[400px] rounded-full bg-indigo-500 opacity-20 blur-[120px]" />
        <div className="relative flex flex-col items-center gap-6 rounded-3xl border border-white/5 bg-white/5 p-12 backdrop-blur-2xl shadow-2xl">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-400" />
          <p className="text-sm font-medium tracking-wide text-zinc-400">Booting environment...</p>
        </div>
      </div>
    );
  }

  /* ─── Breadcrumbs helper ─────────────────────────────────────────────── */
  const getFileBreadcrumbs = () => {
    if (!activeFile) return [];
    const path = [activeFile];
    let currentParentId = activeFile.parent_id;
    let depth = 0;
    while (currentParentId && depth < 20) {
      const parent = files.find(f => f.id === currentParentId);
      if (parent) { path.unshift(parent); currentParentId = parent.parent_id; depth++; }
      else break;
    }
    return path;
  };

  /* ─── Page ────────────────────────────────────────────────────────────── */
  return (
    <WorkspaceProvider value={{ workspaceId, workspaceTitle, userRole, user }}>
      <ConnectionProvider value={{ connectionStatus, presenceSocket: presenceSocketRef.current }}>
        <div className="relative flex h-screen w-full flex-col overflow-hidden bg-[#030303] text-zinc-300 font-sans selection:bg-indigo-500/30">
          {/* Background decorations */}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:32px_32px]" />
          <div className="pointer-events-none absolute -left-1/4 -top-1/4 h-[800px] w-[800px] rounded-full bg-indigo-500/10 blur-[120px]" />
          <div className="pointer-events-none absolute -bottom-1/4 -right-1/4 h-[600px] w-[600px] rounded-full bg-emerald-500/10 blur-[120px]" />

          {/* Header */}
          <IdeHeader
            activeCollaborators={activeCollaborators}
            typingUsers={typingUsers}
            files={files}
            activeFileId={activeFileId}
            urlWorkspaceId={urlWorkspaceId ?? ''}
            isActiveMembersOpen={isActiveMembersOpen}
            isBlameOpen={isBlameOpen}
            onToggleActiveMembers={() => setIsActiveMembersOpen(prev => !prev)}
            onJumpToUser={handleJumpToUser}
            onShare={() => setIsCollabModalOpen(true)}
            onExport={handleExportWorkspace}
            onSnapshot={() => setIsSnapshotPanelOpen(true)}
            onHideBlame={() => setIsBlameOpen(false)}
            onLogout={handleLogout}
          />

      {/* Connection status banner */}
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

      {/* Main layout */}
      <div className="relative z-10 flex min-h-0 flex-1 gap-4 p-4 overflow-hidden">

        {/* File Explorer Sidebar */}
        <div
          style={{ width: `${sidebarWidth}px` }}
          className="flex flex-col overflow-hidden rounded-2xl border border-white/[0.05] bg-[#0A0A0A]/60 shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-2xl"
        >
          <Sidebar
            files={files}
            activeFileId={activeFileId}
            readOnly={userRole === 'viewer'}
            onRefresh={() => { if (workspaceId) fetchFiles(workspaceId); }}
            onFileSelect={(file) => { navigate(`/${urlWorkspaceId}/${file.id}`); }}
            onFileCreate={handleFileCreate}
            onFileDelete={handleFileDelete}
          />
        </div>

        <main ref={mainSplitRef} className="flex min-h-0 flex-1 gap-4 overflow-hidden">

          {/* Code Editor Panel */}
          <section
            style={{ width: `${editorWidth}%` }}
            className="flex flex-col overflow-hidden rounded-2xl border border-white/[0.05] bg-[#0A0A0A]/60 shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-2xl"
          >
            {/* Editor tab bar */}
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
                            onClick={() => { if (!isLast && crumb.type === 'file') navigate(`/${urlWorkspaceId}/${crumb.id}`); }}
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

            {/* Conflict banner */}
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

            {/* Code Editor / Timelapse */}
            <div className="relative min-h-0 flex-1 bg-[#020202]/50 flex">
              {activeFile ? (
                <>
                  <div className={`relative min-h-0 ${isViewingTimelapse ? 'hidden' : 'flex-1'}`}>
                    <CodeEditor
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

          {/* Terminal Panel */}
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
                  onClick={() => window.open(apiUrl(`/workspace/${workspaceId}/preview/?token=${getNexusToken()}`), '_blank')}
                  className="group flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 transition-all hover:bg-emerald-500/20"
                >
                  <Globe size={12} className="transition-transform group-hover:scale-110" />
                  Preview
                </button>
                {userRole !== 'viewer' && (
                  <button
                    onClick={() => { sessionStorage.setItem('resetTerminal', 'true'); setTerminalKey(prev => prev + 1); }}
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

      {/* Modals */}
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
          onResolved={() => { setShowConflictResolver(false); setHasConflicts(false); }}
        />
      )}
        </div>
      </ConnectionProvider>
    </WorkspaceProvider>
  );
}

export default IdePage;