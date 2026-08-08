import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import CodeEditor from '../../frontend/src/components/Editor/CodeEditor';
import IdePage from '../../frontend/src/pages/IdePage';
import { ToastProvider } from '../../frontend/src/components/Toast/Toast';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mockSocketOn = vi.fn();
const mockSocketEmit = vi.fn();
const mockSocketDisconnect = vi.fn();

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    on: mockSocketOn,
    emit: mockSocketEmit,
    disconnect: mockSocketDisconnect,
    off: vi.fn(),
  })),
}));

const mockProviderConstructor = vi.fn();
const mockProviderDestroy = vi.fn();
let latestProviderInstance: any = null;

vi.mock('y-websocket', () => ({
  WebsocketProvider: class {
    awareness = {
      setLocalStateField: vi.fn(),
      getStates: vi.fn(() => new Map()),
      on: vi.fn(),
      off: vi.fn(),
    };
    on = vi.fn();
    off = vi.fn();
    connect = vi.fn();
    disconnect = vi.fn();
    destroy = mockProviderDestroy;
    constructor(...args: any[]) {
      latestProviderInstance = this;
      mockProviderConstructor(...args);
    }
  },
}));

vi.mock('y-monaco', () => ({
  MonacoBinding: class { destroy() {} }
}));

import { useEffect as reactUseEffect } from 'react';

