// Languages the backend supports. Everything else gets no LSP.
export const LSP_LANGUAGE_MAP: Record<string, string> = {
  typescript:      'typescript',
  javascript:      'typescript', // tsserver handles JS too
  typescriptreact: 'typescript',
  javascriptreact: 'typescript',
  python:          'python',
};

// Map Monaco language IDs to LSP languageId strings
export const MONACO_TO_LSP_LANG: Record<string, string> = {
  typescript:      'typescript',
  javascript:      'javascript',
  typescriptreact: 'typescriptreact',
  javascriptreact: 'typescriptreact',
  python:          'python',
};
