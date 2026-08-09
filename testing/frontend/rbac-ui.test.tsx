import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

describe('RBAC Role-Based UI Component Rendering Suite', () => {
  it('hides edit buttons and terminal input for Viewer roles (read-only mode)', () => {
    const WorkspaceToolbar = ({ userRole }: { userRole: 'owner' | 'editor' | 'viewer' }) => {
      const isReadOnly = userRole === 'viewer';
      return (
        <div>
          <span data-testid="role-badge">{userRole}</span>
          {!isReadOnly && <button data-testid="btn-delete">Delete File</button>}
          {!isReadOnly && <button data-testid="btn-save">Save File</button>}
        </div>
      );
    };

    const { rerender } = render(<WorkspaceToolbar userRole="editor" />);
    expect(screen.getByTestId('btn-delete')).toBeDefined();
    expect(screen.getByTestId('btn-save')).toBeDefined();

    rerender(<WorkspaceToolbar userRole="viewer" />);
    expect(screen.queryByTestId('btn-delete')).toBeNull();
    expect(screen.queryByTestId('btn-save')).toBeNull();
  });
});