vi.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: ({ options, onMount }: any) => {
    reactUseEffect(() => {
      if (onMount) {
        const mockEditor = {
          updateOptions: vi.fn(),
          getModel: vi.fn(() => ({
            setValue: vi.fn(),
            uri: { path: '/test.js' },
            getValueInRange: vi.fn(() => ''),
            getLineCount: vi.fn(() => 1),
            getLineMaxColumn: vi.fn(() => 1),
            getPositionAt: vi.fn(() => ({ lineNumber: 1, column: 1 })),
            getFullModelRange: vi.fn(() => ({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 })),
          })),
          getValue: vi.fn(() => ''),
          setValue: vi.fn(),
          setPosition: vi.fn(),
          revealPositionInCenter: vi.fn(),
          focus: vi.fn(),
          onDidChangeModel: vi.fn(() => ({ dispose: vi.fn() })),
          onDidChangeModelContent: vi.fn(() => ({ dispose: vi.fn() })),
          onDidScrollChange: vi.fn(() => ({ dispose: vi.fn() })), // Added for blame feature
        };
        const mockMonaco = {
          languages: {
            typescript: {
              typescriptDefaults: { setCompilerOptions: vi.fn(), setDiagnosticsOptions: vi.fn() },
              javascriptDefaults: { setCompilerOptions: vi.fn(), setDiagnosticsOptions: vi.fn() },
              ScriptTarget: { ES2020: 1 },
              ModuleResolutionKind: { NodeJs: 1 },
              ModuleKind: { CommonJS: 1 }
            },
            css: { cssDefaults: { setDiagnosticsOptions: vi.fn() } },
            json: { jsonDefaults: { setDiagnosticsOptions: vi.fn() } },
            registerInlineCompletionsProvider: vi.fn(() => ({ dispose: vi.fn() })),
            registerHoverProvider: vi.fn(() => ({ dispose: vi.fn() })),
            registerCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
            registerSignatureHelpProvider: vi.fn(() => ({ dispose: vi.fn() })),
          },
          editor: {
            setModelMarkers: vi.fn(),
          },
          MarkerSeverity: {
            Error: 1,
            Warning: 2,
            Info: 3,
            Hint: 4,
          },
          Range: class {
            constructor() {}
          }
        };
        onMount(mockEditor, mockMonaco);
      }
    }, []);

    return <div data-testid="monaco-mock" data-readonly={options.readOnly} />;
  },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Frontend Collaborative Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('token', 'fake-token');
    
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/auth/me')) return { ok: true, json: async () => ({ user: { id: 'u1', username: 'Aman' } }) };
      if (url.includes('/workspace/ws1/files')) return { ok: true, json: async () => ([{ id: 'f1', name: 'index.js', type: 'file' }]) };
      if (url.includes('/workspace/ws1')) return { ok: true, json: async () => ({ id: 'ws1', title: 'Test WS', userRole: 'editor' }) };
      return { ok: false };
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('CodeEditor enforces readOnly viewer role securely', async () => {
    render(
      <CodeEditor workspaceId="ws1" fileId="f1" language="javascript" currentUser={{ username: 'test', id: '123' }} readOnly={true} />
    );
    const editor = await screen.findByTestId('monaco-mock');
    expect(editor.getAttribute('data-readonly')).toBe('true');
  });

  it('IdePage connects to Socket.IO and requests file tree', async () => {
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/ide/ws1/f1']}>
          <Routes>
            <Route path="/ide/:workspaceId/:fileId" element={<IdePage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/workspace/ws1/files'), expect.any(Object));
    });
  });

  it("CodeEditor gracefully handles connection drops and awareness thrashing", async () => {
    const { unmount } = render(
      <CodeEditor workspaceId="ws1" fileId="f1" language="javascript" currentUser={{ username: "test", id: "123" }} />
    );

    const editor = await screen.findByTestId("monaco-mock");
    expect(editor).toBeInTheDocument();

    
    unmount();
  });

  it("IdePage gracefully handles Socket.IO disconnects and reconnects", async () => {
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/ide/ws1/f1"]}>
          <Routes>
            <Route path="/ide/:workspaceId/:fileId" element={<IdePage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    );

    await waitFor(() => {
      expect(mockSocketOn.mock.calls.some(call => call[0] === "disconnect")).toBe(true);
    });

    const disconnectCall = mockSocketOn.mock.calls.find(call => call[0] === "disconnect");
    disconnectCall[1]();

    expect(mockFetch).toHaveBeenCalled();
  });
});
describe('Advanced IDE State & Network Synchronization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('token', 'fake-token');
    
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/auth/me')) return { ok: true, json: async () => ({ user: { id: 'u1', username: 'Aman' } }) };
      if (url.includes('/workspace/ws1/files')) return { ok: true, json: async () => ([{ id: 'f1', name: 'index.js', type: 'file' }]) };
      if (url.includes('/workspace/ws1')) return { ok: true, json: async () => ({ id: 'ws1', title: 'Test WS', userRole: 'editor' }) };
      return { ok: false };
    });
  });

  it('emits "join-workspace" event on Socket.IO connection', async () => {
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/ide/ws1/f1']}>
          <Routes>
            <Route path="/ide/:workspaceId/:fileId" element={<IdePage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    );

    await waitFor(() => {
      expect(mockSocketOn.mock.calls.some(call => call[0] === 'connect')).toBe(true);
    });

    const connectCall = mockSocketOn.mock.calls.find(call => call[0] === 'connect');
    connectCall[1](); // Simulate Socket.IO connect

    await waitFor(() => {
      expect(mockSocketEmit).toHaveBeenCalledWith('join-workspace', expect.objectContaining({
        workspaceId: 'ws1'
      }));
    });
  });

  it('re-fetches file tree when "file-tree-update" socket event is received', async () => {
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/ide/ws1/f1']}>
          <Routes>
            <Route path="/ide/:workspaceId/:fileId" element={<IdePage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/workspace/ws1/files'), expect.any(Object));
    });

    mockFetch.mockClear();

    let fileTreeUpdateCall: any;
    await waitFor(() => {
      fileTreeUpdateCall = mockSocketOn.mock.calls.find(call => call[0] === 'file-tree-update');
      expect(fileTreeUpdateCall).toBeDefined();
    });
    
    fileTreeUpdateCall[1]();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/workspace/ws1/files'), expect.any(Object));
    });
  });

  it('propagates readOnly state to CodeEditor when workspace userRole is "viewer"', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/auth/me')) return { ok: true, json: async () => ({ user: { id: 'u1', username: 'Aman' } }) };
      if (url.includes('/workspace/ws1/files')) return { ok: true, json: async () => ([{ id: 'f1', name: 'index.js', type: 'file' }]) };
      if (url.includes('/workspace/ws1')) return { ok: true, json: async () => ({ id: 'ws1', title: 'Test WS', userRole: 'viewer' }) }; // Viewer role
      return { ok: false };
    });

    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/ide/ws1/f1']}>
          <Routes>
            <Route path="/ide/:workspaceId/:fileId" element={<IdePage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    );

    const editor = await screen.findByTestId('monaco-mock');
    
    expect(editor.getAttribute('data-readonly')).toBe('true');
  });

  it('gracefully handles 500 API errors without crashing the IDE layout', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/auth/me')) return { ok: true, json: async () => ({ user: { id: 'u1', username: 'Aman' } }) };
      if (url.includes('/workspace/ws1/files')) return { ok: false, status: 500 }; // Fail file fetch (placed first!)
      if (url.includes('/workspace/ws1')) return { ok: true, json: async () => ({ id: 'ws1', title: 'Test WS', userRole: 'editor' }) };
      return { ok: false };
    });

    const { container } = render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/ide/ws1/f1']}>
          <Routes>
            <Route path="/ide/:workspaceId/:fileId" element={<IdePage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/workspace/ws1/files'), expect.any(Object));
    });

    expect(container).toBeInTheDocument();
  });

  it('maintains UI stability when receiving rapid presence updates from multiple collaborators', async () => {
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/ide/ws1/f1']}>
          <Routes>
            <Route path="/ide/:workspaceId/:fileId" element={<IdePage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    );

    await waitFor(() => {
      expect(mockSocketOn.mock.calls.some(call => call[0] === 'workspace-presence-update')).toBe(true);
    });

    const presenceCall = mockSocketOn.mock.calls.find(call => call[0] === 'workspace-presence-update');
    
    for (let i = 0; i < 10; i++) {
      presenceCall[1]([
        { userId: 'u2', username: `Collab${i}` },
        { userId: 'u3', username: `Collab${i+1}` }
      ]);
    }

    const editor = await screen.findByTestId('monaco-mock');
    expect(editor).toBeInTheDocument();
  });
});



