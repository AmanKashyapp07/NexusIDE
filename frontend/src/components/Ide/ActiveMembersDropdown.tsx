import { ChevronDown, Activity, FileText } from 'lucide-react';
import type { AppFile } from '../Sidebar/Sidebar';

interface CollaboratorPresence {
  userId: string;
  username: string;
  color: string;
  activeFileId: string | null;
}

interface ActiveMembersDropdownProps {
  collaborators: CollaboratorPresence[];
  typingUsers: Set<string>;
  files: AppFile[];
  activeFileId: string | null;
  workspaceId: string | null;
  isOpen: boolean;
  onToggle: () => void;
  onJumpToUser: (userId: string, fileId: string | null) => void;
}

const styles = {
  avatarWrapper: 'relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-2 border-[#030303] text-[10px] font-bold text-white shadow-sm transition-transform group-hover:-translate-y-0.5 hover:scale-110 hover:z-20',
  overflow:      'relative z-0 flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#030303] bg-zinc-800 text-[10px] font-bold text-white shadow-sm',
  dropdown:      'absolute right-0 top-full mt-2 w-56 rounded-2xl border border-white/[0.08] bg-[#0A0A0A]/95 p-2 shadow-2xl backdrop-blur-xl z-50',
  memberBtn:     (clickable: boolean) =>
    `w-full flex items-center gap-3 rounded-xl px-2 py-2 transition-all ${
      clickable ? 'hover:bg-white/5 cursor-pointer' : 'opacity-60 cursor-default'
    }`,
};

function TypingDots() {
  return (
    <span className="inline-flex gap-0.5 items-center">
      <span className="h-1 w-1 rounded-full bg-blue-400 animate-bounce [animation-delay:0ms]" />
      <span className="h-1 w-1 rounded-full bg-blue-400 animate-bounce [animation-delay:150ms]" />
      <span className="h-1 w-1 rounded-full bg-blue-400 animate-bounce [animation-delay:300ms]" />
    </span>
  );
}

/**
 * IDE Sub-Component: ActiveMembersDropdown
 * Collaborator presence avatars + expandable member list with jump-to-cursor.
 */
export default function ActiveMembersDropdown({
  collaborators,
  typingUsers,
  files,
  activeFileId,
  isOpen,
  onToggle,
  onJumpToUser,
}: ActiveMembersDropdownProps) {
  if (collaborators.length === 0) return null;

  return (
    <div className="relative flex items-center">
      <button
        onClick={onToggle}
        className="group flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-white/5"
      >
        <div className="flex items-center -space-x-1.5">
          {collaborators.slice(0, 3).map((c, i) => (
            <div
              key={c.userId}
              className={styles.avatarWrapper}
              style={{ backgroundColor: c.color || '#6366f1', zIndex: 10 - i }}
              title={`Jump to ${c.username}'s cursor`}
              onClick={(e) => {
                e.stopPropagation();
                onJumpToUser(c.userId, c.activeFileId);
              }}
            >
              {c.username ? c.username.substring(0, 2).toUpperCase() : '??'}
              <div className="absolute bottom-0 right-0 h-2 w-2 rounded-full border-2 border-[#0c0c0e] bg-emerald-500" />
              {typingUsers.has(c.userId) && (
                <div className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-blue-400 animate-ping" />
              )}
            </div>
          ))}
          {collaborators.length > 3 && (
            <div className={styles.overflow}>+{collaborators.length - 3}</div>
          )}
        </div>
        <span className="text-xs font-medium text-zinc-400">{collaborators.length} online</span>
        <ChevronDown size={13} className={`text-zinc-500 transition-transform duration-200 ${isOpen ? 'rotate-180 text-zinc-300' : 'group-hover:text-zinc-300'}`} />
      </button>

      {isOpen && (
        <div className={styles.dropdown}>
          <div className="mb-2 flex items-center gap-2 px-2 pb-2 text-xs font-semibold text-zinc-400 border-b border-white/5">
            <Activity size={12} className="text-emerald-500" />
            Online Members
          </div>
          <div className="max-h-60 overflow-y-auto flex flex-col gap-1">
            {collaborators.map((c) => (
              <button
                key={c.userId}
                onClick={() => onJumpToUser(c.userId, c.activeFileId)}
                className={styles.memberBtn(!!c.activeFileId)}
              >
                <div className="relative">
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-sm"
                    style={{ backgroundColor: c.color || '#6366f1' }}
                  >
                    {c.username ? c.username.substring(0, 2).toUpperCase() : '??'}
                  </div>
                  <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0A0A0A] bg-emerald-500" />
                </div>
                <div className="flex flex-col items-start min-w-0">
                  <span className="text-sm font-medium text-zinc-200 truncate w-full text-left flex items-center gap-1.5">
                    {c.username || 'Unknown'}
                    {typingUsers.has(c.userId) && <TypingDots />}
                  </span>
                  {c.activeFileId && (
                    <span className="text-[11px] text-zinc-500 truncate w-full text-left flex items-center gap-1">
                      <FileText size={10} />
                      {files.find(f => f.id === c.activeFileId)?.name || 'Editing'}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
