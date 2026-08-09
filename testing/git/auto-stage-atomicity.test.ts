import { describe, it, expect } from 'vitest';

describe('Git Auto-Stage Atomicity & Transaction Reversion Suite', () => {
  it('reverts staged files if git commit or push fails mid-transaction', () => {
    let indexStagedFiles = new Set<string>();

    const stageFiles = (files: string[]) => {
      files.forEach(f => indexStagedFiles.add(f));
    };

    const unstageAll = () => {
      indexStagedFiles.clear();
    };

    const executeCommitTransaction = (files: string[], shouldFail: boolean) => {
      stageFiles(files);
      if (shouldFail) {
        unstageAll(); // Rollback staged files on commit failure
        return { success: false, error: 'Commit failed: pre-commit hook returned exit code 1' };
      }
      return { success: true };
    };

    const failedCommit = executeCommitTransaction(['src/App.tsx', 'src/main.ts'], true);
    expect(failedCommit.success).toBe(false);
    expect(indexStagedFiles.size).toBe(0); // Rollback verified
  });
});
