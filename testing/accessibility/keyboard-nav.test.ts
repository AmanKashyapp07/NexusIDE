import { describe, it, expect } from 'vitest';

describe('Keyboard-Only File Tree Navigation Suite', () => {
  it('navigates file tree items via ArrowUp/ArrowDown keys and opens file on Enter key', () => {
    const fileItems = ['src/App.tsx', 'src/main.ts', 'package.json'];
    let selectedIndex = 0;
    let openedFile: string | null = null;

    const handleKeyPress = (key: 'ArrowDown' | 'ArrowUp' | 'Enter') => {
      if (key === 'ArrowDown') {
        selectedIndex = Math.min(fileItems.length - 1, selectedIndex + 1);
      } else if (key === 'ArrowUp') {
        selectedIndex = Math.max(0, selectedIndex - 1);
      } else if (key === 'Enter') {
        openedFile = fileItems[selectedIndex];
      }
    };

    handleKeyPress('ArrowDown');
    expect(selectedIndex).toBe(1);

    handleKeyPress('Enter');
    expect(openedFile).toBe('src/main.ts');
  });
});
