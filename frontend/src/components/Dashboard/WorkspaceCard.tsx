import { useState } from 'react';
import { Users, Clock, Edit2, Trash2, Check, X, ArrowUpRight } from 'lucide-react';
import type { Workspace } from '../../hooks/useWorkspaces';

interface WorkspaceCardProps {
  ws: Workspace;
  userId: string;
  editingWorkspaceId: string | null;
  editingTitle: string;
  onNavigate: (id: string) => void;
  onEditStart: (e: React.MouseEvent, ws: Workspace) => void;
  onEditSave: (e: React.MouseEvent | React.FormEvent, id: string) => void;
  onEditCancel: () => void;
  onEditTitleChange: (title: string) => void;
  onDelete: (e: React.MouseEvent, ws: Workspace) => void;
}

const styles = {
  card: (isEditing: boolean) =>
    `group relative overflow-hidden rounded-xl border border-white/10 bg-[#121318] p-5 transition-all duration-200 hover:border-violet-500/30 hover:bg-[#16171d] hover:shadow-[0_0_20px_rgba(139,92,246,0.05)] ${
      isEditing ? 'cursor-default ring-1 ring-violet-500/50' : 'cursor-pointer hover:-translate-y-0.5'
    }`,
  editInput: 'flex-1 rounded-md border border-violet-500/50 bg-[#09090b] px-3 py-1.5 text-sm text-white outline-none focus:ring-1 focus:ring-violet-500',
  saveBtn:   'rounded-md p-1.5 text-emerald-400 hover:bg-emerald-500/10',
  cancelBtn: 'rounded-md p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white',
  actionBtn: 'rounded-md p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white',
  deleteBtn: 'rounded-md p-1.5 ml-1 text-zinc-400 hover:bg-red-500/10 hover:text-red-400',
  title:     'text-base font-medium text-zinc-200 group-hover:text-violet-200 transition-colors pr-16 truncate',
  meta:      'mt-5 flex items-center gap-4 text-xs font-medium text-zinc-500',
};

function formatDate(dateString: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(dateString));
}

/**
 * Dashboard Sub-Component: WorkspaceCard
 * Renders a single workspace item with inline rename and delete actions.
 */
export default function WorkspaceCard({
  ws,
  editingWorkspaceId,
  editingTitle,
  onNavigate,
  onEditStart,
  onEditSave,
  onEditCancel,
  onEditTitleChange,
  onDelete,
}: WorkspaceCardProps) {
  const isEditing = editingWorkspaceId === ws.id;

  return (
    <div
      onClick={() => { if (!isEditing) onNavigate(ws.id); }}
      className={styles.card(isEditing)}
    >
      <div className="flex items-start justify-between min-h-[2.5rem]">
        {isEditing ? (
          <form className="flex w-full items-center gap-2" onSubmit={(e) => onEditSave(e, ws.id)}>
            <input
              autoFocus
              type="text"
              value={editingTitle}
              onChange={(e) => onEditTitleChange(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              className={styles.editInput}
            />
            <button type="submit" className={styles.saveBtn}><Check size={16} /></button>
            <button type="button" className={styles.cancelBtn} onClick={(e) => { e.stopPropagation(); onEditCancel(); }}>
              <X size={16} />
            </button>
          </form>
        ) : (
          <>
            <h3 className={styles.title}>{ws.title}</h3>

            {/* Action buttons — visible on hover */}
            <div className="absolute right-4 top-4 z-10 flex opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <button onClick={(e) => onEditStart(e, ws)} className={styles.actionBtn} title="Edit Title">
                <Edit2 size={15} />
              </button>
              <button onClick={(e) => onDelete(e, ws)} className={styles.deleteBtn} title="Delete Workspace">
                <Trash2 size={15} />
              </button>
            </div>

            {/* Hover arrow indicator */}
            <div className="absolute right-5 top-5 text-zinc-600 opacity-0 transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-1 group-hover:-translate-y-1">
              <ArrowUpRight size={18} />
            </div>
          </>
        )}
      </div>

      {/* Metadata footer */}
      <div className={styles.meta}>
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
  );
}
