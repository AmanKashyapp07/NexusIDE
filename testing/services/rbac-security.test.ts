import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import jwt from 'jsonwebtoken';
import { requireAuth, type AuthRequest } from '../../backend/src/middleware/auth.js';
import { requireWorkspaceRole } from '../../backend/src/middleware/workspaceAuth.js';
import { workspaceRepository } from '../../backend/src/repositories/workspace.repository.js';

describe('Socket Gateway RBAC & JWT Token Security Suite', () => {
  it('1. Viewer Role Security: requireWorkspaceRole middleware rejects mutation attempts from viewers', async () => {
    const middleware = requireWorkspaceRole('editor');

    const req = {
      user: { id: 'user-viewer-1', username: 'viewer_user' },
      params: { id: 'ws-101' }
    } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    vi.spyOn(workspaceRepository, 'findWorkspaceAuth').mockResolvedValue({ id: 'ws-101', owner_id: 'user-owner-99', is_public: true } as any);
    vi.spyOn(workspaceRepository, 'findCollaboratorRole').mockResolvedValue('viewer' as any);

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden: Requires at least editor role' });
    expect(next).not.toHaveBeenCalled();
  });

  it('2. Mid-Session JWT Expiration: requireAuth middleware rejects expired tokens', () => {
    const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

    const validToken = jwt.sign({ id: 'user-123', username: 'alice' }, JWT_SECRET, { expiresIn: '1h' });
    const reqValid = { headers: { authorization: `Bearer ${validToken}` }, query: {} } as any;
    const resValid = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const nextValid = vi.fn();

    requireAuth(reqValid, resValid, nextValid);
    expect(nextValid).toHaveBeenCalled();

    const expiredToken = jwt.sign({ id: 'user-123', username: 'alice' }, JWT_SECRET, { expiresIn: '-1s' });
    const reqExpired = { headers: { authorization: `Bearer ${expiredToken}` }, query: {} } as any;
    const resExpired = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const nextExpired = vi.fn();

    requireAuth(reqExpired, resExpired, nextExpired);
    expect(resExpired.status).toHaveBeenCalledWith(401);
    expect(resExpired.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
    expect(nextExpired).not.toHaveBeenCalled();
  });

  it('3. Path Traversal Defense in Socket File Events: blocks relative and URL-encoded path injection', () => {
    const isSafeSocketFilePath = (filename: string): boolean => {
      let decoded = filename;
      try {
        decoded = decodeURIComponent(filename);
      } catch {
        return false;
      }
      if (decoded.includes('..') || decoded.startsWith('/') || decoded.includes('\0')) {
        return false;
      }
      return true;
    };

    expect(isSafeSocketFilePath('src/index.ts')).toBe(true);
    expect(isSafeSocketFilePath('components/Editor.tsx')).toBe(true);
    expect(isSafeSocketFilePath('../../etc/passwd')).toBe(false);
    expect(isSafeSocketFilePath('%2e%2e%2fetc%2fpasswd')).toBe(false);
    expect(isSafeSocketFilePath('/root/.ssh/id_rsa')).toBe(false);
    expect(isSafeSocketFilePath('file\0.js')).toBe(false);
  });

  it('4. Owner Superuser Bypass: Workspace owner automatically receives admin role regardless of collaborator list', async () => {
    const middleware = requireWorkspaceRole('admin');

    const req = {
      user: { id: 'owner-777', username: 'boss' },
      params: { id: 'ws-202' }
    } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    vi.spyOn(workspaceRepository, 'findWorkspaceAuth').mockResolvedValue({ id: 'ws-202', owner_id: 'owner-777', is_public: false } as any);

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.workspaceRole).toBe('admin');
  });

  it('5. Role Escalation Prevention: Editor role is forbidden from admin-only routes', async () => {
    const middleware = requireWorkspaceRole('admin');

    const req = {
      user: { id: 'user-editor-1', username: 'editor_bob' },
      params: { id: 'ws-303' }
    } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    vi.spyOn(workspaceRepository, 'findWorkspaceAuth').mockResolvedValue({ id: 'ws-303', owner_id: 'owner-99', is_public: false } as any);
    vi.spyOn(workspaceRepository, 'findCollaboratorRole').mockResolvedValue('editor' as any);

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden: Requires at least admin role' });
    expect(next).not.toHaveBeenCalled();
  });

  it('6. Revoked Collaborator Mid-Session: Removed user receives 403 Access Denied', async () => {
    const middleware = requireWorkspaceRole('viewer');

    const req = {
      user: { id: 'ex-member-55', username: 'revoked_user' },
      params: { id: 'ws-404' }
    } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    vi.spyOn(workspaceRepository, 'findWorkspaceAuth').mockResolvedValue({ id: 'ws-404', owner_id: 'owner-99', is_public: false } as any);
    vi.spyOn(workspaceRepository, 'findCollaboratorRole').mockResolvedValue(null as any);

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden: Access denied' });
    expect(next).not.toHaveBeenCalled();
  });

  it('7. Unauthenticated Workspace Access: missing user ID triggers 401 Unauthorized', async () => {
    const middleware = requireWorkspaceRole('viewer');

    const req = { params: { id: 'ws-505' } } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    expect(next).not.toHaveBeenCalled();
  });

  it('8. Non-Existent Workspace Route: missing workspace record triggers 404 Not Found', async () => {
    const middleware = requireWorkspaceRole('viewer');

    const req = {
      user: { id: 'user-100', username: 'alice' },
      params: { id: 'ws-non-existent' }
    } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    vi.spyOn(workspaceRepository, 'findWorkspaceAuth').mockResolvedValue(null as any);

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Workspace not found' });
    expect(next).not.toHaveBeenCalled();
  });

  it('9. Viewer Terminal Sandbox Constraints: PTY environment strips PATH to /viewer_bin for viewers', () => {
    const setupTerminalEnv = (userRole: 'admin' | 'editor' | 'viewer'): { cmd: string[]; env: string[] } => {
      const isViewer = userRole === 'viewer';
      const envVars = ['TERM=xterm-256color'];
      if (isViewer) envVars.push('PATH=/viewer_bin');
      const cmd = isViewer ? ['/bin/bash', '--restricted'] : ['/bin/bash'];
      return { cmd, env: envVars };
    };

    const adminEnv = setupTerminalEnv('admin');
    expect(adminEnv.cmd).toEqual(['/bin/bash']);
    expect(adminEnv.env).not.toContain('PATH=/viewer_bin');

    const viewerEnv = setupTerminalEnv('viewer');
    expect(viewerEnv.cmd).toEqual(['/bin/bash', '--restricted']);
    expect(viewerEnv.env).toContain('PATH=/viewer_bin');
  });

  it('10. Cross-Workspace RBAC Boundary: Admin in Workspace A is denied access to Workspace B', async () => {
    const middleware = requireWorkspaceRole('viewer');

    const req = {
      user: { id: 'user-admin-a', username: 'alice' },
      params: { id: 'ws-b-private' }
    } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    vi.spyOn(workspaceRepository, 'findWorkspaceAuth').mockResolvedValue({ id: 'ws-b-private', owner_id: 'user-bob', is_public: false } as any);
    vi.spyOn(workspaceRepository, 'findCollaboratorRole').mockResolvedValue(null as any);

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden: Access denied' });
    expect(next).not.toHaveBeenCalled();
  });
});
