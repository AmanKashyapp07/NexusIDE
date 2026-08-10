import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Code2,
  FolderCode,
  LogOut,
  Loader2,
  Plus,
  ArrowRight,
  Terminal,
  ExternalLink,
  ShieldAlert
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useWorkspaces } from '../hooks/useWorkspaces';
import WorkspaceGrid from '../components/Dashboard/WorkspaceGrid';
import CreateWorkspaceCard from '../components/Dashboard/CreateWorkspaceCard';
import JoinWorkspaceCard from '../components/Dashboard/JoinWorkspaceCard';

const GithubIcon: React.FC<{ className?: string }> = ({ className = "h-4 w-4" }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fillRule="evenodd"
      d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.008.069-.008 1.008.07 1.54 1.036 1.54 1.036.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      clipRule="evenodd"
    />
  </svg>
);

export default function DashboardPage() {
  const { user, isLoading, logout } = useAuth();
  const ws = useWorkspaces();
  const navigate = useNavigate();

  // Fetch workspaces once user is authenticated
  useEffect(() => {
    if (user) ws.fetchWorkspaces();
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ─── Loading State ─────────────────────────────────────────────────── */
  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#09090b] text-white">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
          <p className="text-sm font-semibold text-zinc-300 tracking-wide">
            Initializing NexusIDE Workspace...
          </p>
        </div>
      </div>
    );
  }

  /* ─── Event Handlers ────────────────────────────────────────────────── */
  const handleEditStart = (
    e: React.MouseEvent,
    workspace: Parameters<typeof ws.handleEditStart>[0]
  ) => {
    e.stopPropagation();
    if (user) ws.handleEditStart(workspace, user.id);
  };

  const handleEditSave = async (
    e: React.MouseEvent | React.FormEvent,
    id: string
  ) => {
    e.stopPropagation();
    e.preventDefault();
    await ws.handleEditSave(id);
  };

  const handleDelete = (
    e: React.MouseEvent,
    workspace: Parameters<typeof ws.handleDelete>[0]
  ) => {
    e.stopPropagation();
    if (user) ws.handleDelete(workspace, user.id);
  };

  return (
    <div className="relative min-h-screen bg-[#09090b] text-zinc-100 font-sans antialiased selection:bg-zinc-800 selection:text-white flex flex-col">
      {/* Background Subtle Grid */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.035] [background-image:linear-gradient(to_right,#808080_1px,transparent_1px),linear-gradient(to_bottom,#808080_1px,transparent_1px)] [background-size:36px_36px]" />

      {/* =========================================================
          TOP NAVIGATION BAR
      ========================================================== */}
      <header className="relative z-30 border-b border-zinc-800/80 bg-[#09090b]/90 backdrop-blur-md shrink-0">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-6 sm:px-10 lg:px-12">
          {/* Brand */}
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate('/')}>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 text-zinc-950 font-bold shadow-sm">
              <Code2 className="h-4.5 w-4.5" />
            </div>
            <span className="font-mono text-base font-bold tracking-tight text-white">
              Nexus<span className="text-zinc-400">IDE</span>
            </span>
            <span className="rounded bg-zinc-800/80 px-2 py-0.5 font-mono text-xs text-zinc-300 border border-zinc-700/50 font-bold">
              v1.2.0
            </span>
          </div>

          {/* User Profile & Actions */}
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/70 px-3.5 py-1 text-xs">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-mono text-xs text-zinc-300 font-semibold">Systems Operational</span>
            </div>

            <div className="flex items-center gap-3 pl-2 border-l border-zinc-800">
              {user?.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={user.username}
                  className="h-8 w-8 rounded-full object-cover border border-zinc-700"
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-500/20 border border-purple-500/40 text-purple-300 font-bold text-xs">
                  {user?.username.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="text-sm font-bold text-white hidden sm:inline">
                {user?.username}
              </span>
            </div>

            <button
              onClick={logout}
              title="Log out"
              className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-1.5 text-xs font-bold text-zinc-300 transition hover:bg-zinc-800 hover:text-white cursor-pointer"
            >
              <LogOut className="h-4 w-4 text-zinc-400" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>

      {/* =========================================================
          MAIN DASHBOARD CONTENT
      ========================================================== */}
      <main className="mx-auto max-w-[1440px] w-full px-6 sm:px-10 lg:px-12 py-8 lg:py-10 space-y-8 pb-40 lg:pb-52">
        
        {/* Header Title Section */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-zinc-800/80 pb-6">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1 font-mono text-xs text-zinc-300 font-semibold mb-2">
              <Terminal className="h-3.5 w-3.5 text-zinc-300" />
              <span>COLLABORATIVE CLOUD WORKSPACES</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
              Dashboard 
            </h1>
            <p className="mt-1.5 text-sm sm:text-base text-zinc-300 font-semibold leading-relaxed">
              Launch isolated Docker sandboxes, join real-time CRDT sessions, and manage your team environments.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-3.5 py-2 font-mono text-xs text-zinc-300 font-bold">
              Total Workspaces: <span className="text-white">{ws.workspaces.length}</span>
            </span>
          </div>
        </div>

        {/* 2-Column Grid: Workspaces List (Left) & Create/Join Sidebar (Right) */}
        <div className="grid gap-8 lg:grid-cols-12 items-stretch w-full">
          
          {/* LEFT COLUMN: Recent Workspaces Grid */}
          <section className="lg:col-span-8 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2 font-mono">
                <FolderCode className="h-4 w-4 text-purple-400" />
                Active Sandboxes
              </h2>
            </div>

            <div className="flex-1 flex flex-col">
              <WorkspaceGrid
                workspaces={ws.workspaces}
                userId={user?.id ?? ''}
                editingWorkspaceId={ws.editingWorkspaceId}
                editingTitle={ws.editingTitle}
                onEditStart={handleEditStart}
                onEditSave={handleEditSave}
                onEditCancel={() => ws.setEditingWorkspaceId(null)}
                onEditTitleChange={ws.setEditingTitle}
                onDelete={handleDelete}
              />
            </div>
          </section>

          {/* RIGHT COLUMN: Action Sidebar */}
          <aside className="lg:col-span-4 flex flex-col justify-between space-y-6">
            <CreateWorkspaceCard isCreating={ws.isCreating} onSubmit={ws.handleCreate} />
            <JoinWorkspaceCard onSubmit={ws.handleJoin} />
          </aside>
        </div>

      </main>

      {/* =========================================================
          DELETE CONFIRMATION MODAL
      ========================================================== */}
      {ws.deletingWorkspace && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-rose-500/30 bg-[#0d0d11] p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Delete Workspace</h3>
                <p className="text-xs text-zinc-400 font-mono">Irreversible Action</p>
              </div>
            </div>

            <p className="text-sm text-zinc-300 font-semibold leading-relaxed">
              Are you sure you want to delete{' '}
              <span className="text-white font-bold underline">"{ws.deletingWorkspace.title}"</span>?
              This action is permanent and will physically erase the sandbox container and workspace file system.
            </p>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => ws.setDeletingWorkspace(null)}
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2 text-xs font-bold text-zinc-300 hover:bg-zinc-800 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={ws.confirmDelete}
                className="rounded-lg border border-rose-500/50 bg-rose-600 hover:bg-rose-500 px-4 py-2 text-xs font-bold text-white shadow-lg transition cursor-pointer"
              >
                Delete Workspace
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================
          LONG DEMO FOOTER (Multi-Column IDE / Cloud Platform Footer)
      ========================================================== */}
      <footer className="border-t border-zinc-800/80 bg-zinc-950/95 pt-10 pb-8 px-6 sm:px-10 lg:px-12 shrink-0 mt-12">
        <div className="mx-auto max-w-[1440px] space-y-8">
          
          {/* Main Footer Grid */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 text-xs">
            
            {/* Column 1: Brand & Overview */}
            <div className="col-span-2 space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-100 text-zinc-950 font-bold">
                  <Code2 className="h-4 w-4" />
                </div>
                <span className="font-mono text-base font-bold text-white tracking-tight">
                  Nexus<span className="text-zinc-400">IDE</span>
                </span>
                <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-300 border border-zinc-700 font-bold">
                  v1.2.0
                </span>
              </div>
              <p className="text-zinc-300 leading-relaxed max-w-sm text-xs font-semibold">
                A high-performance, real-time collaborative cloud IDE architecture powered by Yjs CRDTs, isolated Docker sandboxes, Linux PTY terminals, and streaming LSP intelligence.
              </p>
              <div className="flex items-center gap-3 pt-1">
                <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-mono text-emerald-400 font-bold">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Systems Operational
                </span>
              </div>
            </div>

            {/* Column 2: Core Architecture */}
            <div className="space-y-3">
              <h4 className="font-mono text-xs font-bold text-white uppercase tracking-wider">Architecture</h4>
              <ul className="space-y-2 text-zinc-300 font-semibold">
                <li><span className="hover:text-white transition-colors cursor-pointer">Yjs Binary CRDT Sync</span></li>
                <li><span className="hover:text-white transition-colors cursor-pointer">Docker Container PTY</span></li>
                <li><span className="hover:text-white transition-colors cursor-pointer">Streaming LSP Protocol</span></li>
                <li><span className="hover:text-white transition-colors cursor-pointer">Merkle DAG CAS Engine</span></li>
                <li><span className="hover:text-white transition-colors cursor-pointer">Redis 7 Pub/Sub Mesh</span></li>
                <li><span className="hover:text-white transition-colors cursor-pointer">PostgreSQL 16 DB</span></li>
              </ul>
            </div>

            {/* Column 3: Platform Features */}
            <div className="space-y-3">
              <h4 className="font-mono text-xs font-bold text-white uppercase tracking-wider">Capabilities</h4>
              <ul className="space-y-2 text-zinc-300 font-semibold">
                <li><span className="hover:text-white transition-colors cursor-pointer">Multi-User Cursors</span></li>
                <li><span className="hover:text-white transition-colors cursor-pointer">Interactive Bash Shell</span></li>
                <li><span className="hover:text-white transition-colors cursor-pointer">Monaco Editor Core</span></li>
                <li><span className="hover:text-white transition-colors cursor-pointer">Snapshot Delta History</span></li>
                <li><span className="hover:text-white transition-colors cursor-pointer">Resource-Capped Limits</span></li>
                <li><span className="hover:text-white transition-colors cursor-pointer">WebSockets Connection</span></li>
              </ul>
            </div>

            {/* Column 4: Links & Credits */}
            <div className="space-y-3">
              <h4 className="font-mono text-xs font-bold text-white uppercase tracking-wider">Project Links</h4>
              <ul className="space-y-2 text-zinc-300 font-semibold">
                <li>
                  <a href="https://github.com/AmanKashyapp07/NexusIDE" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-white transition-colors">
                    <GithubIcon className="h-3.5 w-3.5" />
                    <span>GitHub Repository</span>
                  </a>
                </li>
                <li>
                  <a href="http://129.154.39.198/ide/login" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-white transition-colors">
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Live Oracle Cloud Node</span>
                  </a>
                </li>
                <li>
                  <a href="https://github.com/AmanKashyapp07" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-white transition-colors">
                    <span>Creator: Aman Kashyap</span>
                  </a>
                </li>
                <li className="pt-1 text-[11px] text-zinc-400 font-mono font-normal">
                  MIT License • Open Source
                </li>
              </ul>
            </div>

          </div>

          {/* Bottom Copyright & Credit Strip */}
          <div className="border-t border-zinc-800/80 pt-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-400 font-mono">
            <div>
              © 2026 NexusIDE Cloud Platform. Open-source real-time IDE sandbox environment.
            </div>
            <div className="flex items-center gap-4">
              <span>Built by <a href="https://github.com/AmanKashyapp07" target="_blank" rel="noreferrer" className="text-white underline hover:text-purple-300 font-bold">Aman Kashyap</a></span>
            </div>
          </div>

        </div>
      </footer>
    </div>
  );
}