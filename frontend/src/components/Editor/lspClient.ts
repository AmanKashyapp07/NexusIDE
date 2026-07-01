// =============================================================================
// LIGHTWEIGHT LSP CLIENT ENGINE (JSON-RPC OVER WEBSOCKET)
// =============================================================================
//
// PURPOSE:
//   Connect the frontend Monaco Editor directly to the language server daemon running 
//   in the backend sandbox workspace via a raw browser WebSocket connection. Wires
//   native Monaco language provider extensions (Diagnostics, Auto-completions,
//   and Hovers) to provide IDE experiences without third-party libraries.
//
// ARCHITECTURE — NO-DEPS MULTIPLEXED JSON-RPC & EVENT DRAINER:
//   This client acts as a zero-dependency mediator between Monaco's pull-based provider
//   interfaces and LSP's stream-based push/pull notification model.
//
//   ┌────────────────────────┐         WebSocket         ┌────────────────────────┐
//   │   Monaco Code Editor   │ <───────────────────────> │  LSP Relay (Backend)   │
//   └───────────┬────────────┘                           └───────────┬────────────┘
//               │ Registers:                                         │ Relays to:
//               ├─ didChangeContent ──> didChange                    ├─ Pyright (Python)
//               ├─ HoverProvider ──> hover request                   └─ TSServer (TS/JS)
//               └─ CompletionProvider ──> completion
//
// WHY RAW JSON-RPC & WEBSOCKETS INSTEAD OF monaco-languageclient?
//   - Bundler Compatibility: monaco-languageclient (especially v8+) relies heavily on 
//     @codingame/monaco-vscode-api. This library registers VS Code services globally, 
//     conflicting with @monaco-editor/react's standalone Monaco loader instances.
//   - Overhead: Standard libraries introduce hundreds of internal modules and dependency 
//     bloat. A raw WebSocket client compiles to <5KB of ES modules.
//   - Custom framing: LSP uses Content-Length headers over TCP streams. Our custom WebSocket 
//     relay forwards this byte-for-byte. The parser (drainBuffer) runs a low-overhead 
//     streaming parser in the browser.
//
// LANGUAGE SERVER PROTOCOL (LSP) WIRE STRUCTURE:
//   LSP payloads are framed using headers similar to HTTP:
//     Content-Length: 123\r\n\r\n{"jsonrpc":"2.0",...}
//   Our drainBuffer() accumulates chunks, searches for headers, slices buffers, and parses
//   the raw JSON payloads cleanly without dropping partial messages.
//
// =============================================================================



// ─── LSP Severity → Monaco Severity Translator ───────────────────────────────
// Maps LSP severity integers to Monaco Editor's marker severity enums.
// Language Servers return:
//   1 = Error, 2 = Warning, 3 = Information, 4 = Hint
// Monaco maps these directly to display squiggle lines under errors/warnings.
const lspSeverityToMonaco = (monacoApi: any, severity: number): number => {
  switch (severity) {
    case 1: return monacoApi.MarkerSeverity.Error;
    case 2: return monacoApi.MarkerSeverity.Warning;
    case 3: return monacoApi.MarkerSeverity.Info;
    default: return monacoApi.MarkerSeverity.Hint;
  }
};

const lspKindToMonaco = (monacoApi: any, kind: number): number => {
  const K = monacoApi.languages.CompletionItemKind;
  const map: Record<number, number> = {
    1: K.Text, 2: K.Method, 3: K.Function, 4: K.Constructor,
    5: K.Field, 6: K.Variable, 7: K.Class, 8: K.Interface,
    9: K.Module, 10: K.Property, 11: K.Unit, 12: K.Value,
    13: K.Enum, 14: K.Keyword, 15: K.Snippet, 16: K.Color,
    17: K.File, 18: K.Reference, 19: K.Folder, 20: K.EnumMember,
    21: K.Constant, 22: K.Struct, 23: K.Event, 24: K.Operator,
    25: K.TypeParameter,
  };
  return map[kind] ?? K.Text;
};

// ─── Browser-Safe UTF-8 Byte Length Calculator ────────────────────────────────
// Why TextEncoder instead of string.length?
// JavaScript strings are UTF-16, so string.length returns the number of 16-bit
// code units. LSP Content-Length expects the raw byte length of the UTF-8 encoded
// string. E.g., emoji or accented characters take >1 byte. TextEncoder converts
// to standard UTF-8 bytes to ensure correct header length calculation.
function utf8ByteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

