import { createContext, useContext, type ReactNode } from 'react';

export type UserRole = 'admin' | 'editor' | 'viewer';
export interface WorkspaceUser { username: string; id: string; }

interface WorkspaceContextValue {
  workspaceId: string | null;
  workspaceTitle: string;
  userRole: UserRole | null;
  user: WorkspaceUser | null;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

interface WorkspaceProviderProps {
  value: WorkspaceContextValue;
  children: ReactNode;
}

export function WorkspaceProvider({ value, children }: WorkspaceProviderProps) {
  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspaceContext(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspaceContext must be used within a WorkspaceProvider');
  }
  return context;
}
