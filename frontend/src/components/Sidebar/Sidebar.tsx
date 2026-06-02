import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileCode, FolderCode, Plus, Trash2 } from 'lucide-react';

export interface AppFile {
  id: string;
  name: string;
  type: 'file' | 'directory';
  parent_id: string | null;
  language: string | null;
}

interface SidebarProps {
  files: AppFile[];
  activeFileId: string | null;
  onFileSelect: (file: AppFile) => void;
  onFileCreate: (name: string, type: 'file' | 'directory', language: string | null, parentId: string | null) => void;
  onFileDelete: (id: string) => void;
}

export default function Sidebar({ files, activeFileId, onFileSelect, onFileCreate, onFileDelete }: SidebarProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [createType, setCreateType] = useState<'file' | 'directory'>('file');
  const [newFileName, setNewFileName] = useState('');
  const [targetParentId, setTargetParentId] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});

  const fileTree = useMemo(() => {
    const nodesByParent = new Map<string | null, AppFile[]>();

    for (const file of files) {
      const parentKey = file.parent_id ?? null;
      const current = nodesByParent.get(parentKey) ?? [];
      current.push(file);
      nodesByParent.set(parentKey, current);
    }

    const sortNodes = (nodes: AppFile[]) =>
      [...nodes].sort((left, right) => {
        if (left.type !== right.type) {
          return left.type === 'directory' ? -1 : 1;
        }

        return left.name.localeCompare(right.name);
      });

    const buildTree = (parentId: string | null): AppFile[] => sortNodes(nodesByParent.get(parentId) ?? []);

    return {
      rootNodes: buildTree(null),
      childrenFor: (parentId: string) => buildTree(parentId),
    };
  }, [files]);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName.trim()) return;

    let lang: string | null = null;
    if (createType === 'file') {
      lang = 'javascript';
      if (newFileName.endsWith('.py')) lang = 'python';
      else if (newFileName.endsWith('.cpp')) lang = 'cpp';
      else if (newFileName.endsWith('.sh')) lang = 'bash';
    }

    onFileCreate(newFileName, createType, lang, targetParentId);
    setNewFileName('');
    setIsCreating(false);
    setCreateType('file');
    setTargetParentId(null);
  };

  const openCreateForm = (type: 'file' | 'directory', parentId: string | null = null) => {
    setCreateType(type);
    setTargetParentId(parentId);
    setIsCreating(true);
  };

  const toggleFolder = (folderId: string) => {
    setExpandedFolders((current) => ({
      ...current,
      [folderId]: !current[folderId],
    }));
  };

  const renderNodes = (nodes: AppFile[], depth = 0) =>
    nodes.map((file) => {
      const isFolder = file.type === 'directory';
      const isExpanded = expandedFolders[file.id] ?? true;
      const childNodes = isFolder ? fileTree.childrenFor(file.id) : [];
      const hasChildren = childNodes.length > 0;

      return (
        <div key={file.id} className="select-none">
          <div
            onClick={() => {
              if (isFolder) {
                toggleFolder(file.id);
                return;
              }

              onFileSelect(file);
            }}
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
            className={`group flex cursor-pointer items-center justify-between rounded-2xl px-3 py-2.5 text-sm transition-colors ${
              activeFileId === file.id
                ? 'border border-cyan-400/15 bg-cyan-400/10 text-cyan-100 font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]'
                : 'border border-transparent text-zinc-400 hover:border-white/10 hover:bg-white/5 hover:text-zinc-100'
            }`}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              {isFolder ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleFolder(file.id);
                  }}
                  className="flex h-4 w-4 items-center justify-center text-zinc-500 transition-colors hover:text-zinc-200"
                  aria-label={isExpanded ? 'Collapse folder' : 'Expand folder'}
                >
                  {hasChildren ? (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span className="h-2 w-2 rounded-full bg-zinc-700" />}
                </button>
              ) : (
                <span className="h-4 w-4" />
              )}

              {isFolder ? (
                <FolderCode size={16} className={activeFileId === file.id ? 'text-cyan-300' : 'text-zinc-500 group-hover:text-zinc-300'} />
              ) : (
                <FileCode size={16} className={activeFileId === file.id ? 'text-cyan-300' : 'text-zinc-500 group-hover:text-zinc-300'} />
              )}
              <span className="truncate">{file.name}</span>
            </div>

            <div className="flex items-center gap-1">
              {isFolder && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    openCreateForm('file', file.id);
                  }}
                  className="rounded-lg p-1 text-zinc-500 opacity-0 transition-colors hover:bg-white/10 hover:text-cyan-200 group-hover:opacity-100"
                  title="Create file in folder"
                >
                  <Plus size={13} />
                </button>
              )}

              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onFileDelete(file.id);
                }}
                className="rounded-lg p-1 text-zinc-500 opacity-0 transition-colors hover:bg-red-500/10 hover:text-red-300 group-hover:opacity-100"
                title={isFolder ? 'Delete Folder' : 'Delete File'}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          {isFolder && isExpanded && hasChildren && (
            <div className="mt-1 space-y-1">
              {renderNodes(childNodes, depth + 1)}
            </div>
          )}
        </div>
      );
    });

  return (
    <div className="flex h-full w-72 flex-col border-r border-white/10 bg-white/[0.03]">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <span className="text-[11px] font-semibold uppercase tracking-[0.28em] text-zinc-400">Explorer</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => openCreateForm('file')}
            className="rounded-xl border border-white/10 bg-white/5 p-2 text-zinc-400 transition-colors hover:border-white/15 hover:bg-white/10 hover:text-white"
            title="New File"
          >
            <FileCode size={16} />
          </button>
          <button
            onClick={() => openCreateForm('directory')}
            className="rounded-xl border border-white/10 bg-white/5 p-2 text-zinc-400 transition-colors hover:border-white/15 hover:bg-white/10 hover:text-white"
            title="New Folder"
          >
            <FolderCode size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
        {isCreating && (
          <div className="px-2 pb-2">
            <form onSubmit={handleCreate}>
              <div className="mb-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCreateType('file')}
                  className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] transition-colors ${
                    createType === 'file'
                      ? 'bg-cyan-400/15 text-cyan-200'
                      : 'bg-white/5 text-zinc-500 hover:bg-white/10 hover:text-zinc-200'
                  }`}
                >
                  File
                </button>
                <button
                  type="button"
                  onClick={() => setCreateType('directory')}
                  className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] transition-colors ${
                    createType === 'directory'
                      ? 'bg-cyan-400/15 text-cyan-200'
                      : 'bg-white/5 text-zinc-500 hover:bg-white/10 hover:text-zinc-200'
                  }`}
                >
                  Folder
                </button>
              </div>
              <input
                autoFocus
                type="text"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                onBlur={() => setIsCreating(false)}
                placeholder={createType === 'directory' ? 'folder-name' : 'filename.js'}
                className="w-full rounded-xl border border-cyan-400/30 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] outline-none transition focus:border-cyan-400/50 focus:ring-4 focus:ring-cyan-400/10"
              />
            </form>
          </div>
        )}

        {renderNodes(fileTree.rootNodes)}
      </div>
    </div>
  );
}