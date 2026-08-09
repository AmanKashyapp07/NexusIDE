import { describe, it, expect } from 'vitest';

describe('Concurrent Git Conflict Resolution Race Suite', () => {
  it('resolves concurrent conflict resolution attempts idempotently (first winner prevails)', () => {
    let resolvedState: { fileId: string; resolvedBy: string; choice: 'ours' | 'theirs' } | null = null;

    const resolveConflict = (fileId: string, actorId: string, choice: 'ours' | 'theirs') => {
      if (resolvedState !== null) {
        return { success: true, winner: resolvedState.resolvedBy, status: 'already_resolved' };
      }
      resolvedState = { fileId, resolvedBy: actorId, choice };
      return { success: true, winner: actorId, status: 'resolved' };
    };

    const resUserA = resolveConflict('src/App.tsx', 'user-alice', 'ours');
    expect(resUserA.status).toBe('resolved');

    const resUserB = resolveConflict('src/App.tsx', 'user-bob', 'theirs');
    expect(resUserB.status).toBe('already_resolved');
    expect(resUserB.winner).toBe('user-alice');
  });
});
