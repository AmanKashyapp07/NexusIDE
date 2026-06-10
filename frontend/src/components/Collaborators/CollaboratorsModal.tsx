import React, { useState, useEffect } from 'react';
import { X, Users, UserPlus, Loader2, Trash2 } from 'lucide-react';

interface Collaborator {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'editor' | 'viewer';
  joined_at: string;
}

interface CollaboratorsModalProps {
  workspaceId: string;
  userRole: string; // current user's role
  isOpen: boolean;
  onClose: () => void;
}

export default function CollaboratorsModal({ workspaceId, userRole, isOpen, onClose }: CollaboratorsModalProps) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [newCollabInput, setNewCollabInput] = useState('');
  const [newCollabRole, setNewCollabRole] = useState<'editor' | 'viewer'>('viewer');
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchCollaborators();
    }
  }, [isOpen, workspaceId]);

  const fetchCollaborators = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`http://localhost:4000/api/workspace/${workspaceId}/collaborators`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch collaborators');
      const data = await res.json();
      setCollaborators(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddCollaborator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCollabInput.trim()) return;

    setIsAdding(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`http://localhost:4000/api/workspace/${workspaceId}/collaborators`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ usernameOrEmail: newCollabInput.trim(), role: newCollabRole })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add collaborator');
      
      setNewCollabInput('');
      fetchCollaborators();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveCollaborator = async (userId: string) => {
    if (!confirm('Are you sure you want to remove this collaborator?')) return;
    
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`http://localhost:4000/api/workspace/${workspaceId}/collaborators/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to remove collaborator');
      }
      
      setCollaborators(prev => prev.filter(c => c.id !== userId));
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`http://localhost:4000/api/workspace/${workspaceId}/collaborators/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ role: newRole })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update role');
      }
      
      setCollaborators(prev => prev.map(c => c.id === userId ? { ...c, role: newRole as any } : c));
    } catch (err: any) {
      alert(err.message);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-[rgba(13,12,20,0.95)] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between p-4 border-b border-white/5 bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-violet-400" />
            <h2 className="text-sm font-bold text-white tracking-wide">Workspace Collaborators</h2>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 flex-1 overflow-y-auto">
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs font-medium">
              {error}
            </div>
          )}

          {userRole === 'admin' && (
            <form onSubmit={handleAddCollaborator} className="mb-6 flex flex-col gap-3">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Add Collaborator</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Username or Email"
                  value={newCollabInput}
                  onChange={e => setNewCollabInput(e.target.value)}
                  className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500 focus:bg-black/60 transition-colors"
                />
                <select
                  value={newCollabRole}
                  onChange={e => setNewCollabRole(e.target.value as any)}
                  className="bg-black/40 border border-white/10 rounded-lg px-2 py-2 text-sm text-zinc-300 focus:outline-none focus:border-violet-500"
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  type="submit"
                  disabled={isAdding || !newCollabInput.trim()}
                  className="flex items-center justify-center bg-violet-600 hover:bg-violet-500 text-white rounded-lg px-4 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isAdding ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
                </button>
              </div>
            </form>
          )}

          <div className="flex flex-col gap-2">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-1">Current Members</label>
            
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 size={24} className="animate-spin text-violet-500/50" />
              </div>
            ) : collaborators.length === 0 ? (
              <div className="text-center py-6 text-sm text-zinc-500">
                No collaborators yet.
              </div>
            ) : (
              collaborators.map(c => (
                <div key={c.id} className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-violet-500/20 text-violet-300 flex items-center justify-center font-bold text-xs">
                      {c.username.substring(0, 2).toUpperCase()}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-zinc-200">{c.username}</span>
                      <span className="text-xs text-zinc-500">{c.email}</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    {userRole === 'admin' ? (
                      <select
                        value={c.role}
                        onChange={e => handleRoleChange(c.id, e.target.value)}
                        className="bg-transparent text-xs text-zinc-400 font-medium cursor-pointer hover:text-zinc-200 focus:outline-none"
                      >
                        <option value="viewer">Viewer</option>
                        <option value="editor">Editor</option>
                        <option value="admin">Admin</option>
                      </select>
                    ) : (
                      <span className="text-xs text-zinc-500 capitalize">{c.role}</span>
                    )}

                    {userRole === 'admin' && (
                      <button 
                        onClick={() => handleRemoveCollaborator(c.id)}
                        className="text-zinc-500 hover:text-red-400 transition-colors p-1"
                        title="Remove"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
