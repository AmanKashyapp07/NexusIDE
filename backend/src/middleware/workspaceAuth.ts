import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { getPool } from '../db';

export type CollaboratorRole = 'viewer' | 'editor' | 'admin';
export interface WorkspaceAuthRequest extends AuthRequest { workspaceRole?: CollaboratorRole; }

// [ARCHITECTURE] Role Hierarchy Map
// Maps string roles to numeric weights. This avoids brittle switch-statements or nested conditionals.
// Adding a 'super_admin' later just means adding a new key with weight 4. Comparison is always O(1).
const roleHierarchy: Record<CollaboratorRole, number> = { viewer: 1, editor: 2, admin: 3 };

// [ARCHITECTURE] Curried Middleware (Higher-Order Function)
// Returns a closure. This allows clean, declarative route definitions in Express:
// e.g., `router.post('/:id', requireWorkspaceRole('editor'), handler)`
export const requireWorkspaceRole = (minRole: CollaboratorRole) => {
  return async (req: WorkspaceAuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

      // [UX/DX] Polymorphic Parameter Extraction
      // Checks params and body so this middleware can be reused across GET, POST, and PUT routes seamlessly.
      const workspaceId = req.params.id || req.params.workspaceId || req.body.workspaceId;
      if (!workspaceId) { res.status(400).json({ error: 'Workspace ID required' }); return; }

      // [SECURITY] BOLA / IDOR Mitigation & Stateful Authorization
      // INTERVIEW KEY: Why query the DB instead of reading the role from the user's JWT?
      // JWTs are stateless. If a user is demoted or removed, their JWT still says "admin" until it expires.
      // Querying the DB guarantees real-time, strongly consistent permission checks.
      const wsResult = await getPool().query('SELECT owner_id, is_public FROM workspaces WHERE id = $1', [workspaceId]);
      if (wsResult.rows.length === 0) { res.status(404).json({ error: 'Workspace not found' }); return; }
      
      const workspace = wsResult.rows[0];

      // [DATA INTEGRITY] Implicit Owner Escalation
      // The workspace creator inherently has admin rights. This avoids duplicating owner records in the 
      // `workspace_collaborators` table, preventing edge cases where an owner accidentally deletes their own role.
      if (workspace.owner_id === userId) {
        req.workspaceRole = 'admin';
        return next();
      }

      const collabResult = await getPool().query('SELECT role FROM workspace_collaborators WHERE workspace_id = $1 AND user_id = $2', [workspaceId, userId]);
      
      // [ARCHITECTURE] Implicit Fallback
      // If no explicit collaborator record exists, but the workspace is public, grant baseline 'viewer' access.
      let userRole: CollaboratorRole | null = collabResult.rows.length > 0 
        ? (collabResult.rows[0].role as CollaboratorRole) 
        : (workspace.is_public ? 'viewer' : null);

      if (!userRole) { res.status(403).json({ error: 'Forbidden: Access denied' }); return; }

      // [SECURITY] Weight-Based Validation
      // e.g., A Viewer (1) attempting an Editor (2) action fails here because 1 < 2.
      if (roleHierarchy[userRole] < roleHierarchy[minRole]) {
        res.status(403).json({ error: `Forbidden: Requires at least ${minRole} role` });
        return;
      }

      // [ARCHITECTURE] Context Propagation
      // Attach the resolved role to the request object so downstream controllers can use it 
      // (e.g., to conditionally mask sensitive API fields) without having to query the database again.
      req.workspaceRole = userRole;
      next();
      
    } catch (error) {
      console.error('[Auth] Workspace Middleware Error:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  };
};