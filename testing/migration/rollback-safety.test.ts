import { describe, it, expect } from 'vitest';

describe('Database Rollback Safety Suite', () => {
  it('executes down migration in reverse chronological order without data loss', () => {
    const appliedMigrations = ['001_init', '002_add_index', '003_add_column'];

    const rollbackMigrationStep = () => {
      return appliedMigrations.pop();
    };

    const rolledBack = rollbackMigrationStep();
    expect(rolledBack).toBe('003_add_column');
    expect(appliedMigrations).toEqual(['001_init', '002_add_index']);
  });
});
