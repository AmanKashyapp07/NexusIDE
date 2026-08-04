import type { Server as SocketIOServer, Socket } from 'socket.io';

export interface PresenceMember {
   userId: string;
   username: string;
   color: string;
   activeFileId: string | null;
}

const workspacePresence = new Map<string, Map<string, PresenceMember>>();
const PRESENCE_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899'];

const getColor = (username: string): string => {
   const hash = [...username].reduce((h, c) => c.charCodeAt(0) + ((h << 5) - h), 0);
   return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length]!;
};

export const broadcastPresence = (io: SocketIOServer, wsId: string): void => {
   io.to(`presence-${wsId}`).emit('workspace-presence-update', Array.from(workspacePresence.get(wsId)?.values() || []));
};

export function setupSocketPresenceHandlers(io: SocketIOServer, socket: Socket): void {
   socket.on('join-workspace', ({ workspaceId }: { workspaceId: string }) => {
      const user = socket.data.user as { id: string; username?: string } | undefined;
      if (!user || !workspaceId) return;
      socket.data.presenceWorkspaceId = workspaceId;
      socket.join(`presence-${workspaceId}`);
      
      if (!workspacePresence.has(workspaceId)) workspacePresence.set(workspaceId, new Map());
      workspacePresence.get(workspaceId)!.set(socket.id, {
         userId: user.id,
         username: user.username || 'unknown',
         color: getColor(user.username || 'unknown'),
         activeFileId: null
      });
      broadcastPresence(io, workspaceId);
      socket.emit('file-tree-update');
   });

   socket.on('active-file-change', ({ activeFileId }: { activeFileId: string | null }) => {
      const wsId = socket.data.presenceWorkspaceId as string | undefined;
      if (!wsId) return;
      const member = workspacePresence.get(wsId)?.get(socket.id);
      if (member) { 
         member.activeFileId = activeFileId; 
         broadcastPresence(io, wsId); 
      }
   });

   socket.on('broadcast-file-tree', ({ workspaceId }: { workspaceId: string }) => {
      const user = socket.data.user;
      if (!user || !workspaceId) return;
      io.to(`presence-${workspaceId}`).emit('file-tree-update');
   });

   socket.on('user-typing', ({ workspaceId }: { workspaceId: string }) => {
      const user = socket.data.user as { id: string } | undefined;
      if (!user || !workspaceId) return;
      socket.to(`presence-${workspaceId}`).emit('user-typing', { userId: user.id });
   });

   socket.on('leave-workspace', () => {
      const wsId = socket.data.presenceWorkspaceId as string | undefined;
      if (wsId) {
         socket.leave(`presence-${wsId}`);
         workspacePresence.get(wsId)?.delete(socket.id);
         if (workspacePresence.get(wsId)?.size === 0) workspacePresence.delete(wsId);
         broadcastPresence(io, wsId);
         socket.data.presenceWorkspaceId = undefined;
      }
   });

   socket.on('disconnect', () => {
      const wsId = socket.data.presenceWorkspaceId as string | undefined;
      if (wsId) {
         workspacePresence.get(wsId)?.delete(socket.id);
         if (workspacePresence.get(wsId)?.size === 0) workspacePresence.delete(wsId);
         broadcastPresence(io, wsId);
      }
   });
}
