import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../components/Toast/Toast';
import { Zap, Plus, ArrowRight, FolderCode, LogOut, Loader2, ArrowUpRight, Trash2, Edit2, Check, X, Users, Clock } from 'lucide-react';
import { apiUrl } from '../lib/backendUrls';

interface Workspace {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  owner_id: string;
  user_role?: string;
}

export default function DashboardPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [user, setUser] = useState<{ username: string, id: string, avatar_url?: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [joinId, setJoinId] = useState('');
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [deletingWorkspace, setDeletingWorkspace] = useState<Workspace | null>(null);

  useEffect(() => {
    const init = async () => {
      const token = localStorage.getItem('token');
      if (!token) {
        navigate('/login');
        return;
      }

      try {
        const userRes = await fetch(apiUrl('/auth/me'), {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (!userRes.ok) {
          localStorage.removeItem('token');
          navigate('/login');
          return;
        }

        const userData = await userRes.json();
        setUser(userData.user);

        const wsRes = await fetch(apiUrl('/workspace'), {
          headers: { Authorization: `Bearer ${token}` }
        });
        const wsData = await wsRes.json();
        setWorkspaces(wsData);
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };
    init();
  }, [navigate]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/login');
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    setIsCreating(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(apiUrl('/workspace'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ title: newTitle })
      });
      const data = await res.json();
      if (res.ok) {
        addToast('Workspace created successfully', 'success');
        navigate(`/ide/${data.id}`);
      } else {
        addToast(data.error || 'Failed to create workspace', 'error');
        setIsCreating(false);
      }
    } catch (err) {
      console.error(err);
      addToast('Failed to create workspace', 'error');
      setIsCreating(false);
    }
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinId.trim()) return;
    navigate(`/ide/${joinId.trim()}`);
  };

  const handleDelete = (e: React.MouseEvent, ws: Workspace) => {
    e.stopPropagation();
    const isOwner = user?.id === ws.owner_id;
    if (!isOwner) {
      addToast('You are not Admin of this workspace', 'error');
      return;
    }
    setDeletingWorkspace(ws);
  };

  const confirmDelete = async () => {
    if (!deletingWorkspace) return;
    const ws = deletingWorkspace;
    setDeletingWorkspace(null);

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(apiUrl(`/workspace/${ws.id}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setWorkspaces(prev => prev.filter(item => item.id !== ws.id));
        addToast('Workspace deleted successfully', 'success');
      } else {
        const data = await res.json();
        addToast(data.error || 'Failed to delete workspace', 'error');
      }
    } catch (err) {
      console.error(err);
      addToast('Failed to delete workspace', 'error');
    }
  };

  const handleEditStart = (e: React.MouseEvent, ws: Workspace) => {
    e.stopPropagation();
    const isOwner = user?.id === ws.owner_id;
    const isAdmin = isOwner || ws.user_role === 'admin';
    if (!isAdmin) {
      addToast('You are not Admin of this workspace', 'error');
      return;
    }
    setEditingWorkspaceId(ws.id);
    setEditingTitle(ws.title);
  };

  const handleEditSave = async (e: React.MouseEvent | React.FormEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    if (!editingTitle.trim()) {
      setEditingWorkspaceId(null);
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(apiUrl('/workspace'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ id, title: editingTitle })
      });
      if (res.ok) {
        setWorkspaces(prev => prev.map(ws => ws.id === id ? { ...ws, title: editingTitle } : ws));
        addToast('Workspace title updated', 'success');
      } else {
        const data = await res.json();
        addToast(data.error || 'Failed to update workspace title', 'error');
      }
    } catch (err) {
      console.error(err);
      addToast('Failed to update workspace title', 'error');
    } finally {
      setEditingWorkspaceId(null);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  };

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
            <button onClick={handleLogout} className="text-zinc-500 hover:text-red-400 transition-colors p-1" title="Log out">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </nav>

      {/* Ambient Background Glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-violet-900/10 blur-[120px] rounded-full mix-blend-screen" />
      </div>

      {/* Main Content Layout */}
      <main className="relative mx-auto max-w-7xl px-6 py-12">
        <header className="mb-12">
          <h1 className="text-3xl font-semibold text-white tracking-tight">Overview</h1>
          <p className="text-zinc-500 mt-1.5 text-sm">Manage your cloud environments and collaborate with your team.</p>
        </header>

        <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
          {/* Workspaces Section */}
          <section>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                <FolderCode size={16} />
                Recent Workspaces
              </h2>
            </div>

            {workspaces.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.01] py-16 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/5 mb-4">
                  <FolderCode size={28} className="text-zinc-500" />
                </div>
                <h3 className="text-lg font-medium text-zinc-200">No workspaces yet</h3>
                <p className="text-sm text-zinc-500 mt-1 max-w-xs">Create your first sandbox environment to start writing code.</p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {workspaces.map(ws => (
                  <div
                    key={ws.id}
                    onClick={() => {
                      if (editingWorkspaceId !== ws.id) navigate(`/ide/${ws.id}`);
                    }}
                    className={`group relative overflow-hidden rounded-xl border border-white/10 bg-[#121318] p-5 transition-all duration-200 hover:border-violet-500/30 hover:bg-[#16171d] hover:shadow-[0_0_20px_rgba(139,92,246,0.05)] ${editingWorkspaceId === ws.id ? 'cursor-default ring-1 ring-violet-500/50' : 'cursor-pointer hover:-translate-y-0.5'}`}
                  >
                    <div className="flex items-start justify-between min-h-[2.5rem]">
                      {editingWorkspaceId === ws.id ? (
                        <form className="flex w-full items-center gap-2" onSubmit={(e) => handleEditSave(e, ws.id)}>
                          <input
                            autoFocus
                            type="text"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            className="flex-1 rounded-md border border-violet-500/50 bg-[#09090b] px-3 py-1.5 text-sm text-white outline-none focus:ring-1 focus:ring-violet-500"
                          />
                          <button type="submit" className="rounded-md p-1.5 text-emerald-400 hover:bg-emerald-500/10">
                            <Check size={16} />
                          </button>
                          <button type="button" className="rounded-md p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white" onClick={(e) => { e.stopPropagation(); setEditingWorkspaceId(null); }}>
                            <X size={16} />
                          </button>
                        </form>
                      ) : (
                        <>
                          <h3 className="text-base font-medium text-zinc-200 group-hover:text-violet-200 transition-colors pr-16 truncate">
                            {ws.title}
                          </h3>

                          <div className="absolute right-4 top-4 z-10 flex opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                            <button
                              onClick={(e) => handleEditStart(e, ws)}
                              className="rounded-md p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white"
                              title="Edit Title"
                            >
                              <Edit2 size={15} />
                            </button>
                            <button
                              onClick={(e) => handleDelete(e, ws)}
                              className="rounded-md p-1.5 text-zinc-400 hover:bg-red-500/10 hover:text-red-400 ml-1"
                              title="Delete Workspace"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                          
                          {/* Hover Arrow Indicator */}
                          <div className="absolute right-5 top-5 text-zinc-600 opacity-0 transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-1 group-hover:-translate-y-1">
                             <ArrowUpRight size={18} />
                          </div>
                        </>
                      )}
                    </div>

                    {/* Metadata Footer */}
                    <div className="mt-5 flex items-center gap-4 text-xs font-medium text-zinc-500">
                      <div className="flex items-center gap-1.5">
                        <Users size={13} />
                        <span className="truncate max-w-[80px]">ID: {ws.id.split('-')[0]}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Clock size={13} />
                        <span>{formatDate(ws.updated_at)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Action Sidebar */}
          <aside className="space-y-6">
            {/* Create Card */}
            <div className="rounded-2xl border border-white/5 bg-gradient-to-b from-white/[0.03] to-transparent p-6 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-violet-500/20 to-transparent" />
              <h3 className="text-sm font-semibold text-white mb-1">Create Workspace</h3>
              <p className="text-xs text-zinc-500 mb-5">Spin up a new isolated environment.</p>
              
              <form onSubmit={handleCreate} className="space-y-3">
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. React-Sandbox"
                  className="block w-full rounded-lg border border-white/10 bg-[#09090b] px-4 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none transition-all focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50"
                />
                <button
                  type="submit"
                  disabled={isCreating}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-black transition-colors hover:bg-zinc-200 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isCreating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  Create Now
                </button>
              </form>
            </div>

            {/* Join Card */}
            <div className="rounded-2xl border border-white/5 bg-gradient-to-b from-white/[0.03] to-transparent p-6">
              <h3 className="text-sm font-semibold text-white mb-1">Join Workspace</h3>
              <p className="text-xs text-zinc-500 mb-5">Enter a UUID to collaborate with others.</p>
              
              <form onSubmit={handleJoin} className="space-y-3">
                <input
                  type="text"
                  required
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value)}
                  placeholder="Paste workspace ID..."
                  className="block w-full rounded-lg border border-white/10 bg-[#09090b] px-4 py-2.5 text-sm font-mono text-zinc-300 placeholder:text-zinc-600 placeholder:font-sans outline-none transition-all focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50"
                />
                <button
                  type="submit"
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                >
                  Join Environment
                  <ArrowRight size={16} className="opacity-70" />
                </button>
              </form>
            </div>
          </aside>
        </div>
      </main>

      {/* Custom Confirmation Modal */}
      {deletingWorkspace && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0c0c10] p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-white">Delete Workspace</h3>
            <p className="text-sm text-zinc-400 mt-2">
              Are you sure you want to delete <span className="text-zinc-200 font-semibold">"{deletingWorkspace.title}"</span>? This action is permanent and will physically erase the sandbox directories.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setDeletingWorkspace(null)}
                className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-zinc-300 transition hover:bg-white/10 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="rounded-lg bg-red-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-red-600 cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}