// =============================================================================
// LSP CLIENT CLASS IMPLEMENTATION
// =============================================================================
export class LspClient {
  private ws: WebSocket;
  private nextId = 1;
  private pendingRequests = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private initialized = false;
  private disposed = false;
  private disposables: { dispose(): void }[] = [];
  private editor: any;
  private monacoApi: any; // The monaco instance from @monaco-editor/react onMount
  private language: string;
  private filePath: string;
  private documentVersion = 1;
  private messageQueue: string[] = [];
  private incomingBytes = new Uint8Array(0);

  private appendBytes(newBytes: Uint8Array): void {
    const combined = new Uint8Array(this.incomingBytes.length + newBytes.length);
    combined.set(this.incomingBytes);
    combined.set(newBytes, this.incomingBytes.length);
    this.incomingBytes = combined;
  }

  constructor(
    wsUrl: string,
    editor: any,
    monacoApi: any,
    language: string,
    filePath: string,
  ) {
    this.editor = editor;
    this.monacoApi = monacoApi;
    this.language = language;
    this.filePath = filePath;
    this.ws = new WebSocket(wsUrl);
    
    // Initialize standard binary mode. The LSP wire protocol consists of UTF-8 strings,
    // but receiving as ArrayBuffer prevents some browsers from corrupting raw binary bytes.
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      console.log('[LSP] WebSocket connected');
      // Flush any messages buffered while the connection was opening
      this.messageQueue.forEach(msg => this.ws.send(msg));
      this.messageQueue = [];
      this.initialize();
    };

    this.ws.onmessage = (event) => {
      let bytes: Uint8Array;
      if (event.data instanceof ArrayBuffer) {
        bytes = new Uint8Array(event.data);
      } else {
        bytes = new TextEncoder().encode(event.data as string);
      }
      this.appendBytes(bytes);
      this.drainBuffer();
    };

    this.ws.onerror = () => {
      console.warn('[LSP] WebSocket error — LSP disabled for this session');
    };

