import { useEffect, useRef } from 'react';
import type * as Monaco from 'monaco-editor';
import { LSP_LANGUAGE_MAP, MONACO_TO_LSP_LANG } from '../constants/lsp';
import { LspService, type LspStatus } from '../services/LspService';
import {
  registerDiagnosticsHandler,
  registerHoverProvider,
  registerCompletionProvider,
  registerSignatureHelpProvider,
  registerDocumentSync
} from '../services/MonacoLspAdapter';

export type { LspStatus };

interface UseLspClientOptions {
  workspaceId: string;
  fileId: string;
  filename: string;
  language: string;
  readOnly: boolean;
  editor: Monaco.editor.IStandaloneCodeEditor | null;
  monacoInstance: typeof Monaco | null;
  onStatusChange?: (status: LspStatus) => void;
}

export function useLspClient({
  workspaceId,
  fileId,
  filename,
  language,
  readOnly,
  editor,
  monacoInstance,
  onStatusChange,
}: UseLspClientOptions) {
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  useEffect(() => {
    const backendLang = LSP_LANGUAGE_MAP[language];
    if (!backendLang || !editor || !monacoInstance || readOnly) return;

    const fileUri = `file:///workspaces/${workspaceId}/${filename}`;
    const lspLang = MONACO_TO_LSP_LANG[language] ?? language;
    const token = localStorage.getItem('token') ?? '';

    const lspService = new LspService(workspaceId, backendLang, fileUri, lspLang, token);
    
    const unsubscribeStatus = lspService.onStatusChange((status) => {
      onStatusChangeRef.current?.(status);
    });

    const disposables: Monaco.IDisposable[] = [];
    const docVersionRef = { current: 2 };
    
    lspService.connect().then(() => {
      const syncDisposable = registerDocumentSync(editor, lspService, fileUri, lspLang, docVersionRef);
      if (syncDisposable) disposables.push(syncDisposable);
    }).catch(() => {});

    const removeDiagnostics = registerDiagnosticsHandler(monacoInstance, editor, lspService, filename);
    
    disposables.push(registerHoverProvider(monacoInstance, language, fileUri, filename, lspService));
    disposables.push(registerCompletionProvider(monacoInstance, language, fileUri, filename, lspService));
    disposables.push(registerSignatureHelpProvider(monacoInstance, language, fileUri, filename, lspService));

    return () => {
      unsubscribeStatus();
      removeDiagnostics();
      disposables.forEach(d => d.dispose());
      lspService.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, monacoInstance, workspaceId, fileId, filename, language, readOnly]);
}
