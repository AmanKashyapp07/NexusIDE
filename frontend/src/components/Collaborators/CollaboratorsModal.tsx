import React, { useState, useEffect } from 'react';
import { X, Users, UserPlus, Loader2, Trash2, Shield } from 'lucide-react';

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
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchCollaborators();
      setNewCollabInput('');
      setError(null);
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
      await fetchCollaborators();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveCollaborator = async (userId: string) => {
    if (!confirm('Are you sure you want to remove this collaborator?')) return;
    
    setProcessingId(userId);
    setError(null);
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
      setError(err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    setProcessingId(userId);
    setError(null);
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
      setError(err.message);
    } finally {
      setProcessingId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 transition-opacity duration-300"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-md bg-gradient-to-b from-[#13121a] to-[#0a0a0f] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] transform transition-all duration-300 scale-100"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-white/5 bg-white/[0.02]">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-violet-500/10 rounded-lg">
              <Users size={18} className="text-violet-400" />
            </div>
            <h2 className="text-sm font-semibold text-white tracking-wide">Workspace Collaborators</h2>
          </div>
          <button 
            onClick={onClose} 
            className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 flex-1 overflow-y-auto">
          {error && (
            <div className="mb-5 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-2 text-red-400 text-xs font-medium animate-in fade-in slide-in-from-top-2">
              <span className="mt-0.5">⚠️</span>
              <p>{error}</p>
            </div>
          )}

          {userRole === 'admin' && (
            <form onSubmit={handleAddCollaborator} className="mb-8 flex flex-col gap-3">
              <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Invite Member</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Username or Email"
                  value={newCollabInput}
                  onChange={e => { setNewCollabInput(e.target.value); setError(null); }}
                  className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/50 transition-all"
                />
                <select
                  value={newCollabRole}
                  onChange={e => setNewCollabRole(e.target.value as any)}
                  className="bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-zinc-300 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/50 transition-all"
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  type="submit"
                  disabled={isAdding || !newCollabInput.trim()}
                  className="flex items-center justify-center bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white rounded-xl px-4 font-medium transition-all shadow-lg shadow-violet-500/20 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.98]"
                >
                  {isAdding ? <Loader2 size={18} className="animate-spin" /> : <UserPlus size={18} />}
                </button>
              </div>
            </form>
          )}

          <div className="flex flex-col gap-3">
            <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Current Members ({collaborators.length})</label>
            
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 size={24} className="animate-spin text-violet-500/50" />
              </div>
            ) : collaborators.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center border border-dashed border-white/10 rounded-xl bg-white/[0.01]">
                <Shield size={24} className="text-zinc-600 mb-2" />
                <p className="text-sm text-zinc-400 font-medium">No collaborators yet</p>
                <p className="text-xs text-zinc-600 mt-1">Invite your team to start collaborating</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {collaborators.map(c => (
                  <div 
                    key={c.id} 
                    className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:border-white/10 hover:bg-white/[0.05] transition-all group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 shrink-0 rounded-full bg-gradient-to-br from-violet-500/20 to-indigo-500/20 border border-violet-500/10 text-violet-300 flex items-center justify-center font-bold text-xs uppercase shadow-inner">
                        {c.username.substring(0, 2)}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium text-zinc-200 truncate">{c.username}</span>
                        <span className="text-[11px] text-zinc-500 truncate max-w-[150px]" title={c.email}>{c.email}</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 shrink-0">
                      {processingId === c.id ? (
                        <Loader2 size={14} className="animate-spin text-zinc-500 mr-2" />
                      ) : userRole === 'admin' ? (
                        <select
                          value={c.role}
                          onChange={e => handleRoleChange(c.id, e.target.value)}
                          disabled={processingId !== null}
                          className="bg-black/30 border border-white/5 rounded-lg px-2 py-1 text-xs text-zinc-300 font-medium cursor-pointer hover:bg-black/50 focus:outline-none focus:border-violet-500/50 transition-colors"
                        >
                          <option value="viewer">Viewer</option>
                          <option value="editor">Editor</option>
                          <option value="admin">Admin</option>
                        </select>
                      ) : (
                        <span className="px-2 py-1 rounded-lg bg-black/20 border border-white/5 text-[11px] font-medium text-zinc-500 capitalize">
                          {c.role}
                        </span>
                      )}

                      {userRole === 'admin' && (
                        <button 
                          onClick={() => handleRemoveCollaborator(c.id)}
                          disabled={processingId !== null}
                          className="text-zinc-500 hover:text-red-400 hover:bg-red-400/10 transition-colors p-1.5 rounded-lg opacity-0 group-hover:opacity-100 disabled:opacity-50"
                          title="Remove Member"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
