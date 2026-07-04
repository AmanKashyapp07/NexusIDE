import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { X, Users, UserPlus, Loader2, Trash2, Shield, Mail } from 'lucide-react';
import { apiUrl } from '../../lib/backendUrls';

type CollaboratorRole = 'admin' | 'editor' | 'viewer';

interface Collaborator {
  id: string;
  username: string;
  email: string;
  role: CollaboratorRole;
  joined_at: string;
}

interface CollaboratorsModalProps {
  workspaceId: string;
  userRole: string;
  isOpen: boolean;
  onClose: () => void;
}

const COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#a855f7',
  '#ec4899',
];

const getUserColor = (username: string) => {
  if (!username) return '#3f3f46';
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
};

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : 'Unexpected error';

export default function CollaboratorsModal({ workspaceId, userRole, isOpen, onClose }: CollaboratorsModalProps) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newCollabInput, setNewCollabInput] = useState('');
  const [newCollabRole, setNewCollabRole] = useState<CollaboratorRole>('viewer');
  const [isAdding, setIsAdding] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadCollaborators = useCallback(async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(apiUrl(`/workspace/${workspaceId}/collaborators`), {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Failed to fetch collaborators');
    return res.json() as Promise<Collaborator[]>;
  }, [workspaceId]);

  useEffect(() => {
    if (!isOpen) return;

    let isActive = true;
    const fetchInitialCollaborators = async () => {
      try {
        const data = await loadCollaborators();
        if (isActive) setCollaborators(data);
      } catch (err) {
        if (isActive) setError(getErrorMessage(err));
      } finally {
        if (isActive) setIsLoading(false);
      }
    };

    void fetchInitialCollaborators();
    return () => {
      isActive = false;
    };
  }, [isOpen, loadCollaborators]);

  const handleAddCollaborator = async (e: FormEvent) => {
    e.preventDefault();
    if (!newCollabInput.trim()) return;

    setIsAdding(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(apiUrl(`/workspace/${workspaceId}/collaborators`), {
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
      setCollaborators(await loadCollaborators());
    } catch (err) {
      setError(getErrorMessage(err));
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
      const res = await fetch(apiUrl(`/workspace/${workspaceId}/collaborators/${userId}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to remove collaborator');
      }
      
      setCollaborators(prev => prev.filter(c => c.id !== userId));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setProcessingId(null);
    }
  };

  const handleRoleChange = async (userId: string, newRole: CollaboratorRole) => {
    setProcessingId(userId);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(apiUrl(`/workspace/${workspaceId}/collaborators/${userId}`), {
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
      
      setCollaborators(prev => prev.map(c => c.id === userId ? { ...c, role: newRole } : c));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setProcessingId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={onClose}
    >
      <style>
        {`
          .ide-scrollbar::-webkit-scrollbar {
            width: 8px;
          }
          .ide-scrollbar::-webkit-scrollbar-track {
            background: transparent;
          }
          .ide-scrollbar::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 4px;
          }
          .ide-scrollbar::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.2);
          }
        `}
      </style>

      <div 
        className="w-full max-w-lg bg-[#1e1e1e] border border-[#333333] rounded-md shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2b2b2b] bg-[#1e1e1e]">
          <div className="flex items-center gap-2">
            <Users size={15} className="text-zinc-400" />
            <h2 className="text-[13px] font-semibold text-[#cccccc]">Manage Access</h2>
          </div>
          <button 
            onClick={onClose} 
            className="flex items-center justify-center rounded p-1 text-zinc-400 hover:text-white hover:bg-[#2a2d2e] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 flex-1 overflow-y-auto ide-scrollbar">
          {error && (
            <div className="mb-4 p-2.5 bg-red-500/10 border border-red-500/20 rounded-[3px] flex items-start gap-2 text-red-400 text-xs">
              <span className="mt-0.5 font-bold">!</span>
              <p>{error}</p>
            </div>
          )}

          {/* Invite Section */}
          {userRole === 'admin' && (
            <form onSubmit={handleAddCollaborator} className="mb-6">
              <label className="block text-[11px] font-semibold text-zinc-400 mb-2">Invite Collaborator</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                    <Mail size={13} className="text-zinc-500" />
                  </div>
                  <input
                    type="text"
                    placeholder="Username or Email"
                    value={newCollabInput}
                    onChange={e => { setNewCollabInput(e.target.value); setError(null); }}
                    className="w-full bg-[#3c3c3c] border border-transparent rounded-[3px] pl-8 pr-3 py-1.5 text-[13px] text-[#cccccc] placeholder-zinc-500 focus:outline-none focus:border-[#007fd4] focus:bg-[#3c3c3c] transition-colors"
                  />
                </div>
                <select
                  value={newCollabRole}
                  onChange={e => setNewCollabRole(e.target.value as CollaboratorRole)}
                  className="bg-[#3c3c3c] border border-transparent rounded-[3px] px-2 py-1.5 text-[13px] text-[#cccccc] focus:outline-none focus:border-[#007fd4] transition-colors"
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  type="submit"
                  disabled={isAdding || !newCollabInput.trim()}
                  className="flex items-center justify-center gap-1.5 bg-[#007fd4] hover:bg-[#006abc] text-white rounded-[3px] px-4 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isAdding ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                  <span>Invite</span>
                </button>
              </div>
            </form>
          )}

          {/* Collaborators List */}
          <div className="flex flex-col">
            <label className="block text-[11px] font-semibold text-zinc-400 mb-2">
              Current Members ({collaborators.length})
            </label>
            
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 size={20} className="animate-spin text-[#007fd4]" />
              </div>
            ) : collaborators.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center border border-dashed border-[#333333] rounded-[3px] bg-[#252526]">
                <Shield size={20} className="text-zinc-500 mb-2" />
                <p className="text-[13px] text-[#cccccc] font-medium">No collaborators yet</p>
                <p className="text-[12px] text-zinc-500 mt-0.5">Invite your team to start collaborating</p>
              </div>
            ) : (
              <div className="flex flex-col gap-[2px]">
                {collaborators.map(c => (
                  <div 
                    key={c.id} 
                    className="flex items-center justify-between px-2.5 py-2 rounded-[3px] hover:bg-[#2a2d2e] transition-colors group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div 
                        className="h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-[10px] font-medium text-white shadow-sm"
                        style={{ backgroundColor: getUserColor(c.username) }}
                      >
                        {c.username.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-[13px] font-medium text-[#cccccc] truncate">{c.username}</span>
                        <span className="text-[11px] text-zinc-500 truncate" title={c.email}>{c.email}</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 shrink-0">
                      {processingId === c.id ? (
                        <Loader2 size={13} className="animate-spin text-zinc-500 mr-2" />
                      ) : userRole === 'admin' ? (
                        <select
                          value={c.role}
                          onChange={e => handleRoleChange(c.id, e.target.value as CollaboratorRole)}
                          disabled={processingId !== null}
                          className="bg-[#313131] border border-transparent rounded-[3px] px-1.5 py-1 text-[12px] text-[#cccccc] cursor-pointer hover:bg-[#3c3c3c] focus:outline-none focus:border-[#007fd4] transition-colors"
                        >
                          <option value="viewer">Viewer</option>
                          <option value="editor">Editor</option>
                          <option value="admin">Admin</option>
                        </select>
                      ) : (
                        <span className="px-2 py-1 rounded-[3px] bg-[#313131] text-[11px] text-[#cccccc] capitalize">
                          {c.role}
                        </span>
                      )}

                      {userRole === 'admin' && (
                        <button 
                          onClick={() => handleRemoveCollaborator(c.id)}
                          disabled={processingId !== null}
                          className="flex h-6 w-6 items-center justify-center text-zinc-500 hover:text-red-400 hover:bg-[#3c3c3c] rounded-[3px] transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
                          title="Remove Member"
                        >
                          <Trash2 size={13} />
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