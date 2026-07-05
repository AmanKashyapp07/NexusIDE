import { useEffect, useRef, useCallback } from 'react';
import type * as Monaco from 'monaco-editor';
import { wsUrl } from '../lib/backendUrls';

// =============================================================================
// [ARCHITECTURE] Lightweight LSP JSON-RPC Client
//
// Rather than pulling in monaco-languageclient (which requires complex Vite
// shims for its vscode-api peer-deps), we speak the LSP wire protocol directly
// over a raw WebSocket. The protocol is straightforward:
//
//   Browser → Server (inside container):  JSON-RPC request/notification
//   Server  → Browser:                    JSON-RPC response/notification
//
// The LSP Content-Length framing is handled by the backend (lspHandler.ts)
// which demultiplexes Docker's 8-byte stream header before forwarding to us.
// We receive clean JSON strings and send clean JSON strings.
//
// Monaco providers (diagnostics, hover, completions, signature help) are
// registered per-language and delegate to this client. On file switch the
// entire effect re-runs: old providers are disposed, new ones registered.
// =============================================================================

export type LspStatus = 'off' | 'connecting' | 'ready' | 'error';

// Languages the backend supports. Everything else gets no LSP.
const LSP_LANGUAGE_MAP: Record<string, string> = {
  typescript:     'typescript',
  javascript:     'typescript', // tsserver handles JS too
  typescriptreact:'typescript',
  javascriptreact:'typescript',
  python:         'python',
};

