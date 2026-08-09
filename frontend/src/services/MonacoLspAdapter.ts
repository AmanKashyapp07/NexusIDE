import type * as Monaco from 'monaco-editor';
import type { LspService } from './LspService';
import { mapLspDiagnosticsToMonacoMarkers } from '../mappers/lspMapper';

export function registerDiagnosticsHandler(
  monacoInstance: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor,
  lspService: LspService,
  filename: string
): () => void {
  const unsubscribe = lspService.onDiagnostics((params: any) => {
    if (!params?.uri?.endsWith(filename)) return;
    const model = editor.getModel();
    if (!model) return;
    const markers = mapLspDiagnosticsToMonacoMarkers(params.diagnostics, monacoInstance);
    monacoInstance.editor.setModelMarkers(model, 'lsp', markers);
  });

  return () => {
    unsubscribe();
    const model = editor.getModel();
    if (model) monacoInstance.editor.setModelMarkers(model, 'lsp', []);
  };
}

export function registerHoverProvider(
  monacoInstance: typeof Monaco,
  language: string,
  fileUri: string,
  filename: string,
  lspService: LspService
): Monaco.IDisposable {
  return monacoInstance.languages.registerHoverProvider(language, {
    provideHover: async (model, position) => {
      if (!lspService.isInitialized || model.uri.path !== `/${filename}`) return null;
      try {
        const result = await lspService.request('textDocument/hover', {
          textDocument: { uri: fileUri },
          position: { line: position.lineNumber - 1, character: position.column - 1 },
        });
        if (!result?.contents) return null;
        const contents = Array.isArray(result.contents) ? result.contents : [result.contents];
        const value = contents
          .map((c: any) => (typeof c === 'string' ? c : c.value ?? ''))
          .filter(Boolean)
          .join('\n\n');
        if (!value) return null;
        return { contents: [{ value }] };
      } catch { return null; }
    },
  });
}

export function registerCompletionProvider(
  monacoInstance: typeof Monaco,
  language: string,
  fileUri: string,
  filename: string,
  lspService: LspService
): Monaco.IDisposable {
  return monacoInstance.languages.registerCompletionItemProvider(language, {
    triggerCharacters: ['.', ':', '"', "'", '/', '@', '<'],
    provideCompletionItems: async (model, position, context) => {
      if (!lspService.isInitialized || model.uri.path !== `/${filename}`) return null;
      try {
        const result = await lspService.request('textDocument/completion', {
          textDocument: { uri: fileUri },
          position: { line: position.lineNumber - 1, character: position.column - 1 },
          context: {
            triggerKind: context.triggerKind,
            triggerCharacter: context.triggerCharacter,
          },
        });
        const items = Array.isArray(result) ? result : result?.items ?? [];
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber:   position.lineNumber,
          startColumn:     word.startColumn,
          endColumn:       word.endColumn,
        };
        return {
          suggestions: items.map((item: any) => ({
            label:           item.label,
            kind:            item.kind ?? monacoInstance.languages.CompletionItemKind.Text,
            detail:          item.detail,
            documentation:   item.documentation?.value ?? item.documentation,
            insertText:      item.textEdit?.newText ?? item.insertText ?? item.label,
            range,
            sortText:        item.sortText,
            filterText:      item.filterText,
            preselect:       item.preselect,
          })),
        };
      } catch { return null; }
    },
  });
}

export function registerSignatureHelpProvider(
  monacoInstance: typeof Monaco,
  language: string,
  fileUri: string,
  filename: string,
  lspService: LspService
): Monaco.IDisposable {
  return monacoInstance.languages.registerSignatureHelpProvider(language, {
    signatureHelpTriggerCharacters: ['(', ','],
    provideSignatureHelp: async (model, position) => {
      if (!lspService.isInitialized || model.uri.path !== `/${filename}`) return null;
      try {
        const result = await lspService.request('textDocument/signatureHelp', {
          textDocument: { uri: fileUri },
          position: { line: position.lineNumber - 1, character: position.column - 1 },
        });
        if (!result?.signatures?.length) return null;
        return {
          value: {
            signatures: result.signatures.map((s: any) => ({
              label:         s.label,
              documentation: s.documentation?.value ?? s.documentation,
              parameters:    (s.parameters ?? []).map((p: any) => ({
                label:         p.label,
                documentation: p.documentation?.value ?? p.documentation,
              })),
            })),
            activeSignature: result.activeSignature ?? 0,
            activeParameter: result.activeParameter ?? 0,
          },
          dispose: () => {},
        };
      } catch { return null; }
    },
  });
}

export function registerDocumentSync(
  editor: Monaco.editor.IStandaloneCodeEditor,
  lspService: LspService,
  fileUri: string,
  lspLang: string,
  docVersionRef: { current: number }
): Monaco.IDisposable | null {
  const model = editor.getModel();
  const currentText = model?.getValue() ?? '';
  lspService.notify('textDocument/didOpen', {
    textDocument: {
      uri: fileUri,
      languageId: lspLang,
      version: 1,
      text: currentText,
    },
  });

  return editor.getModel()?.onDidChangeContent(() => {
    if (!lspService.isInitialized) return;
    const text = editor.getModel()?.getValue() ?? '';
    lspService.notify('textDocument/didChange', {
      textDocument: { uri: fileUri, version: docVersionRef.current++ },
      contentChanges: [{ text }],
    });
  }) ?? null;
}
