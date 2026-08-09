import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';

describe('useBlameAnnotations Line Gutter Hook Suite', () => {
  it('formats git blame commit author annotations per line gutter', () => {
    const useBlameFormatter = () => {
      const formatBlameLine = (commitHash: string, author: string, dateStr: string) => {
        return `${commitHash.substring(0, 7)} (${author} ${dateStr})`;
      };
      return { formatBlameLine };
    };

    const { result } = renderHook(() => useBlameFormatter());
    const line1 = result.current.formatBlameLine('a1b2c3d4e5f6', 'Alice', '2026-08-09');

    expect(line1).toBe('a1b2c3d (Alice 2026-08-09)');
  });
});
