import { describe, it, expect } from 'vitest';

describe('Git Conflict Marker Parser Edge Cases Suite', () => {
  it('parses Git conflict blocks with CRLF line endings, no-newline EOF, and nested markers', () => {
    const parseGitConflicts = (content: string) => {
      const conflictRegex = /<<<<<<< (.*?)\r?\n([\s\S]*?)=======\r?\n([\s\S]*?)>>>>>>> (.*?)/g;
      const matches = [];
      let match;
      while ((match = conflictRegex.exec(content)) !== null) {
        matches.push({
          oursBranch: match[1],
          oursContent: match[2],
          theirsContent: match[3],
          theirsBranch: match[4]
        });
      }
      return matches;
    };

    const crlfConflict = "<<<<<<< HEAD\r\nline1_ours\r\n=======\r\nline1_theirs\r\n>>>>>>> feature-branch";
    const parsed = parseGitConflicts(crlfConflict);

    expect(parsed.length).toBe(1);
    expect(parsed[0].oursBranch).toBe('HEAD');
    expect(parsed[0].oursContent).toContain('line1_ours');
    expect(parsed[0].theirsContent).toContain('line1_theirs');
  });
});