    this.ws.onclose = (e) => {
      console.log(`[LSP] WebSocket closed: code=${e.code} reason=${e.reason || 'none'}`);
      // Fail all pending async requests immediately to clean up editor await blocks
      this.pendingRequests.forEach(({ reject }) => reject(new Error('LSP disconnected')));
      this.pendingRequests.clear();
      // 4401 means the backend rejected our JWT token. This happens when:
      //   1. The token in localStorage was signed with a different JWT_SECRET than the
      //      one currently loaded by the server (e.g. server restarted with new .env).
      //   2. The token has expired (7d TTL).
      // Solution: log out and log back in to get a fresh token.
      if (e.code === 4401) {
        console.error('[LSP] Authentication failed (4401). Your session token is invalid or expired. Please log out and log back in.');
      }
    };
  }

  // ─── JSON-RPC Framing & WebSocket Sender ───────────────────────────────────
  // Stringifies the JSON payload, calculates its UTF-8 byte length, appends the
  // Content-Length header, and sends it down the WebSocket channel. If the socket
  // is still connecting, buffers the message for execution on transition to OPEN.
  private sendRaw(msg: object): void {
    const body = JSON.stringify(msg);
    const byteLen = utf8ByteLength(body);
    const framed = `Content-Length: ${byteLen}\r\n\r\n${body}`;

    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(framed);
    } else {
      this.messageQueue.push(framed);
    }
  }

  // ─── Async Request Helper (Promise-Wrapped JSON-RPC) ───────────────────────
  // Sends an outbound JSON-RPC request and registers a timeout-backed Promise.
  // The Promise resolves when dispatchMessage receives a response matching the request's ID.
  //
  // Why 10 Seconds?
  //   Matches the backend sandbox timeout. If the LSP server hangs, we must free 
  //   the client promise to prevent memory leaks in the React application.
  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    this.sendRaw({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      
      // Safety timeout to avoid lingering or dangling pending promises
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`LSP request "${method}" timed out`));
        }
      }, 10_000);
    });
  }

  private notify(method: string, params: unknown): void {
    this.sendRaw({ jsonrpc: '2.0', method, params });
  }

  // ─── Streaming Byte Parser (LSP Content-Length Decoder) ────────────────────
  // LSP is a streaming protocol. WebSocket packets may arrive chunked or combined
  // (e.g. multiple messages packed into one WebSocket frame, or a single message 
  // split across multiple frames).
  //
  // This state machine processes the incoming buffer:
  //   1. Search for headers separator (\r\n\r\n).
  //   2. Extract Content-Length. If missing/invalid, clear buffer to self-heal.
  //   3. Check if the remaining buffer holds the full body payload.
  //   4. Slice body, advance the buffer window, and dispatch parsed JSON.
  //   5. Repeat until the buffer no longer holds a complete framed message.
  private drainBuffer(): void {
    const decoder = new TextDecoder();
    while (true) {
      if (this.incomingBytes.length === 0) break;

      // Decode up to the first 4096 bytes to find headers (guaranteed to be ASCII)
      const maxHeaderSearch = Math.min(this.incomingBytes.length, 4096);
      const searchBuffer = this.incomingBytes.subarray(0, maxHeaderSearch);
      const searchStr = decoder.decode(searchBuffer);

      const headerEnd = searchStr.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        // Self-heal: clear buffer if it contains too much data without any header
        if (this.incomingBytes.length > 8192) {
          this.incomingBytes = new Uint8Array(0);
        }
        break;
      }

      // Headers are pure ASCII, so character index is identical to byte index
      const headerSection = searchStr.slice(0, headerEnd);
      const lenMatch = headerSection.match(/Content-Length:\s*(\d+)/i);
      if (!lenMatch) {
        // Malformed header, clear the buffer to self-heal
        this.incomingBytes = new Uint8Array(0);
        break;
      }

      const bodyLen = parseInt(lenMatch[1], 10);
      const bodyStart = headerEnd + 4;

      // Wait for complete message payload (in bytes) to buffer before processing
      if (this.incomingBytes.length < bodyStart + bodyLen) break;

      const bodyBytes = this.incomingBytes.subarray(bodyStart, bodyStart + bodyLen);
      this.incomingBytes = this.incomingBytes.slice(bodyStart + bodyLen);

      try {
        const bodyStr = decoder.decode(bodyBytes);
        const msg = JSON.parse(bodyStr);
        this.dispatchMessage(msg);
      } catch (e) {
        console.warn('[LSP] Failed to parse JSON body:', e);
      }
    }
  }

  // ─── Inbound Msg Dispatcher ────────────────────────────────────────────────
  // Routes received JSON-RPC packets. Matches response IDs to pending request
  // Promises, and forwards push notifications (e.g. textDocument/publishDiagnostics)
  // to their corresponding model update handlers.
  private dispatchMessage(msg: any): void {
    // Check if packet is a response to an active request ID
    if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
      const { resolve, reject } = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);
      if (msg.error) {
        reject(new Error(msg.error.message));
      } else {
        resolve(msg.result);
      }
      return;
    }

    // Server → client notification
    if (msg.method === 'textDocument/publishDiagnostics') {
      this.handleDiagnostics(msg.params);
    }
  }

  // ─── LSP Initialize Handshake ──────────────────────────────────────────────
  // Executes the mandatory three-way handshake:
  //   1. Client sends 'initialize' request with capacities (Snippets, Markdown, Hover support)
  //   2. Server returns capabilities (what providers it supports)
  //   3. Client registers providers locally and notifies 'initialized' to start synchronization
  private async initialize(): Promise<void> {
    if (this.disposed) return;
    try {
      await this.request('initialize', {
        processId: null,
        clientInfo: { name: 'NexusIDE', version: '1.0.0' },
        rootUri: 'file:///app',
        capabilities: {
          textDocument: {
            publishDiagnostics: { relatedInformation: true },
            completion: {
              completionItem: { snippetSupport: true },
            },
            hover: { contentFormat: ['plaintext', 'markdown'] },
          },
        },
        workspaceFolders: [{ uri: 'file:///app', name: 'workspace' }],
      });

      this.notify('initialized', {});
      this.initialized = true;
      console.log('[LSP] Ready');

      this.openDocument();
      this.registerProviders();

      // Forward content changes to LSP in real-time
      const changeDisposable = this.editor.getModel()?.onDidChangeContent(() => {
        this.syncDocument();
      });
      if (changeDisposable) this.disposables.push(changeDisposable);

    } catch (err) {
      if (!this.disposed) {
        console.warn('[LSP] Initialize failed (non-fatal):', err);
      }
    }
  }

  // ─── Document lifecycle ────────────────────────────────────────────────────
  private getDocUri(): string {
    if (this.filePath) {
      return `file:///app/${this.filePath}`;
    }
    const ext = this.language === 'python' ? 'py' : this.language === 'typescript' ? 'ts' : 'js';
    return `file:///app/main.${ext}`;
  }

  private openDocument(): void {
    this.notify('textDocument/didOpen', {
      textDocument: {
        uri: this.getDocUri(),
        languageId: this.language,
        version: this.documentVersion,
        text: this.editor.getValue(),
      },
    });
  }

  private syncDocument(): void {
    if (!this.initialized || this.disposed) return;
    this.documentVersion++;
    this.notify('textDocument/didChange', {
      textDocument: { uri: this.getDocUri(), version: this.documentVersion },
      contentChanges: [{ text: this.editor.getValue() }],
    });
  }

  // ─── Diagnostics Handler ───────────────────────────────────────────────────
  // Translates raw LSP textDocument/publishDiagnostics markers into Monaco's native
  // MarkerData objects and applies them via setModelMarkers. This is what overlays
  // compiler and syntax squigglies onto the editor screen.
  private handleDiagnostics(params: { uri: string; diagnostics: any[] }): void {
    const model = this.editor.getModel();
    if (!model || this.disposed) return;

    const markers = (params.diagnostics ?? []).map((d: any) => ({
      severity: lspSeverityToMonaco(this.monacoApi, d.severity ?? 1),
      message: d.message,
      startLineNumber: (d.range?.start?.line ?? 0) + 1,
      startColumn: (d.range?.start?.character ?? 0) + 1,
      endLineNumber: (d.range?.end?.line ?? 0) + 1,
      endColumn: Math.max((d.range?.end?.character ?? 0) + 1, (d.range?.start?.character ?? 0) + 2),
      source: d.source ?? 'lsp',
    }));

    console.log('[LSP] Applying', markers.length, 'diagnostic markers');
    this.monacoApi.editor.setModelMarkers(model, 'lsp', markers);
  }

  // ─── Monaco Provider Registration ──────────────────────────────────────────
  // Plugs into Monaco's global registries to hook Hover and Completion providers.
  // These providers intercept user events (like hovering or typing a trigger character)
  // and translate them to async JSON-RPC requests, returning the results to Monaco.
  private registerProviders(): void {
    // -------------------------------------------------------------------------
    // STEP 1: Register Auto-Complete CompletionItemProvider
    // -------------------------------------------------------------------------
    const completionProvider = this.monacoApi.languages.registerCompletionItemProvider(this.language, {
      triggerCharacters: ['.', ':', '(', ' ', '"', "'"],
      provideCompletionItems: async (model: any, position: any) => {
        if (!this.initialized || this.disposed) return { suggestions: [] };
        try {
          const result: any = await this.request('textDocument/completion', {
            textDocument: { uri: this.getDocUri() },
            position: { line: position.lineNumber - 1, character: position.column - 1 },
          });

          const items: any[] = Array.isArray(result) ? result : result?.items ?? [];
          const word = model.getWordUntilPosition(position);
          const range = new this.monacoApi.Range(
            position.lineNumber, word.startColumn,
            position.lineNumber, word.endColumn,
          );

          return {
            suggestions: items.map((item: any) => ({
              label: item.label,
              kind: lspKindToMonaco(this.monacoApi, item.kind ?? 1),
              detail: item.detail ?? '',
              documentation: item.documentation
                ? (typeof item.documentation === 'string'
                    ? item.documentation
                    : item.documentation.value)
                : undefined,
              insertText: item.insertText ?? item.label,
              insertTextRules: item.insertTextFormat === 2
                ? this.monacoApi.languages.CompletionItemInsertTextRule.InsertAsSnippet
                : undefined,
              range,
            })),
          };
        } catch {
          return { suggestions: [] };
        }
      },
    });
    this.disposables.push(completionProvider);

    // -------------------------------------------------------------------------
    // STEP 2: Register Hover Info HoverProvider
    // -------------------------------------------------------------------------
    const hoverProvider = this.monacoApi.languages.registerHoverProvider(this.language, {
      provideHover: async (_model: any, position: any) => {
        if (!this.initialized || this.disposed) return null;
        try {
          const result: any = await this.request('textDocument/hover', {
            textDocument: { uri: this.getDocUri() },
            position: { line: position.lineNumber - 1, character: position.column - 1 },
          });

          if (!result?.contents) return null;

          let value: string;
          if (typeof result.contents === 'string') {
            value = result.contents;
          } else if (Array.isArray(result.contents)) {
            value = result.contents.map((c: any) => (typeof c === 'string' ? c : c.value ?? '')).join('\n\n');
          } else {
            value = result.contents.value ?? '';
          }

          return { contents: [{ value }] };
        } catch {
          return null;
        }
      },
    });
    this.disposables.push(hoverProvider);
  }

  // ─── Lifecycle Teardown & Resource Disposal ────────────────────────────────
  // Gracefully shuts down connection channels, notifies the LSP language server
  // of document closure and termination, and unregisters all Monaco providers
  // to avoid memory leaks or duplicate event handlers.
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.initialized) {
      try {
        // Send LSP exit signals
        this.notify('textDocument/didClose', { textDocument: { uri: this.getDocUri() } });
        this.notify('exit', {});
      } catch (_) { /* ignore */ }
    }

    const model = this.editor.getModel();
    if (model) {
      this.monacoApi.editor.setModelMarkers(model, 'lsp', []);
    }

    this.disposables.forEach(d => { try { d.dispose(); } catch (_) { /* ignore */ } });
    this.disposables = [];

    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
  }
}
