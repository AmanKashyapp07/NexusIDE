import { useMemo, useState, useEffect, useRef } from 'react';
import { 
  ChevronRight, 
  Folder, 
  FolderOpen, 
  FilePlus, 
  FolderPlus, 
  Trash2, 
  RefreshCw,
  FileText
} from 'lucide-react';

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
  onRefresh?: () => void;
  readOnly?: boolean;
}

interface CreateState {
  type: 'file' | 'directory';
  parentId: string | null;
}

// Helper to give a touch of color to files based on extension, matching modern IDEs
const getFileColor = (name: string) => {
  const lower = name.toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'text-[#3178c6]';
  if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'text-[#f7df1e]';
  if (lower.endsWith('.py')) return 'text-[#3572A5]';
  if (lower.endsWith('.html')) return 'text-[#e34c26]';
  if (lower.endsWith('.css')) return 'text-[#563d7c]';
  if (lower.endsWith('.json')) return 'text-[#cbd5e1]';
  if (lower.endsWith('.md')) return 'text-[#3b82f6]';
  return 'text-zinc-400';
};

export default function Sidebar({ files, activeFileId, onFileSelect, onFileCreate, onFileDelete, onRefresh, readOnly = false }: SidebarProps) {
  const [createState, setCreateState] = useState<CreateState | null>(null);
  const [newFileName, setNewFileName] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (createState) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [createState]);

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

  const handleCreateSubmit = () => {
    if (!newFileName.trim() || !createState) {
      cancelCreate();
      return;
    }

    let lang: string | null = null;
    if (createState.type === 'file') {
      const nameLower = newFileName.toLowerCase();
      if (nameLower.endsWith('.py')) lang = 'python';
      else if (nameLower.endsWith('.cpp') || nameLower.endsWith('.cc') || nameLower.endsWith('.cxx')) lang = 'cpp';
      else if (nameLower.endsWith('.c') || nameLower.endsWith('.h')) lang = 'c';
      else if (nameLower.endsWith('.ts') || nameLower.endsWith('.tsx')) lang = 'typescript';
      else if (nameLower.endsWith('.js') || nameLower.endsWith('.jsx')) lang = 'javascript';
      else if (nameLower.endsWith('.sh')) lang = 'bash';
      else if (nameLower.endsWith('.css')) lang = 'css';
      else if (nameLower.endsWith('.html')) lang = 'html';
      else if (nameLower.endsWith('.json')) lang = 'json';
      else if (nameLower.endsWith('.md')) lang = 'markdown';
      else lang = 'plaintext';
    }

    onFileCreate(newFileName, createState.type, lang, createState.parentId);
    cancelCreate();
  };

  const cancelCreate = () => {
    setCreateState(null);
    setNewFileName('');
  };

  const openCreateForm = (type: 'file' | 'directory', parentId: string | null = null) => {
    setCreateState({ type, parentId });
    setNewFileName('');

    if (parentId) {
      setExpandedFolders((prev) => ({ ...prev, [parentId]: true }));
    }
  };

  const toggleFolder = (folderId: string) => {
    setExpandedFolders((current) => ({
      ...current,
      [folderId]: !current[folderId],
    }));
  };

  const renderInlineInput = (depth: number) => {
    const isFolder = createState?.type === 'directory';
    return (
      <div 
        className="flex items-center gap-1.5 py-0.5 pr-2"
        style={{ paddingLeft: `${depth * 12 + 24}px` }}
      >
        {isFolder ? (
          <Folder size={14} className="text-violet-400" />
        ) : (
          <FileText size={14} className="text-zinc-400" />
        )}
        <input
          ref={inputRef}
          type="text"
          value={newFileName}
          onChange={(e) => setNewFileName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCreateSubmit();
            if (e.key === 'Escape') cancelCreate();
          }}
          onBlur={cancelCreate}
          className="h-6 flex-1 rounded-[3px] border border-[#007fd4] bg-[#252526] px-1.5 text-[13px] text-zinc-200 shadow-sm outline-none font-mono"
        />
      </div>
    );
  };

  const renderNodes = (nodes: AppFile[], depth = 0) =>
    nodes.map((file) => {
      const isFolder = file.type === 'directory';
      const isExpanded = expandedFolders[file.id] ?? false;
      const childNodes = isFolder ? fileTree.childrenFor(file.id) : [];
      const hasChildren = childNodes.length > 0;
      const isCreatingInsideThisFolder = createState?.parentId === file.id;
      const isActive = activeFileId === file.id;

      return (
        <div key={file.id} className="select-none">
          <div
            onClick={() => {
              if (isFolder) {
                toggleFolder(file.id);
              } else {
                onFileSelect(file);
              }
            }}
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
            className={`group relative flex h-[26px] cursor-pointer items-center justify-between pr-2 transition-none ${
              isActive
                ? 'bg-[#37373d] text-white'
                : 'text-[#cccccc] hover:bg-[#2a2d2e] hover:text-white'
            }`}
          >
            {isActive && (
              <span className="absolute left-0 top-0 h-full w-[2px] bg-[#007fd4]" />
            )}

            <div className="flex min-w-0 flex-1 items-center gap-1 pl-1">
              {isFolder ? (
                <button
                  type="button"
                  className="flex h-4 w-4 items-center justify-center text-zinc-400 transition-colors hover:text-zinc-200"
                >
                  <ChevronRight 
                    size={14} 
                    className={`transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`} 
                  />
                </button>
              ) : (
                <span className="h-4 w-4" />
              )}

              {isFolder ? (
                isExpanded ? (
                  <FolderOpen size={14} className="text-violet-400 shrink-0" />
                ) : (
                  <Folder size={14} className="text-violet-400 shrink-0" />
                )
              ) : (
                <FileText size={14} className={`${getFileColor(file.name)} shrink-0`} />
              )}
              <span className="truncate text-[13px] ml-0.5 tracking-wide">{file.name}</span>
            </div>

            {!readOnly && (
              <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                {isFolder && (
                  <>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openCreateForm('file', file.id);
                      }}
                      className="flex h-5 w-5 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                      title="New File"
                    >
                      <FilePlus size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openCreateForm('directory', file.id);
                      }}
                      className="flex h-5 w-5 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                      title="New Folder"
                    >
                      <FolderPlus size={13} />
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onFileDelete(file.id);
                  }}
                  className="flex h-5 w-5 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-red-500/20 hover:text-red-400"
                  title={isFolder ? 'Delete Folder' : 'Delete File'}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )}
          </div>

          {isFolder && (isExpanded || isCreatingInsideThisFolder) && (
            <div className="relative">
              {/* Hierarchy guide line */}
              <div 
                className="absolute bottom-0 top-0 border-l border-white/10" 
                style={{ left: `${depth * 12 + 15}px` }} 
              />
              
              {isCreatingInsideThisFolder && renderInlineInput(depth + 1)}

              {hasChildren && <div className="space-y-[1px]">{renderNodes(childNodes, depth + 1)}</div>}
            </div>
          )}
        </div>
      );
    });

  return (
    <div className="flex h-full w-full flex-col border-r border-[#2b2b2b] bg-[#181818] text-[#cccccc]">
      <style>
        {`
          .ide-scrollbar::-webkit-scrollbar {
            width: 10px;
            height: 10px;
          }
          .ide-scrollbar::-webkit-scrollbar-track {
            background: transparent;
          }
          .ide-scrollbar::-webkit-scrollbar-thumb {
            background: transparent;
            border: 3px solid #181818;
            border-radius: 6px;
          }
          .ide-scrollbar:hover::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.1);
          }
          .ide-scrollbar::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.2);
          }
        `}
      </style>
      
      <div className="flex items-center justify-between px-4 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Explorer</span>
        {!readOnly && (
          <div className="flex items-center gap-0.5">
            {onRefresh && (
              <button
                onClick={onRefresh}
                className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                title="Refresh Explorer"
              >
                <RefreshCw size={13} />
              </button>
            )}
            <button
              onClick={() => openCreateForm('file')}
              className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
              title="New File"
            >
              <FilePlus size={14} />
            </button>
            <button
              onClick={() => openCreateForm('directory')}
              className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
              title="New Folder"
            >
              <FolderPlus size={14} />
            </button>
          </div>
        )}
      </div>

      <div className="ide-scrollbar flex-1 overflow-y-auto py-1 outline-none">
        {createState?.parentId === null && renderInlineInput(0)}
        {renderNodes(fileTree.rootNodes)}
      </div>
    </div>
  );
}