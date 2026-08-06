import { FolderCode } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import WorkspaceCard from './WorkspaceCard';
import type { Workspace } from '../../hooks/useWorkspaces';

interface WorkspaceGridProps {
  workspaces: Workspace[];
  userId: string;
  editingWorkspaceId: string | null;
  editingTitle: string;
  onEditStart: (e: React.MouseEvent, ws: Workspace) => void;
  onEditSave: (e: React.MouseEvent | React.FormEvent, id: string) => void;
  onEditCancel: () => void;
  onEditTitleChange: (title: string) => void;
  onDelete: (e: React.MouseEvent, ws: Workspace) => void;
}

/**
 * Dashboard Sub-Component: WorkspaceGrid
 * Renders the grid of WorkspaceCards, or an empty-state illustration.
 */
export default function WorkspaceGrid({
  workspaces,
  userId,
  editingWorkspaceId,
  editingTitle,
  onEditStart,
  onEditSave,
  onEditCancel,
  onEditTitleChange,
  onDelete,
}: WorkspaceGridProps) {
  const navigate = useNavigate();

  if (workspaces.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.01] py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/5 mb-4">
          <FolderCode size={28} className="text-zinc-500" />
        </div>
        <h3 className="text-lg font-medium text-zinc-200">No workspaces yet</h3>
        <p className="text-sm text-zinc-500 mt-1 max-w-xs">Create your first sandbox environment to start writing code.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {workspaces.map(ws => (
        <WorkspaceCard
          key={ws.id}
          ws={ws}
          userId={userId}
          editingWorkspaceId={editingWorkspaceId}
          editingTitle={editingTitle}
          onNavigate={(id) => { if (editingWorkspaceId !== ws.id) navigate(`/${id}`); }}
          onEditStart={onEditStart}
          onEditSave={onEditSave}
          onEditCancel={onEditCancel}
          onEditTitleChange={onEditTitleChange}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
