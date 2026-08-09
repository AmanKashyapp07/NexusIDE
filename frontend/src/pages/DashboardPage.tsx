import { useEffect } from 'react';
import { Zap, FolderCode, LogOut, Loader2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useWorkspaces } from '../hooks/useWorkspaces';
import WorkspaceGrid from '../components/Dashboard/WorkspaceGrid';
import CreateWorkspaceCard from '../components/Dashboard/CreateWorkspaceCard';
import JoinWorkspaceCard from '../components/Dashboard/JoinWorkspaceCard';
import Button from '../components/ui/Button';

export default function DashboardPage() {
  const { user, isLoading, logout } = useAuth();
  const ws = useWorkspaces();

  // Fetch workspaces once user is authenticated
  useEffect(() => {
    if (user) ws.fetchWorkspaces();
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ─── Loading ─────────────────────────────────────────────────────────── */
  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#09090b] text-zinc-300">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
          <p className="text-sm font-medium text-zinc-500 tracking-wide">Initializing workspace...</p>
        </div>
      </div>
    );
  }

  /* ─── Helpers passed down to WorkspaceGrid ─────────────────────────────── */
  const handleEditStart = (e: React.MouseEvent, workspace: Parameters<typeof ws.handleEditStart>[0]) => {
    e.stopPropagation();
    if (user) ws.handleEditStart(workspace, user.id);
  };

  const handleEditSave = async (e: React.MouseEvent | React.FormEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    await ws.handleEditSave(id);
  };

  const handleDelete = (e: React.MouseEvent, workspace: Parameters<typeof ws.handleDelete>[0]) => {
    e.stopPropagation();
    if (user) ws.handleDelete(workspace, user.id);
  };

  /* ─── Page ────────────────────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-200 font-sans selection:bg-violet-500/30">

      {/* Top Navigation Bar */}
      <nav className="sticky top-0 z-50 w-full border-b border-white/5 bg-[#09090b]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/10 border border-violet-500/20">
              <Zap className="text-violet-400" size={18} />
            </div>
            <span className="text-sm font-bold text-white tracking-wide">NexusIDE</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 pr-4 border-r border-white/10">
              {user?.avatar_url ? (
                <img src={user.avatar_url} alt={user.username} className="h-8 w-8 rounded-full object-cover border border-white/10" />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 border border-white/10">
                  <span className="text-xs font-medium text-zinc-400">{user?.username.charAt(0).toUpperCase()}</span>
                </div>
              )}
              <span className="text-sm font-medium text-zinc-300">{user?.username}</span>
            </div>
            <Button variant="ghost" onClick={logout} title="Log out">
              <LogOut size={18} />
            </Button>
          </div>
        </div>
      </nav>

      {/* Ambient Background Glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-violet-900/10 blur-[120px] rounded-full mix-blend-screen" />
      </div>

      {/* Main Content */}
      <main className="relative mx-auto max-w-7xl px-6 py-12">
        <header className="mb-12">
          <h1 className="text-3xl font-semibold text-white tracking-tight">Overview</h1>
          <p className="text-zinc-500 mt-1.5 text-sm">Manage your cloud environments and collaborate with your team.</p>
        </header>

        <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
          {/* Workspaces Grid */}
          <section>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                <FolderCode size={16} />
                Recent Workspaces
              </h2>
            </div>
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
          </section>

          {/* Action Sidebar */}
          <aside className="space-y-6">
            <CreateWorkspaceCard isCreating={ws.isCreating} onSubmit={ws.handleCreate} />
            <JoinWorkspaceCard onSubmit={ws.handleJoin} />
          </aside>
        </div>
      </main>

      {/* Delete Confirmation Modal */}
      {ws.deletingWorkspace && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0c0c10] p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-white">Delete Workspace</h3>
            <p className="text-sm text-zinc-400 mt-2">
              Are you sure you want to delete{' '}
              <span className="text-zinc-200 font-semibold">"{ws.deletingWorkspace.title}"</span>?
              This action is permanent and will physically erase the sandbox directories.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => ws.setDeletingWorkspace(null)}
                className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-zinc-300 transition hover:bg-white/10 cursor-pointer"
              >
                Cancel
              </button>
              <Button variant="danger" onClick={ws.confirmDelete}>Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}