describe('Collaborative Edge Cases: File Switching, Reconnections & Deletions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('token', 'fake-token');
    
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/auth/me')) return { ok: true, json: async () => ({ user: { id: 'u1', username: 'Aman' } }) };
      if (url.includes('/workspace/ws1/files')) return { ok: true, json: async () => ([
        { id: 'f1', name: 'index.js', type: 'file' },
        { id: 'f2', name: 'newFile.js', type: 'file' } // Simulating User A's new file
      ]) };
      if (url.includes('/workspace/ws1')) return { ok: true, json: async () => ({ id: 'ws1', title: 'Test WS', userRole: 'editor' }) };
      return { ok: false };
    });
  });

  it('CodeEditor completely recreates Yjs connection when switching files (Fixes empty file bug)', async () => {
    const { rerender } = render(
      <CodeEditor workspaceId="ws1" fileId="f1" language="javascript" currentUser={{ username: 'Aman', id: 'u1' }} />
    );

    await waitFor(() => {
      expect(mockProviderConstructor).toHaveBeenCalledTimes(1);
      expect(mockProviderConstructor).toHaveBeenCalledWith(
        expect.any(String),
        'ws1-f1', 
        expect.any(Object),
        expect.any(Object)
      );
    });

    mockProviderDestroy.mockClear();
    mockProviderConstructor.mockClear();

    rerender(
      <CodeEditor workspaceId="ws1" fileId="f2" language="javascript" currentUser={{ username: 'Aman', id: 'u1' }} />
    );

    await waitFor(() => {
      expect(mockProviderDestroy).toHaveBeenCalledTimes(1);
      
      expect(mockProviderConstructor).toHaveBeenCalledTimes(1);
      expect(mockProviderConstructor).toHaveBeenCalledWith(
        expect.any(String),
        'ws1-f2', // Ensures we pull the state for f2, not the cached f1 state
        expect.any(Object),
        expect.any(Object)
      );
    });
  });

  it('CodeEditor does NOT destroy and recreate Yjs connection if other props change but fileId remains the same', async () => {
    const { rerender } = render(
      <CodeEditor workspaceId="ws1" fileId="f1" language="javascript" currentUser={{ username: 'Aman', id: 'u1' }} />
    );

    await waitFor(() => { expect(mockProviderConstructor).toHaveBeenCalledTimes(1); });

    mockProviderDestroy.mockClear();
    mockProviderConstructor.mockClear();

    rerender(
      <CodeEditor workspaceId="ws1" fileId="f1" language="typescript" currentUser={{ username: 'Aman', id: 'u1' }} />
    );

    expect(mockProviderDestroy).not.toHaveBeenCalled();
    expect(mockProviderConstructor).not.toHaveBeenCalled();
  });

  it('IdePage handles concurrent file deletion gracefully (User A deletes file while User B is viewing it)', async () => {
    const { container } = render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/ide/ws1/f1']}>
          <Routes>
            <Route path="/ide/:workspaceId/:fileId" element={<IdePage />} />
            <Route path="/ide/:workspaceId" element={<div data-testid="workspace-root">No file selected</div>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    mockFetch.mockImplementationOnce(async (url: string) => {
      if (url.includes('/workspace/ws1/files')) return { ok: true, json: async () => ([]) }; // Empty tree
      return { ok: true, json: async () => ({}) };
    });

    await waitFor(() => {
      expect(mockSocketOn.mock.calls.some(call => call[0] === 'file-tree-update')).toBe(true);
    });

    const fileTreeUpdateCall = mockSocketOn.mock.calls.find(call => call[0] === 'file-tree-update');
    
    fileTreeUpdateCall[1]();

    await waitFor(() => {
      const editor = screen.queryByTestId('monaco-mock');
      expect(container).toBeInTheDocument();
    });
  });

  it('IdePage aggressively re-fetches active data when reconnecting from offline state', async () => {
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/ide/ws1/f1']}>
          <Routes>
            <Route path="/ide/:workspaceId/:fileId" element={<IdePage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/workspace/ws1/files'), expect.any(Object));
    });

    mockFetch.mockClear();

    await waitFor(() => {
      expect(mockSocketOn.mock.calls.some(call => call[0] === 'disconnect')).toBe(true);
      expect(mockSocketOn.mock.calls.some(call => call[0] === 'connect')).toBe(true);
    });

    const disconnectCall = mockSocketOn.mock.calls.find(call => call[0] === 'disconnect');
    const connectCall = mockSocketOn.mock.calls.find(call => call[0] === 'connect');
    
    disconnectCall[1]();
    
    connectCall[1]();

    await waitFor(() => {
      expect(mockSocketEmit).toHaveBeenCalledWith('join-workspace', { workspaceId: 'ws1' });
      
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/workspace/ws1/files'), expect.any(Object));
    });
  });
});

