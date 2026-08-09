import { useNavigate } from 'react-router-dom';
import { Users, LogOut, Download, History, Zap } from 'lucide-react';
import ActiveMembersDropdown from './ActiveMembersDropdown';
import type { AppFile } from '../Sidebar/Sidebar';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { useConnectionContext, type ConnectionStatus } from '../../context/ConnectionContext';

interface CollaboratorPresence {
  userId: string;
  username: string;
  color: string;
  activeFileId: string | null;
}

interface IdeHeaderProps {
  activeCollaborators: CollaboratorPresence[];
  typingUsers: Set<string>;
  files: AppFile[];
  activeFileId: string | null;
  urlWorkspaceId: string;
  isActiveMembersOpen: boolean;
  isBlameOpen: boolean;
  onToggleActiveMembers: () => void;
  onJumpToUser: (userId: string, fileId: string | null) => void;
  onShare: () => void;
  onExport: () => void;
  onSnapshot: () => void;
  onHideBlame: () => void;
  onLogout: () => void;
}

const STATUS_DOT: Record<ConnectionStatus, string> = {
  connected:    'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]',
  disconnected: 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]',
  connecting:   'bg-amber-500 animate-pulse',
};

const styles = {
  headerBtn: 'flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/10 hover:text-white',
  logoutBtn:  'flex items-center justify-center rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400',
  blameBtn:   'flex items-center gap-1.5 rounded-md bg-indigo-500/10 hover:bg-indigo-500/20 px-3 py-1.5 text-xs font-medium text-indigo-400 border border-indigo-500/20 transition-colors',
};

/**
 * IDE Sub-Component: IdeHeader
 * Top navigation bar for the IDE: branding, status, collaborators, and actions.
 * Consumes workspace info and connection status via context providers.
 */
export default function IdeHeader({
  activeCollaborators,
  typingUsers,
  files,
  activeFileId,
  urlWorkspaceId,
  isActiveMembersOpen,
  isBlameOpen,
  onToggleActiveMembers,
  onJumpToUser,
  onShare,
  onExport,
  onSnapshot,
  onHideBlame,
  onLogout,
}: IdeHeaderProps) {
  const navigate = useNavigate();
  const { workspaceTitle, userRole, workspaceId } = useWorkspaceContext();
  const { connectionStatus } = useConnectionContext();

  return (
    <header className="relative z-50 flex h-14 shrink-0 items-center justify-between border-b border-white/[0.04] bg-[#030303]/80 px-4 shadow-sm backdrop-blur-xl">
      {/* Left: Logo + workspace name + status */}
      <div className="flex items-center gap-4">
        <div
          className="group flex cursor-pointer items-center gap-3 transition-opacity hover:opacity-80"
          onClick={() => navigate('/dashboard')}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-inner">
            <Zap className="text-white" size={16} strokeWidth={2.5} />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tracking-tight text-zinc-100">{workspaceTitle}</span>
              <div
                className={`h-2 w-2 rounded-full ${STATUS_DOT[connectionStatus]}`}
                title={`Status: ${connectionStatus}`}
              />
            </div>
            <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">{userRole} workspace</span>
          </div>
        </div>
      </div>

      {/* Right: Actions + collaborators */}
      <div className="flex items-center gap-3">
        {/* Blame toggle */}
        {isBlameOpen && (
          <button onClick={onHideBlame} className={styles.blameBtn}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
            Hide Blame
          </button>
        )}

        <div className="h-6 w-[1px] bg-white/[0.08] mx-2" />

        {/* Active collaborators */}
        <ActiveMembersDropdown
          collaborators={activeCollaborators}
          typingUsers={typingUsers}
          files={files}
          activeFileId={activeFileId}
          workspaceId={workspaceId}
          isOpen={isActiveMembersOpen}
          onToggle={onToggleActiveMembers}
          onJumpToUser={onJumpToUser}
        />

        {/* Action button group */}
        <div className="flex items-center gap-1.5 bg-[#121214] rounded-lg p-1 border border-white/[0.04] shadow-sm">
          <button onClick={onShare} className={styles.headerBtn}>
            <Users size={14} />
            Share
          </button>
          <button onClick={onExport} className={styles.headerBtn}>
            <Download size={14} />
            Export
          </button>
          <button
            onClick={onSnapshot}
            className={styles.headerBtn}
            title={userRole === 'admin' ? 'Create snapshot / view history' : 'View snapshot history'}
          >
            <History size={14} />
            History
          </button>
          <button onClick={onLogout} className={styles.logoutBtn} title="Logout">
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}
