import { wsUrl } from '../lib/backendUrls';

export type LspStatus = 'off' | 'connecting' | 'ready' | 'error';

export class LspService {
  private ws: WebSocket | null = null;
  private reqId = 1;
  private pending = new Map<number, { resolve: (r: any) => void; reject: (e: any) => void }>();
  private initialized = false;
  private status: LspStatus = 'off';
  private frameBuffer = '';
  
  private statusChangeCallbacks: Set<(status: LspStatus) => void> = new Set();
  private diagnosticsCallbacks: Set<(params: any) => void> = new Set();

  private readonly workspaceId: string;
  private readonly backendLang: string;
  private readonly fileUri: string;
  private readonly lspLang: string;
  private readonly token: string;

  constructor(
    workspaceId: string,
    backendLang: string,
    fileUri: string,
    lspLang: string,
    token: string
  ) {
    this.workspaceId = workspaceId;
    this.backendLang = backendLang;
    this.fileUri = fileUri;
    this.lspLang = lspLang;
    this.token = token;
  }

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsEndpoint = wsUrl(`/ws/lsp/${this.workspaceId}/${this.backendLang}?token=${encodeURIComponent(this.token)}`);
      this.ws = new WebSocket(wsEndpoint);
      this.ws.binaryType = 'arraybuffer';
      this.setStatus('connecting');

      this.ws.onmessage = (ev) => this.handleMessage(ev);
      this.ws.onerror = () => this.setStatus('error');
      this.ws.onclose = (ev) => {
        console.warn('[LspService]: WebSocket closed. Code:', ev.code, 'Reason:', ev.reason);
        if (ev.code !== 4403) this.setStatus('error');
        else this.setStatus('off');
      };

      this.ws.onopen = async () => {
        try {
          await this.request('initialize', {
            processId: null,
            clientInfo: { name: 'nexus-ide', version: '1.0' },
            rootUri: `file:///workspaces/${this.workspaceId}`,
            workspaceFolders: [{ uri: `file:///workspaces/${this.workspaceId}`, name: this.workspaceId }],
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

          this.notify('initialized', {});
          this.initialized = true;
          this.setStatus('ready');
          resolve();
        } catch (err) {
          this.setStatus('error');
          reject(err);
        }
      };
    });
  }

  public disconnect() {
    if (this.initialized && this.ws?.readyState === WebSocket.OPEN) {
      this.notify('textDocument/didClose', { textDocument: { uri: this.fileUri } });
    }
    this.initialized = false;

    this.pending.forEach(({ reject }) => reject(new Error('LSP session closed')));
    this.pending.clear();

    if (this.ws) {
      this.ws.onmessage = null;
      this.ws.onopen = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.setStatus('off');
  }

  public request(method: string, params: any): Promise<any> {
    const id = this.reqId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.sendRaw({ jsonrpc: '2.0', id, method, params });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`LSP request timeout: ${method}`));
        }
      }, 30000);
    });
  }

  public notify(method: string, params: any) {
    this.sendRaw({ jsonrpc: '2.0', method, params });
  }

  public get isInitialized() {
    return this.initialized;
  }

  public onStatusChange(cb: (status: LspStatus) => void) {
    this.statusChangeCallbacks.add(cb);
    cb(this.status);
    return () => this.statusChangeCallbacks.delete(cb);
  }

  public onDiagnostics(cb: (params: any) => void) {
    this.diagnosticsCallbacks.add(cb);
    return () => this.diagnosticsCallbacks.delete(cb);
  }

  private setStatus(s: LspStatus) {
    this.status = s;
    this.statusChangeCallbacks.forEach(cb => cb(s));
  }

  private sendRaw(obj: object) {
    const body = JSON.stringify(obj);
    const byteLength = new TextEncoder().encode(body).length;
    const frame = `Content-Length: ${byteLength}\r\n\r\n${body}`;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(frame);
    }
  }

  private handleMessage(ev: MessageEvent) {
    let raw: string;
    if (ev.data instanceof ArrayBuffer) {
      raw = new TextDecoder().decode(ev.data);
    } else if (typeof ev.data === 'string') {
      raw = ev.data;
    } else {
      return;
    }
    const msgs = this.parseFrames(raw);
    for (const msg of msgs) {
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      } else if (msg.method === 'textDocument/publishDiagnostics') {
        this.diagnosticsCallbacks.forEach(cb => cb(msg.params));
      }
    }
  }

  private parseFrames(raw: string): any[] {
    this.frameBuffer += raw;
    const messages: any[] = [];
    while (true) {
      const headerEnd = this.frameBuffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;
      const header = this.frameBuffer.slice(0, headerEnd);
      const lenMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!lenMatch) { this.frameBuffer = this.frameBuffer.slice(headerEnd + 4); continue; }
      const bodyLen = parseInt(lenMatch[1], 10);
      const bodyStart = headerEnd + 4;
      if (this.frameBuffer.length < bodyStart + bodyLen) break;
      const body = this.frameBuffer.slice(bodyStart, bodyStart + bodyLen);
      this.frameBuffer = this.frameBuffer.slice(bodyStart + bodyLen);
      try { messages.push(JSON.parse(body)); } catch {}
    }
    return messages;
  }
}
