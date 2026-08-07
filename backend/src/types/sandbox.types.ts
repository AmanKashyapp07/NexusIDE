import type Docker from 'dockerode';

export interface WarmContainer {
   container: Docker.Container;
   id: string;
   hostPort?: number | undefined;
}

export interface WorkspaceContainerRef {
   container: Docker.Container;
   id: string;
   refCount: number;
   hostPort?: number | undefined;
   containerIP?: string | undefined;
   cleanupTimeout?: NodeJS.Timeout | null | undefined;
   lastActivityMs?: number | undefined;
   isPaused?: boolean | undefined;
}
