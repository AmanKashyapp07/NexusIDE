import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getNexusToken } from '../lib/tokenStorage';
import { useToast } from '../components/Toast/Toast';
import {
  fetchWorkspaces as apiFetchWorkspaces,
  createWorkspace as apiCreateWorkspace,
  deleteWorkspace as apiDeleteWorkspace,
  renameWorkspace as apiRenameWorkspace,
  type Workspace
} from '../api/workspace';

export type { Workspace };

interface UseWorkspacesReturn {
  workspaces: Workspace[];
  isCreating: boolean;
  deletingWorkspace: Workspace | null;
  editingWorkspaceId: string | null;
  editingTitle: string;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  setDeletingWorkspace: (ws: Workspace | null) => void;
  setEditingWorkspaceId: (id: string | null) => void;
  setEditingTitle: (title: string) => void;
  fetchWorkspaces: () => Promise<void>;
  handleCreate: (title: string) => Promise<void>;
  handleJoin: (id: string) => void;
  handleDelete: (ws: Workspace, userId: string) => void;
  confirmDelete: () => Promise<void>;
  handleEditStart: (ws: Workspace, userId: string) => void;
  handleEditSave: (id: string) => Promise<void>;
}

/**
 * Custom Hook: useWorkspaces
 * Encapsulates workspace CRUD: listing, creation, deletion, renaming, and join.
 * All API calls and state mutations live here. Zero JSX.
 */
export function useWorkspaces(): UseWorkspacesReturn {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [deletingWorkspace, setDeletingWorkspace] = useState<Workspace | null>(null);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const navigate = useNavigate();
  const { addToast } = useToast();

  const fetchWorkspaces = useCallback(async () => {
    try {
      const token = getNexusToken();
      const data = await apiFetchWorkspaces(token);
      setWorkspaces(data);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const handleCreate = useCallback(async (title: string) => {
    if (!title.trim()) return;
    setIsCreating(true);
    try {
      const token = getNexusToken();
      const data = await apiCreateWorkspace(token, title);
      addToast('Workspace created successfully', 'success');
      navigate(`/${data.id}`);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to create workspace', 'error');
      setIsCreating(false);
    }
  }, [navigate, addToast]);

  const handleJoin = useCallback((id: string) => {
    if (!id.trim()) return;
    navigate(`/${id.trim()}`);
  }, [navigate]);

  const handleDelete = useCallback((ws: Workspace, userId: string) => {
    if (userId !== ws.owner_id) {
      addToast('You are not Admin of this workspace', 'error');
      return;
    }
    setDeletingWorkspace(ws);
  }, [addToast]);

  const confirmDelete = useCallback(async () => {
    if (!deletingWorkspace) return;
    const ws = deletingWorkspace;
    setDeletingWorkspace(null);

    try {
      const token = getNexusToken();
      await apiDeleteWorkspace(token, ws.id);
      setWorkspaces(prev => prev.filter(item => item.id !== ws.id));
      addToast('Workspace deleted successfully', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to delete workspace', 'error');
    }
  }, [deletingWorkspace, addToast]);

  const handleEditStart = useCallback((ws: Workspace, userId: string) => {
    const isOwner = userId === ws.owner_id;
    const isAdmin = isOwner || ws.user_role === 'admin';
    if (!isAdmin) {
      addToast('You are not Admin of this workspace', 'error');
      return;
    }
    setEditingWorkspaceId(ws.id);
    setEditingTitle(ws.title);
  }, [addToast]);

  const handleEditSave = useCallback(async (id: string) => {
    if (!editingTitle.trim()) {
      setEditingWorkspaceId(null);
      return;
    }
    try {
      const token = getNexusToken();
      await apiRenameWorkspace(token, id, editingTitle);
      setWorkspaces(prev => prev.map(ws => ws.id === id ? { ...ws, title: editingTitle } : ws));
      addToast('Workspace title updated', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to update workspace title', 'error');
    } finally {
      setEditingWorkspaceId(null);
    }
  }, [editingTitle, addToast]);

  return {
    workspaces,
    isCreating,
    deletingWorkspace,
    editingWorkspaceId,
    editingTitle,
    setWorkspaces,
    setDeletingWorkspace,
    setEditingWorkspaceId,
    setEditingTitle,
    fetchWorkspaces,
    handleCreate,
    handleJoin,
    handleDelete,
    confirmDelete,
    handleEditStart,
    handleEditSave,
  };
}
