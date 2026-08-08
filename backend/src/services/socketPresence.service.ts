import type { Server as SocketIOServer, Socket } from 'socket.io';
import { redisPresenceService } from './redisPresence.service.js';

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

export const broadcastPresence = async (io: SocketIOServer, wsId: string): Promise<void> => {
   // Blend local memory state with distributed Redis state
   const redisMembers = await redisPresenceService.getWorkspacePresence(wsId);
   const localMembers = Array.from(workspacePresence.get(wsId)?.values() || []);
   const merged = redisMembers.length > 0 ? redisMembers : localMembers;
   io.to(`presence-${wsId}`).emit('workspace-presence-update', merged);
};

export function setupSocketPresenceHandlers(io: SocketIOServer, socket: Socket): void {
   socket.on('join-workspace', ({ workspaceId }: { workspaceId: string }) => {
      const user = socket.data.user as { id: string; username?: string } | undefined;
      if (!user || !workspaceId) return;
      socket.data.presenceWorkspaceId = workspaceId;
      socket.join(`presence-${workspaceId}`);
      
      const member: PresenceMember = {
         userId: user.id,
         username: user.username || 'unknown',
         color: getColor(user.username || 'unknown'),
         activeFileId: null
      };

      if (!workspacePresence.has(workspaceId)) workspacePresence.set(workspaceId, new Map());
      workspacePresence.get(workspaceId)!.set(socket.id, member);
      
      // Sync with distributed Redis presence mesh
      redisPresenceService.setUserPresence(workspaceId, socket.id, member).catch(() => {});

      broadcastPresence(io, workspaceId);
      socket.emit('file-tree-update');
   });

   socket.on('active-file-change', ({ activeFileId }: { activeFileId: string | null }) => {
      const wsId = socket.data.presenceWorkspaceId as string | undefined;
      if (!wsId) return;
      const member = workspacePresence.get(wsId)?.get(socket.id);
      if (member) { 
         member.activeFileId = activeFileId; 
         redisPresenceService.updateActiveFile(wsId, socket.id, activeFileId).catch(() => {});
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
         redisPresenceService.removeUserPresence(wsId, socket.id).catch(() => {});
         broadcastPresence(io, wsId);
         socket.data.presenceWorkspaceId = undefined;
      }
   });

   socket.on('disconnect', () => {
      const wsId = socket.data.presenceWorkspaceId as string | undefined;
      if (wsId) {
         workspacePresence.get(wsId)?.delete(socket.id);
         if (workspacePresence.get(wsId)?.size === 0) workspacePresence.delete(wsId);
         redisPresenceService.removeUserPresence(wsId, socket.id).catch(() => {});
         broadcastPresence(io, wsId);
      }
   });
}
