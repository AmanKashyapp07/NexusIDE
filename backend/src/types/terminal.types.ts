export type TerminalRole = 'viewer' | 'editor' | 'admin';

export interface TerminalWatcherEntry {
   path: string;
   mtime: number;
   size: number;
   isDir: boolean;
   inode: string;
}

export interface WorkspaceFileDetail {
   id: string;
   type: 'file' | 'directory';
   content: string;
}

export interface WorkspaceFilesMapResult {
   pathToId: Map<string, string>;
   idToPath: Map<string, string>;
   fileDetails: Map<string, WorkspaceFileDetail>;
}

export interface LspConnectionParams {
   workspaceId: string;
   lang: string;
   token: string;
}
