import { memo } from 'react';
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

function IdeHeaderBase({
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
  const { workspaceTitle, userRole } = useWorkspaceContext();
  const { connectionStatus } = useConnectionContext();

  return (
    <header className="flex h-12 w-full items-center justify-between border-b border-white/[0.08] bg-[#0c0c0e]/90 px-4 backdrop-blur-md z-30 select-none">
      {/* Left section: status indicator and workspace info */}
      <div className="flex items-center gap-3">
        <div
          className="flex cursor-pointer items-center gap-2 rounded-md p-1.5 transition-colors hover:bg-white/5"
          onClick={() => navigate('/dashboard')}
          title="Back to Dashboard"
        >
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-tr from-indigo-600 to-violet-500 text-white shadow-sm">
            <Zap size={14} className="fill-white/20" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-white">NexusIDE</span>
        </div>

        <div className="h-4 w-[1px] bg-white/10" />

        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-zinc-300 max-w-[200px] truncate">{workspaceTitle}</span>
          <div className={`h-2 w-2 rounded-full ${STATUS_DOT[connectionStatus]}`} title={`Connection: ${connectionStatus}`} />
          {userRole && (
            <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 border border-white/5">
              {userRole}
            </span>
          )}
        </div>
      </div>

      {/* Right section: actions and active collaborators */}
      <div className="flex items-center gap-2">
        {isBlameOpen && (
          <button onClick={onHideBlame} className={styles.blameBtn} title="Hide Blame Annotations">
            <History size={13} />
            Hide Blame
          </button>
        )}

        {/* Active Collaborators Dropdown & Avatar stack */}
        <div className="relative">
          <div
            className="flex cursor-pointer items-center gap-1.5 rounded-md p-1 transition-colors hover:bg-white/5"
            onClick={onToggleActiveMembers}
          >
            <div className="flex -space-x-1.5 overflow-hidden">
              {activeCollaborators.slice(0, 4).map((collab) => (
                <div
                  key={collab.userId}
                  className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-[#0c0c0e]"
                  style={{ backgroundColor: collab.color }}
                  title={`${collab.username}${typingUsers.has(collab.userId) ? ' (typing...)' : ''}`}
                >
                  {collab.username.substring(0, 2).toUpperCase()}
                </div>
              ))}
            </div>
            <span className="text-xs font-medium text-zinc-400">{activeCollaborators.length} online</span>
          </div>

        {/* Active collaborators */}
        <ActiveMembersDropdown
          collaborators={activeCollaborators}
          typingUsers={typingUsers}
          files={files}
          activeFileId={activeFileId}
          workspaceId={urlWorkspaceId}
          isOpen={isActiveMembersOpen}
          onToggle={onToggleActiveMembers}
          onJumpToUser={onJumpToUser}
        />
        </div>

        <div className="h-4 w-[1px] bg-white/10" />

        {/* Toolbar actions */}
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

const IdeHeader = memo(IdeHeaderBase);
export default IdeHeader;
