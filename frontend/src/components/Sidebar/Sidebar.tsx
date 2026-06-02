import { useState } from 'react';
import { FileCode, Plus, Trash2 } from 'lucide-react';

export interface AppFile {
  id: string;
  name: string;
  type: 'file' | 'directory';
  parent_id: string | null;
  language: string;
}

interface SidebarProps {
  files: AppFile[];
  activeFileId: string | null;
  onFileSelect: (file: AppFile) => void;
  onFileCreate: (name: string, type: 'file' | 'directory', language: string) => void;
  onFileDelete: (id: string) => void;
}

export default function Sidebar({ files, activeFileId, onFileSelect, onFileCreate, onFileDelete }: SidebarProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newFileName, setNewFileName] = useState('');

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName.trim()) return;

    let lang = 'javascript';
    if (newFileName.endsWith('.py')) lang = 'python';
    else if (newFileName.endsWith('.cpp')) lang = 'cpp';
    else if (newFileName.endsWith('.sh')) lang = 'bash';

    onFileCreate(newFileName, 'file', lang);
    setNewFileName('');
    setIsCreating(false);
  };

  return (
    <div className="flex h-full w-72 flex-col border-r border-white/10 bg-white/[0.03]">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <span className="text-[11px] font-semibold uppercase tracking-[0.28em] text-zinc-400">Explorer</span>
        <button 
          onClick={() => setIsCreating(true)}
          className="rounded-xl border border-white/10 bg-white/5 p-2 text-zinc-400 transition-colors hover:border-white/15 hover:bg-white/10 hover:text-white"
          title="New File"
        >
          <Plus size={16} />
        </button>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
        {isCreating && (
          <div className="px-2 pb-2">
            <form onSubmit={handleCreate}>
              <input
                autoFocus
                type="text"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                onBlur={() => setIsCreating(false)}
                placeholder="filename.js"
                className="w-full rounded-xl border border-cyan-400/30 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] outline-none transition focus:border-cyan-400/50 focus:ring-4 focus:ring-cyan-400/10"
              />
            </form>
          </div>
        )}

        {files.map(file => (
          <div 
            key={file.id}
            onClick={() => onFileSelect(file)}
            className={`group flex cursor-pointer items-center justify-between rounded-2xl px-3 py-2.5 text-sm transition-colors ${
              activeFileId === file.id 
                ? 'border border-cyan-400/15 bg-cyan-400/10 text-cyan-100 font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]' 
                : 'border border-transparent text-zinc-400 hover:border-white/10 hover:bg-white/5 hover:text-zinc-100'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <FileCode size={16} className={activeFileId === file.id ? 'text-cyan-300' : 'text-zinc-500 group-hover:text-zinc-300'} />
              <span className="truncate">{file.name}</span>
            </div>
            
            <button
              onClick={(e) => {
                e.stopPropagation();
                onFileDelete(file.id);
              }}
              className="rounded-lg p-1 text-zinc-500 opacity-0 transition-colors hover:bg-red-500/10 hover:text-red-300 group-hover:opacity-100"
              title="Delete File"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}