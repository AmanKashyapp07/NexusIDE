import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { getPool } from '../db';

// =============================================================================
// WORKSPACE ROLE-BASED ACCESS CONTROL (RBAC) MIDDLEWARE
// =============================================================================
//
// PURPOSE:
//   Intercepts and authorizes incoming HTTP requests targeting specific workspace 
//   resources based on the user's role. It enforces security boundaries to prevent
//   Broken Object-Level Authorization (BOLA) and Insecure Direct Object References (IDOR).
//
// DESIGN ARCHITECTURE & PATTERNS:
//
//   1. Middleware Chain Pattern (Express):
//      Extracts authentication data (userId) set by the upstream JWT authentication
//      middleware, performs database-driven authorization checks, and attaches the
//      resolved role (req.workspaceRole) for subsequent route handlers to consume.
//
//   2. Dynamic Role Resolution & Hierarchy:
//      - Roles are mapped statically to numerical weights (viewer: 1, editor: 2, admin: 3).
//      - The middleware accepts a target minimum role and performs a comparison:
//        ResolvedRole.Weight >= MinRole.Weight
//      - This allows permissions to scale hierarchically. Adding a new role only 
//        requires inserting it in the hierarchy map, avoiding complex switch-case or nested conditional logic.
//
//   3. Owner Authorization Short-circuit:
//      - The workspace schema defines a core `owner_id`.
//      - The creator/owner is implicitly granted 'admin' privileges.
//      - This is a normalization trade-off: it avoids duplicating user-role rows for 
//        the owner in workspace_collaborators, enforcing data integrity (a workspace 
//        can never lose its primary owner, preventing orphaned workspaces).
//
//   4. Implicit Public Workspace Access:
//      - For workspaces marked `is_public: true`, users who are not listed in the 
//        collaborators table are implicitly resolved to the `viewer` role.
//      - This enables global read accessibility without polluting the database 
//        with explicit read permission entries.
//
// SECURITY & INTERVIEW TOPICS:
//
//   - Broken Object-Level Authorization (BOLA / IDOR):
//     - BOLA occurs when an application relies on client-provided IDs (e.g., workspaceId) 
//       without verifying if the active user is authorized to perform actions on that record.
//     - This middleware mitigates BOLA by extracting the workspace ID, querying the DB 
//       source-of-truth, and validating permissions before allowing routing to proceed.
//
//   - JWT Claims vs. Database Checks (Stateful vs. Stateless Authorization):
//     - Why NOT store workspace roles inside JWT claims?
//       - JWTs are stateless and immutable. If a user is revoked or demoted, a JWT-based 
//         claim remains valid until token expiration (typically 15m to 1h).
//       - Real-time permission changes require querying the active database (or a fast 
//         cache like Redis). We perform a quick DB query here to ensure absolute consistency.
//
//   - Parameter Extraction Robustness:
//     - The middleware checks `req.params.id`, `req.params.workspaceId`, and `req.body.workspaceId`.
//     - This polymorphism makes it highly reusable across varying REST endpoint routes.
//
// =============================================================================

export type CollaboratorRole = 'viewer' | 'editor' | 'admin';

export interface WorkspaceAuthRequest extends AuthRequest {
  workspaceRole?: CollaboratorRole;
}

// Numerical role hierarchy to facilitate direct comparison operations (<, >=).
// Facilitates clean extension: if we add a new role (e.g., 'super_admin' at weight 4),
// the business logic comparing roles remains unchanged.
const roleHierarchy: Record<CollaboratorRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
};

// Higher-Order Function (Curried Middleware):
// Returns an Express middleware function configured to enforce a specific minimum role.
// Allows clean route declarations like: router.get('/:id', requireWorkspaceRole('viewer'), handler)
export const requireWorkspaceRole = (minRole: CollaboratorRole) => {
  return async (req: WorkspaceAuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized: User not found in request' });
        return;
      }

      // Support extracting the workspace ID dynamically from path parameters or body payload
      const workspaceId = req.params.id || req.params.workspaceId || req.body.workspaceId;

      if (!workspaceId) {
        res.status(400).json({ error: 'Bad Request: Workspace ID required' });
        return;
      }

      // Step 1: Query the Workspace metadata to verify ownership and public access status.
      // This is a BOLA mitigation: retrieving the true owner_id and is_public flag
      // directly from our relational source-of-truth rather than relying on client input.
      const wsResult = await getPool().query(
        'SELECT owner_id, is_public FROM workspaces WHERE id = $1',
        [workspaceId]
      );

      if (wsResult.rows.length === 0) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      const workspace = wsResult.rows[0];

      // Implicit Privilege Escalation:
      // Workspace owners bypass collaborator checks and are hardcoded to be Admins.
      // Enforces integrity at the database model level.
      if (workspace.owner_id === userId) {
        req.workspaceRole = 'admin';
        next();
        return;
      }

      // Step 2: Check explicit collaborator mapping
      const collabResult = await getPool().query(
        'SELECT role FROM workspace_collaborators WHERE workspace_id = $1 AND user_id = $2',
        [workspaceId, userId]
      );

      let userRole: CollaboratorRole | null = null;

      if (collabResult.rows.length > 0) {
        userRole = collabResult.rows[0].role as CollaboratorRole;
      } else if (workspace.is_public) {
        // Fallback to implicit viewer access for public workspaces
        userRole = 'viewer';
      }

      if (!userRole) {
        res.status(403).json({ error: 'Forbidden: You do not have access to this workspace' });
        return;
      }

      // Step 3: Perform weight-based hierarchy validation.
      // A viewer (1) attempting editor (2) work fails: 1 < 2.
      if (roleHierarchy[userRole] < roleHierarchy[minRole]) {
        res.status(403).json({ error: `Forbidden: Requires at least ${minRole} role` });
        return;
      }

      // Context Propagation:
      // Forward the resolved role down the middleware chain.
      // Subsequent controllers/routers can make granular UI/API adjustments without querying the DB again.
      req.workspaceRole = userRole;
      next();
    } catch (error) {
      console.error('Workspace Auth Middleware Error:', error);
      res.status(500).json({ error: 'Internal Server Error during authorization' });
    }
  };
};

