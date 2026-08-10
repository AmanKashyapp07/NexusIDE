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
      <div className="flex h-full min-h-[380px] w-full flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-[#0d0d11]/80 backdrop-blur-xl p-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-900 border border-zinc-800 mb-4 text-purple-400">
          <FolderCode size={26} />
        </div>
        <h3 className="text-base font-bold text-white">No active workspaces</h3>
        <p className="text-xs font-semibold text-zinc-400 mt-1 max-w-xs leading-relaxed">
          Create your first sandbox environment or join an existing session to start coding.
        </p>
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
