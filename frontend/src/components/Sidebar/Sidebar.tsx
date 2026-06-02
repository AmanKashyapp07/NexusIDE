import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileCode, FolderCode, Plus, Trash2 } from 'lucide-react';
// interfaces are used in typescript to define the shape of objects and ensure type safety. In this case, the AppFile interface defines the structure of a file object used in the application, which includes properties like id, name, type, parent_id, and language. This allows developers to work with file objects confidently, knowing that they will have the expected properties and types throughout the codebase.
export interface AppFile {
  id: string;
  name: string;
  type: 'file' | 'directory';
  parent_id: string | null;
  language: string | null;
} // this is a TypeScript interface that defines the structure of a file object used in the application. Each file has an id, name, type (either 'file' or 'directory'), an optional parent_id that indicates the parent directory (or null if it's a root-level file), and an optional language property that specifies the programming language for files (null for directories). This interface is used to ensure type safety when working with file objects throughout the codebase.

interface SidebarProps {
  files: AppFile[];
  activeFileId: string | null;
  onFileSelect: (file: AppFile) => void;
  onFileCreate: (name: string, type: 'file' | 'directory', language: string | null, parentId: string | null) => void;
  onFileDelete: (id: string) => void;
} // this is a TypeScript interface that defines the props expected by the Sidebar component. It includes an array of files (of type AppFile), the id of the currently active file, and three callback functions: onFileSelect for when a file is selected, onFileCreate for when a new file or directory is created, and onFileDelete for when a file or directory is deleted. This interface helps ensure that the Sidebar component receives the correct data and functions it needs to operate properly.

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
    } // this groups the files by their parent_id using a Map, where the key is the parent_id (or null for root-level files) and the value is an array of files that belong to that parent. This allows for efficient retrieval of child files when building the tree structure for the sidebar, enabling the component to render nested directories and their contents correctly.

    const sortNodes = (nodes: AppFile[]) =>
      [...nodes].sort((left, right) => {
        if (left.type !== right.type) {
          return left.type === 'directory' ? -1 : 1;
        }

        return left.name.localeCompare(right.name);
      }); // this function sorts an array of AppFile nodes first by type (directories before files) and then alphabetically by name. It creates a new sorted array to avoid mutating the original. This sorting ensures that when the sidebar renders the file tree, directories are listed before files, and both are ordered alphabetically within their respective groups, providing a familiar and organized structure for users to navigate.

    const buildTree = (parentId: string | null): AppFile[] => sortNodes(nodesByParent.get(parentId) ?? []); // this function builds the tree structure for the sidebar by retrieving the child nodes for a given parentId from the nodesByParent Map and sorting them using the sortNodes function. It returns an array of AppFile objects that are children of the specified parentId, allowing the Sidebar component to render nested directories and their contents correctly. If there are no children for the given parentId, it returns an empty array.

    return {
      rootNodes: buildTree(null),
      childrenFor: (parentId: string) => buildTree(parentId),
    };
  }, [files]); // this fileTree is a memoized value that transforms a flat list of files into a hierarchical tree structure based on their parent-child relationships. It uses a Map to group files by their parent_id, and then defines a function to sort the nodes (directories first, then files alphabetically) and build the tree recursively. The resulting fileTree object provides rootNodes for top-level files and a childrenFor function to retrieve child nodes for any given parent id. This structure allows the Sidebar component to render the file explorer in a nested format, reflecting the directory structure of the files, we passed files as a dependency to useMemo, so the tree will be recomputed whenever the files array changes, ensuring that the UI stays in sync with the underlying data. time complexity of building the tree is O(n log n) due to the sorting step, where n is the number of files. The grouping step is O(n), and retrieving children for a parent is O(1) due to the use of a Map.

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
  }; // this handles the creation of a new file or directory when the user submits the form. It prevents the default form submission behavior, checks if the new file name is not empty, and then determines the language for new files based on their extension (defaulting to JavaScript). It calls the onFileCreate callback with the new file's name, type, language, and parentId. After creating the file or directory, it resets the form state to prepare for the next creation action.

  const openCreateForm = (type: 'file' | 'directory', parentId: string | null = null) => {
    setCreateType(type);
    setTargetParentId(parentId);
    setIsCreating(true);
  }; // this handles opening the form to create a new file or directory. It sets the type of item to create (file or directory), the target parentId where the new item should be created (or null for root-level), and then sets isCreating to true to display the creation form in the UI.

  const toggleFolder = (folderId: string) => {
    setExpandedFolders((current) => ({
      ...current,
      [folderId]: !current[folderId],
    }));
  }; // this function toggles the expanded/collapsed state of a folder in the sidebar. It updates the expandedFolders state by flipping the boolean value for the specified folderId, allowing users to expand or collapse directories to show or hide their contents in the file explorer.

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
            style={{ paddingLeft: `${depth * 12 + 6}px` }}
            className={`group relative flex h-6 cursor-pointer items-center justify-between pr-1 text-[13px] transition-colors ${
              activeFileId === file.id
                ? 'bg-[#04395e] text-[#ffffff]'
                : 'text-[#cccccc] hover:bg-[#2a2d2e]'
            }`}
          >
            {activeFileId === file.id && <span className="absolute left-0 top-0 h-full w-[2px] bg-[#007acc]" />}

            <div className="flex min-w-0 items-center gap-1.5 pl-1">
              {isFolder ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleFolder(file.id);
                  }}
                  className="flex h-4 w-4 items-center justify-center text-[#8f8f8f] transition-colors hover:text-[#cfcfcf]"
                  aria-label={isExpanded ? 'Collapse folder' : 'Expand folder'}
                >
                  {hasChildren ? (isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span className="h-1.5 w-1.5 rounded-full bg-[#5a5a5a]" />}
                </button>
              ) : (
                <span className="h-4 w-4" />
              )}

              {isFolder ? (
                <FolderCode size={15} className={activeFileId === file.id ? 'text-[#d7ba7d]' : 'text-[#c5c5c5] group-hover:text-[#e5e5e5]'} />
              ) : (
                <FileCode size={15} className={activeFileId === file.id ? 'text-[#9cdcfe]' : 'text-[#b6b6b6] group-hover:text-[#d7d7d7]'} />
              )}
              <span className="truncate text-[12.5px]">{file.name}</span>
            </div>

            <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              {isFolder && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    openCreateForm('file', file.id);
                  }}
                  className="rounded-sm p-1 text-[#a9a9a9] transition-colors hover:bg-[#3a3d41] hover:text-[#ffffff]"
                  title="Create file in folder"
                >
                  <Plus size={12} />
                </button>
              )}

              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onFileDelete(file.id);
                }}
                className="rounded-sm p-1 text-[#a9a9a9] transition-colors hover:bg-[#5a1d1d] hover:text-[#ffb3b3]"
                title={isFolder ? 'Delete Folder' : 'Delete File'}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>

          {isFolder && isExpanded && hasChildren && (
            <div className="space-y-0.5">
              {renderNodes(childNodes, depth + 1)}
            </div>
          )}
        </div>
      );
    }); // this function recursively renders the file and folder nodes in the sidebar. It takes an array of AppFile nodes and a depth level for indentation. For each file, it checks if it's a folder and whether it's expanded to determine how to render it. It applies appropriate styles for active files and provides buttons for creating new files within folders and deleting files or folders. If a folder is expanded and has children, it calls renderNodes recursively to render the child nodes with increased indentation, allowing for a nested display of the file structure in the sidebar.

  return (
    <div className="flex h-full w-64 flex-col border-r border-[#2a2a2a] bg-[#181818]">
      <div className="flex items-center justify-between border-b border-[#2a2a2a] px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8f8f8f]">Explorer</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => openCreateForm('file')}
            className="rounded-sm p-1 text-[#9d9d9d] transition-colors hover:bg-[#3a3d41] hover:text-[#ffffff]"
            title="New File"
          >
            <FileCode size={14} />
          </button>
          <button
            onClick={() => openCreateForm('directory')}
            className="rounded-sm p-1 text-[#9d9d9d] transition-colors hover:bg-[#3a3d41] hover:text-[#ffffff]"
            title="New Folder"
          >
            <FolderCode size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-0.5 overflow-y-auto px-1 py-1.5">
        {isCreating && (
          <div className="px-2 pb-1.5">
            <form onSubmit={handleCreate}>
              <div className="mb-1.5 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setCreateType('file')}
                  className={`rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors ${
                    createType === 'file'
                      ? 'border-[#007acc] bg-[#0d2c3f] text-[#9cdcfe]'
                      : 'border-[#3a3a3a] bg-[#222] text-[#9f9f9f] hover:bg-[#2a2d2e] hover:text-[#d7d7d7]'
                  }`}
                >
                  File
                </button>
                <button
                  type="button"
                  onClick={() => setCreateType('directory')}
                  className={`rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors ${
                    createType === 'directory'
                      ? 'border-[#007acc] bg-[#0d2c3f] text-[#9cdcfe]'
                      : 'border-[#3a3a3a] bg-[#222] text-[#9f9f9f] hover:bg-[#2a2d2e] hover:text-[#d7d7d7]'
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
                className="w-full rounded-sm border border-[#3a3a3a] bg-[#1e1e1e] px-2 py-1.5 text-[12px] text-[#d4d4d4] outline-none transition-colors placeholder:text-[#7f7f7f] focus:border-[#007acc]"
              />
            </form>
          </div>
        )}

        {renderNodes(fileTree.rootNodes)}
      </div>
    </div>
  ); // this is the JSX return statement of the Sidebar component, which renders the file explorer UI. It includes a header with the title "Explorer" and buttons for creating new files and folders. Below the header, it conditionally renders a form for creating new files or folders when isCreating is true. The main content area renders the file tree using the renderNodes function, which displays the hierarchical structure of files and directories. The component applies various styles for layout, colors, and interactions to create a user-friendly interface for navigating and managing files in the sidebar.
}