// Map Monaco language IDs to LSP languageId strings
const MONACO_TO_LSP_LANG: Record<string, string> = {
  typescript:      'typescript',
  javascript:      'javascript',
  typescriptreact: 'typescriptreact',
  javascriptreact: 'javascriptreact',
  python:          'python',
};

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
  const wsRef = useRef<WebSocket | null>(null);
  const reqIdRef = useRef(1);
  // pending requests: id → { resolve, reject }
  const pendingRef = useRef<Map<number, { resolve: (r: any) => void; reject: (e: any) => void }>>(new Map());
  const initializedRef = useRef(false);
  const statusRef = useRef<LspStatus>('off');

  const setStatus = useCallback((s: LspStatus) => {
    statusRef.current = s;
    onStatusChange?.(s);
  }, [onStatusChange]);

  useEffect(() => {
    const backendLang = LSP_LANGUAGE_MAP[language];
    // Only start LSP for supported languages; viewers get nothing
    if (!backendLang || !editor || !monacoInstance || readOnly) return;

    // ── JSON-RPC helpers ────────────────────────────────────────────────────

    const sendRaw = (obj: object) => {
      const body = JSON.stringify(obj);
      // LSP wire protocol: Content-Length header + blank line + JSON body
      // The backend pipes this directly into the language server's stdin.
      const byteLength = new TextEncoder().encode(body).length;
      const frame = `Content-Length: ${byteLength}\r\n\r\n${body}`;
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(frame);
      }
    };

    const request = (method: string, params: any): Promise<any> => {
      const id = reqIdRef.current++;
      return new Promise((resolve, reject) => {
        pendingRef.current.set(id, { resolve, reject });
        sendRaw({ jsonrpc: '2.0', id, method, params });
        // 30s timeout per request to avoid hanging on unresponsive LSP under test load
        setTimeout(() => {
          if (pendingRef.current.has(id)) {
            pendingRef.current.delete(id);
            reject(new Error(`LSP request timeout: ${method}`));
          }
        }, 30000);
      });
    };

    const notify = (method: string, params: any) => {
      sendRaw({ jsonrpc: '2.0', method, params });
    };

    // ── Dispose registry — collect everything to clean up on unmount ───────

    const disposables: Monaco.IDisposable[] = [];

    // ── Build the file URI the language server will use ──────────────────
    // Files live at /workspaces/{workspaceId}/{filename} inside the container.
    const fileUri = `file:///workspaces/${workspaceId}/${filename}`;
    const lspLang = MONACO_TO_LSP_LANG[language] ?? language;

    // ── Open WebSocket ───────────────────────────────────────────────────
    const token = localStorage.getItem('token') ?? '';
    const wsEndpoint = wsUrl(`/ws/lsp/${workspaceId}/${backendLang}?token=${encodeURIComponent(token)}`);
    const ws = new WebSocket(wsEndpoint);
    ws.binaryType = 'arraybuffer'; // Backend sends Buffer payloads — receive as ArrayBuffer
    wsRef.current = ws;
    setStatus('connecting');

    // ── LSP message handler ─────────────────────────────────────────────

    // The backend demultiplexes the Docker 8-byte header and sends us raw
    // LSP Content-Length frames as text. We need to parse those frames.
    let frameBuffer = '';

    const parseFrames = (raw: string): any[] => {
      frameBuffer += raw;
      const messages: any[] = [];
      while (true) {
        const headerEnd = frameBuffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) break;
        const header = frameBuffer.slice(0, headerEnd);
        const lenMatch = header.match(/Content-Length:\s*(\d+)/i);
        if (!lenMatch) { frameBuffer = frameBuffer.slice(headerEnd + 4); continue; }
        const bodyLen = parseInt(lenMatch[1], 10);
        const bodyStart = headerEnd + 4;
        if (frameBuffer.length < bodyStart + bodyLen) break;
        const body = frameBuffer.slice(bodyStart, bodyStart + bodyLen);
        frameBuffer = frameBuffer.slice(bodyStart + bodyLen);
        try { messages.push(JSON.parse(body)); } catch {}
      }
      return messages;
    };

    ws.onmessage = (ev) => {
      // Data arrives as ArrayBuffer (binary from backend). Decode to string.
      let raw: string;
      if (ev.data instanceof ArrayBuffer) {
        raw = new TextDecoder().decode(ev.data);
      } else if (typeof ev.data === 'string') {
        raw = ev.data;
      } else {
        return; // Blob or unexpected type — skip
      }
      const msgs = parseFrames(raw);
      for (const msg of msgs) {
        if (msg.id !== undefined && pendingRef.current.has(msg.id)) {
          // Response to our request
          const { resolve, reject } = pendingRef.current.get(msg.id)!;
          pendingRef.current.delete(msg.id);
          if (msg.error) reject(msg.error);
          else resolve(msg.result);
        } else if (msg.method === 'textDocument/publishDiagnostics') {
          // Server push: diagnostics for a file
          handleDiagnostics(msg.params);
        }
        // Other notifications (window/logMessage etc.) are silently ignored
      }
    };

    ws.onerror = () => setStatus('error');
    ws.onclose = (ev) => {
      console.warn('[LSP Client Close]: WebSocket closed. Code:', ev.code, 'Reason:', ev.reason);
      // 4403 = viewer RBAC rejection — silent, expected
      if (ev.code !== 4403) setStatus('error');
      else setStatus('off');
    };

    // ── LSP Initialize → didOpen sequence ───────────────────────────────

    ws.onopen = async () => {
      try {
        await request('initialize', {
          processId: null,
          clientInfo: { name: 'nexus-ide', version: '1.0' },
          rootUri: `file:///workspaces/${workspaceId}`,
          workspaceFolders: [{ uri: `file:///workspaces/${workspaceId}`, name: workspaceId }],
          capabilities: {
            textDocument: {
              synchronization: { dynamicRegistration: false, didSave: false, willSave: false },
              completion: {
                completionItem: {
                  snippetSupport: false,
                  documentationFormat: ['plaintext'],
                  resolveSupport: { properties: ['detail', 'documentation'] },
                },
                contextSupport: true,
              },
              hover: { contentFormat: ['markdown', 'plaintext'] },
              signatureHelp: { signatureInformation: { documentationFormat: ['markdown', 'plaintext'] } },
              publishDiagnostics: { relatedInformation: true },
            },
            workspace: { workspaceFolders: true },
          },
        });

        notify('initialized', {});
        initializedRef.current = true;
        setStatus('ready');

        // Notify the LSP about the currently open file
        const model = editor.getModel();
        const currentText = model?.getValue() ?? '';
        notify('textDocument/didOpen', {
          textDocument: {
            uri: fileUri,
            languageId: lspLang,
            version: 1,
            text: currentText,
          },
        });

        // Keep the LSP in sync as the document changes (via Yjs updates)
        let docVersion = 2;
        const modelListener = editor.getModel()?.onDidChangeContent(() => {
          if (!initializedRef.current) return;
          const text = editor.getModel()?.getValue() ?? '';
          notify('textDocument/didChange', {
            textDocument: { uri: fileUri, version: docVersion++ },
            contentChanges: [{ text }],
          });
        });
        if (modelListener) disposables.push(modelListener);

      } catch (err) {
        setStatus('error');
      }
    };

    // ── Diagnostics → Monaco markers ────────────────────────────────────

    const handleDiagnostics = (params: any) => {
      if (!params?.uri?.endsWith(filename)) return;
      const model = editor.getModel();
      if (!model) return;

      const markers: Monaco.editor.IMarkerData[] = (params.diagnostics ?? []).map((d: any) => ({
        startLineNumber: (d.range?.start?.line ?? 0) + 1,
        startColumn:     (d.range?.start?.character ?? 0) + 1,
        endLineNumber:   (d.range?.end?.line ?? 0) + 1,
        endColumn:       (d.range?.end?.character ?? 0) + 1,
        message:         d.message ?? '',
        severity: ({
          1: monacoInstance.MarkerSeverity.Error,
          2: monacoInstance.MarkerSeverity.Warning,
          3: monacoInstance.MarkerSeverity.Info,
          4: monacoInstance.MarkerSeverity.Hint,
        } as any)[d.severity] ?? monacoInstance.MarkerSeverity.Error,
        source: d.source ?? 'lsp',
        code: d.code != null ? String(d.code) : undefined,
      }));

      monacoInstance.editor.setModelMarkers(model, 'lsp', markers);
    };

    // ── Hover provider ───────────────────────────────────────────────────

    const hoverProvider = monacoInstance.languages.registerHoverProvider(language, {
      provideHover: async (model, position) => {
        if (!initializedRef.current || model.uri.path !== `/${filename}`) return null;
        try {
          const result = await request('textDocument/hover', {
            textDocument: { uri: fileUri },
            position: { line: position.lineNumber - 1, character: position.column - 1 },
          });
          if (!result?.contents) return null;
          const contents = Array.isArray(result.contents)
            ? result.contents
            : [result.contents];
          const value = contents
            .map((c: any) => (typeof c === 'string' ? c : c.value ?? ''))
            .filter(Boolean)
            .join('\n\n');
          if (!value) return null;
          return { contents: [{ value }] };
        } catch { return null; }
      },
    });
    disposables.push(hoverProvider);

    // ── Completion provider ──────────────────────────────────────────────

    const completionProvider = monacoInstance.languages.registerCompletionItemProvider(language, {
      triggerCharacters: ['.', ':', '"', "'", '/', '@', '<'],
      provideCompletionItems: async (model, position, context) => {
        if (!initializedRef.current || model.uri.path !== `/${filename}`) return null;
        try {
          const result = await request('textDocument/completion', {
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
    disposables.push(completionProvider);

    // ── Signature help provider ──────────────────────────────────────────

    const signatureProvider = monacoInstance.languages.registerSignatureHelpProvider(language, {
      signatureHelpTriggerCharacters: ['(', ','],
      provideSignatureHelp: async (model, position) => {
        if (!initializedRef.current || model.uri.path !== `/${filename}`) return null;
        try {
          const result = await request('textDocument/signatureHelp', {
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
    disposables.push(signatureProvider);

    // ── Cleanup ──────────────────────────────────────────────────────────

    return () => {
      // Close the document gracefully
      if (initializedRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
        notify('textDocument/didClose', { textDocument: { uri: fileUri } });
      }
      initializedRef.current = false;

      // Clear markers left by this session
      const model = editor.getModel();
      if (model) monacoInstance.editor.setModelMarkers(model, 'lsp', []);

      disposables.forEach(d => d.dispose());
      pendingRef.current.forEach(({ reject }) => reject(new Error('LSP session closed')));
      pendingRef.current.clear();

      if (wsRef.current) {
        wsRef.current.onmessage = null;
        wsRef.current.onopen = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }

      setStatus('off');
    };
  // Re-run when the file, language, or editor instance changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, monacoInstance, workspaceId, fileId, filename, language, readOnly]);
}