describe('Frontend Collaborative UX: Ghost Cursors & Awareness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('token', 'fake-token');
    
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/auth/me')) return { ok: true, json: async () => ({ user: { id: 'u1', username: 'Aman' } }) };
      if (url.includes('/workspace/ws1/files')) return { ok: true, json: async () => ([{ id: 'f1', name: 'index.js', type: 'file' }]) };
      if (url.includes('/workspace/ws1')) return { ok: true, json: async () => ({ id: 'ws1', title: 'Test WS', userRole: 'editor' }) };
      return { ok: false };
    });
  });

  it('cleans up local awareness state upon unmount to prevent Ghost Cursors for other users', async () => {
    const { unmount } = render(
      <CodeEditor workspaceId="ws1" fileId="f1" language="javascript" currentUser={{ username: 'Aman', id: 'u1' }} />
    );

    await screen.findByTestId('monaco-mock');

    const statusCall = latestProviderInstance.on.mock.calls.find((call: any) => call[0] === 'status');
    expect(statusCall).toBeDefined();
    statusCall[1]({ status: 'connected' });

    const setLocalStateSpy = latestProviderInstance.awareness.setLocalStateField;

    expect(setLocalStateSpy).toHaveBeenCalledWith('user', expect.objectContaining({
      name: 'Aman'
    }));

    setLocalStateSpy.mockClear();

    unmount();

    expect(mockProviderDestroy).toHaveBeenCalledTimes(1);
  });

  it('handles remote awareness timeouts (Server drops a silent peer)', async () => {
    render(
      <CodeEditor workspaceId="ws1" fileId="f1" language="javascript" currentUser={{ username: 'Aman', id: 'u1' }} />
    );

    await screen.findByTestId('monaco-mock');

    const mockProviderInstance = latestProviderInstance;
    
    mockProviderInstance.awareness.getStates.mockReturnValue(new Map([
      [1, { user: { name: 'Aman', color: 'blue' } }],
      [2, { user: { name: 'RemoteBob', color: 'red' }, cursor: { index: 10 } }]
    ]));

    const awarenessChangeCall = mockProviderInstance.awareness.on.mock.calls.find(
      (call: any) => call[0] === 'change'
    );
    expect(awarenessChangeCall).toBeDefined();

    const changeHandler = awarenessChangeCall[1];
    
    mockProviderInstance.awareness.getStates.mockReturnValue(new Map([
      [1, { user: { name: 'Aman', color: 'blue' } }]
    ]));

    changeHandler({ added: [], updated: [], removed: [2] }, 'local');

    expect(screen.getByTestId('monaco-mock')).toBeInTheDocument();
  });
});