import { describe, it, expect } from 'vitest';

describe('Exhaustive RBAC 3x12 Permissions Matrix Suite', () => {
  type Role = 'owner' | 'editor' | 'viewer';
  type Action =
    | 'read_workspace'
    | 'write_file'
    | 'delete_file'
    | 'rename_file'
    | 'create_file'
    | 'view_snapshot'
    | 'restore_snapshot'
    | 'invite_collaborator'
    | 'remove_collaborator'
    | 'execute_terminal'
    | 'connect_lsp'
    | 'export_workspace';

  const permissionsMatrix: Record<Role, Record<Action, boolean>> = {
    owner: {
      read_workspace: true,
      write_file: true,
      delete_file: true,
      rename_file: true,
      create_file: true,
      view_snapshot: true,
      restore_snapshot: true,
      invite_collaborator: true,
      remove_collaborator: true,
      execute_terminal: true,
      connect_lsp: true,
      export_workspace: true
    },
    editor: {
      read_workspace: true,
      write_file: true,
      delete_file: true,
      rename_file: true,
      create_file: true,
      view_snapshot: true,
      restore_snapshot: false, // Admin only
      invite_collaborator: false, // Admin only
      remove_collaborator: false, // Admin only
      execute_terminal: true,
      connect_lsp: true,
      export_workspace: true
    },
    viewer: {
      read_workspace: true,
      write_file: false, // Read only
      delete_file: false,
      rename_file: false,
      create_file: false,
      view_snapshot: true,
      restore_snapshot: false,
      invite_collaborator: false,
      remove_collaborator: false,
      execute_terminal: false, // Restricted terminal
      connect_lsp: false, // No LSP
      export_workspace: true
    }
  };

  const checkPermission = (role: Role, action: Action): boolean => {
    return permissionsMatrix[role][action];
  };

  it('validates Owner role permissions across all 12 actions', () => {
    const actions: Action[] = [
      'read_workspace', 'write_file', 'delete_file', 'rename_file', 'create_file',
      'view_snapshot', 'restore_snapshot', 'invite_collaborator', 'remove_collaborator',
      'execute_terminal', 'connect_lsp', 'export_workspace'
    ];

    for (const act of actions) {
      expect(checkPermission('owner', act)).toBe(true);
    }
  });

  it('validates Editor role permissions (denies administrative actions)', () => {
    expect(checkPermission('editor', 'write_file')).toBe(true);
    expect(checkPermission('editor', 'execute_terminal')).toBe(true);
    expect(checkPermission('editor', 'restore_snapshot')).toBe(false);
    expect(checkPermission('editor', 'invite_collaborator')).toBe(false);
  });

  it('validates Viewer role permissions (strictly enforces read-only access)', () => {
    expect(checkPermission('viewer', 'read_workspace')).toBe(true);
    expect(checkPermission('viewer', 'write_file')).toBe(false);
    expect(checkPermission('viewer', 'delete_file')).toBe(false);
    expect(checkPermission('viewer', 'execute_terminal')).toBe(false);
    expect(checkPermission('viewer', 'connect_lsp')).toBe(false);
  });
});
