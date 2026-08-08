import type { Response, NextFunction } from 'express';
import type { AuthRequest } from './auth.js';
import { workspaceRepository } from '../repositories/workspace.repository.js';

export type CollaboratorRole = 'viewer' | 'editor' | 'admin';

export interface WorkspaceAuthRequest extends AuthRequest {
   workspaceRole?: CollaboratorRole;
}

const roleHierarchy: Record<CollaboratorRole, number> = { viewer: 1, editor: 2, admin: 3 };

export const requireWorkspaceRole = (minRole: CollaboratorRole) => {
   return async (req: WorkspaceAuthRequest, res: Response, next: NextFunction): Promise<void> => {
      try {
         const userId = req.user?.id;
         if (!userId) { 
            res.status(401).json({ error: 'Unauthorized' }); 
            return; 
         }

         const workspaceId = (req.params.id || req.params.workspaceId || req.body.workspaceId) as string | undefined;
         if (!workspaceId) { 
            res.status(400).json({ error: 'Workspace ID required' }); 
            return; 
         }

         const workspace = await workspaceRepository.findWorkspaceAuth(workspaceId);
         if (!workspace) { 
            res.status(404).json({ error: 'Workspace not found' }); 
            return; 
         }

         if (workspace.owner_id === userId) {
            req.workspaceRole = 'admin';
            return next();
         }

         const collabRole = await workspaceRepository.findCollaboratorRole(workspaceId, userId);
         const userRole: CollaboratorRole | null = (collabRole as CollaboratorRole | null) || 
            (workspace.is_public ? 'viewer' : null);

         if (!userRole) { 
            res.status(403).json({ error: 'Forbidden: Access denied' }); 
            return; 
         }

         if (roleHierarchy[userRole] < roleHierarchy[minRole]) {
            res.status(403).json({ error: `Forbidden: Requires at least ${minRole} role` });
            return;
         }

         req.workspaceRole = userRole;
         next();
         
      } catch (error: unknown) {
         console.error('[Auth] Workspace Middleware Error:', error);
         res.status(500).json({ error: 'Internal Server Error' });
      }
   };
};