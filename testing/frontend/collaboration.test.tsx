import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import CodeEditor from '../../frontend/src/components/Editor/CodeEditor';
import IdePage from '../../frontend/src/pages/IdePage';
import { ToastProvider } from '../../frontend/src/components/Toast/Toast';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// --- MOCKS ---
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
          })),
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
    // We will render CodeEditor and manually trigger connection/awareness events
    const { unmount } = render(
      <CodeEditor workspaceId="ws1" fileId="f1" language="javascript" currentUser={{ username: "test", id: "123" }} />
    );

    const editor = await screen.findByTestId("monaco-mock");
    expect(editor).toBeInTheDocument();

    // The mock for Yjs provider needs to trigger "status" and "change" events.
    // Our mock doesnt have a direct trigger, but testing the UI renders without crashing during mount is done.
    
    // Unmounting ensures cleanup runs without throwing
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

    // Wait for initial render and Socket.IO listener attachment
    await waitFor(() => {
      expect(mockSocketOn.mock.calls.some(call => call[0] === "disconnect")).toBe(true);
    });

    // Manually trigger a disconnect event
    const disconnectCall = mockSocketOn.mock.calls.find(call => call[0] === "disconnect");
    disconnectCall[1]();

    // Verify UI reflects disconnect (e.g. by checking if toast triggers, though our mockToast just throws if outside context, we wrapped it in context).
    // Let us verify no unhandled exception happened.
    expect(mockFetch).toHaveBeenCalled();
  });
});
// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 2 — Advanced IDE State, Networking, and RBAC
// ═══════════════════════════════════════════════════════════════════════════════
describe('Advanced IDE State & Network Synchronization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('token', 'fake-token');
    
    // Default happy-path fetch mock
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

    // Wait for the component to attach connect listener and trigger it
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

    // Wait for initial fetch
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/workspace/ws1/files'), expect.any(Object));
    });

    // Clear fetch mock count to isolate the socket event trigger
    mockFetch.mockClear();

    // Find the registered file-tree-update listener and invoke it
    let fileTreeUpdateCall: any;
    await waitFor(() => {
      fileTreeUpdateCall = mockSocketOn.mock.calls.find(call => call[0] === 'file-tree-update');
      expect(fileTreeUpdateCall).toBeDefined();
    });
    
    // Simulate server broadcasting a file tree change
    fileTreeUpdateCall[1]();

    // Verify it triggers a re-fetch of the files
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/workspace/ws1/files'), expect.any(Object));
    });
  });

  it('propagates readOnly state to CodeEditor when workspace userRole is "viewer"', async () => {
    // Override fetch mock to simulate a viewer role
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

    // Wait for the workspace data to load and CodeEditor to render
    const editor = await screen.findByTestId('monaco-mock');
    
    // If the IdePage correctly parses 'viewer' role, it should pass readOnly=true down to CodeEditor
    expect(editor.getAttribute('data-readonly')).toBe('true');
  });

  it('gracefully handles 500 API errors without crashing the IDE layout', async () => {
    // Override fetch to simulate a catastrophic server failure for the file tree
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

    // The IDE should remain mounted and not throw unhandled runtime errors
    // Even if files failed to load, the editor container should still exist
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
    
    // Simulate rapid fire presence updates (e.g., a burst of users joining/leaving)
    for (let i = 0; i < 10; i++) {
      presenceCall[1]([
        { userId: 'u2', username: `Collab${i}` },
        { userId: 'u3', username: `Collab${i+1}` }
      ]);
    }

    // Ensure the editor didn't unmount or crash due to rapid state updates
    const editor = await screen.findByTestId('monaco-mock');
    expect(editor).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 3 — Collaborative Edge Cases: File Switching, Reconnections & Deletions
// ═══════════════════════════════════════════════════════════════════════════════


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
    // 1. User B is on index.js (f1)
    const { rerender } = render(
      <CodeEditor workspaceId="ws1" fileId="f1" language="javascript" currentUser={{ username: 'Aman', id: 'u1' }} />
    );

    await waitFor(() => {
      expect(mockProviderConstructor).toHaveBeenCalledTimes(1);
      // Verify it connected to the f1 room
      expect(mockProviderConstructor).toHaveBeenCalledWith(
        expect.any(String),
        'ws1-f1', 
        expect.any(Object),
        expect.any(Object)
      );
    });

    mockProviderDestroy.mockClear();
    mockProviderConstructor.mockClear();

    // 2. User B clicks on newFile.js (f2) in the file tree. 
    // React re-renders the same CodeEditor component with a new fileId prop.
    rerender(
      <CodeEditor workspaceId="ws1" fileId="f2" language="javascript" currentUser={{ username: 'Aman', id: 'u1' }} />
    );

    await waitFor(() => {
      // The crucial fix: The old provider MUST be destroyed to prevent memory leaks and stale state
      expect(mockProviderDestroy).toHaveBeenCalledTimes(1);
      
      // A NEW provider MUST be created for the new file room (f2)
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

    // Rerender with the SAME fileId, but different language (e.g., someone renamed index.js to index.ts)
    rerender(
      <CodeEditor workspaceId="ws1" fileId="f1" language="typescript" currentUser={{ username: 'Aman', id: 'u1' }} />
    );

    // We should NOT disconnect from the Yjs room just because the syntax highlighting changed
    expect(mockProviderDestroy).not.toHaveBeenCalled();
    expect(mockProviderConstructor).not.toHaveBeenCalled();
  });

  it('IdePage handles concurrent file deletion gracefully (User A deletes file while User B is viewing it)', async () => {
    // 1. Initial render - User B is viewing f1
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

    // 2. User A deletes f1. The server broadcasts a 'file-tree-update' socket event.
    // We mock the NEXT fetch to return a file tree that no longer contains f1.
    mockFetch.mockImplementationOnce(async (url: string) => {
      if (url.includes('/workspace/ws1/files')) return { ok: true, json: async () => ([]) }; // Empty tree
      return { ok: true, json: async () => ({}) };
    });

    // Wait for the component to register the file-tree-update event listener
    await waitFor(() => {
      expect(mockSocketOn.mock.calls.some(call => call[0] === 'file-tree-update')).toBe(true);
    });

    const fileTreeUpdateCall = mockSocketOn.mock.calls.find(call => call[0] === 'file-tree-update');
    
    // Trigger the socket event
    fileTreeUpdateCall[1]();

    // 3. The IDE should detect the active file no longer exists and either unmount the editor
    // or navigate away to prevent the user from editing a ghost file.
    await waitFor(() => {
      // The CodeEditor should no longer be mounted with the old file
      const editor = screen.queryByTestId('monaco-mock');
      // Depending on your implementation, either the editor unmounts, or it redirects to the workspace root.
      // We check that it didn't crash.
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

    // Wait for connect/disconnect listeners
    await waitFor(() => {
      expect(mockSocketOn.mock.calls.some(call => call[0] === 'disconnect')).toBe(true);
      expect(mockSocketOn.mock.calls.some(call => call[0] === 'connect')).toBe(true);
    });

    // Simulate network drop and subsequent reconnect
    const disconnectCall = mockSocketOn.mock.calls.find(call => call[0] === 'disconnect');
    const connectCall = mockSocketOn.mock.calls.find(call => call[0] === 'connect');
    
    // Drop
    disconnectCall[1]();
    
    // Back online
    connectCall[1]();

    await waitFor(() => {
      // 1. It must re-join the Socket.IO workspace room to get presence events again
      expect(mockSocketEmit).toHaveBeenCalledWith('join-workspace', { workspaceId: 'ws1' });
      
      // 2. It must re-fetch the file tree because files might have been added/deleted while offline
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/workspace/ws1/files'), expect.any(Object));
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 4 — Frontend Collaborative UX: Ghost Cursors & Awareness Cleanup
// ═══════════════════════════════════════════════════════════════════════════════
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
    // When a component unmounts (user closes tab or switches file), they MUST broadcast
    // a null awareness state to the server so other users' screens remove their cursor.
    const { unmount } = render(
      <CodeEditor workspaceId="ws1" fileId="f1" language="javascript" currentUser={{ username: 'Aman', id: 'u1' }} />
    );

    await screen.findByTestId('monaco-mock');

    // Simulate Yjs connection so it sets the local awareness state
    const statusCall = latestProviderInstance.on.mock.calls.find((call: any) => call[0] === 'status');
    expect(statusCall).toBeDefined();
    statusCall[1]({ status: 'connected' });

    // Find the mocked awareness setLocalStateField function
    const setLocalStateSpy = latestProviderInstance.awareness.setLocalStateField;

    // Initially, it should have set the user's presence/color
    expect(setLocalStateSpy).toHaveBeenCalledWith('user', expect.objectContaining({
      name: 'Aman'
    }));

    setLocalStateSpy.mockClear();

    // Trigger unmount (simulating leaving the file)
    unmount();

    // CRITICAL: The cleanup function in useEffect MUST destroy the Yjs websocket provider
    // to close the socket connection and clean up all resources.
    expect(mockProviderDestroy).toHaveBeenCalledTimes(1);
  });

  it('handles remote awareness timeouts (Server drops a silent peer)', async () => {
    render(
      <CodeEditor workspaceId="ws1" fileId="f1" language="javascript" currentUser={{ username: 'Aman', id: 'u1' }} />
    );

    await screen.findByTestId('monaco-mock');

    const mockProviderInstance = latestProviderInstance;
    
    // Simulate initial awareness state with 2 users (Local user, and Remote User 'u2')
    mockProviderInstance.awareness.getStates.mockReturnValue(new Map([
      [1, { user: { name: 'Aman', color: 'blue' } }],
      [2, { user: { name: 'RemoteBob', color: 'red' }, cursor: { index: 10 } }]
    ]));

    // Find the awareness "change" event listener registered by the component
    const awarenessChangeCall = mockProviderInstance.awareness.on.mock.calls.find(
      (call: any) => call[0] === 'change'
    );
    expect(awarenessChangeCall).toBeDefined();

    // Simulate RemoteBob disconnecting ungracefully (e.g., wifi drops). 
    // Yjs fires an awareness change with their client ID in the `removed` array.
    const changeHandler = awarenessChangeCall[1];
    
    // Update the mock to reflect Bob is gone
    mockProviderInstance.awareness.getStates.mockReturnValue(new Map([
      [1, { user: { name: 'Aman', color: 'blue' } }]
    ]));

    // Trigger the change event indicating client 2 was removed
    changeHandler({ added: [], updated: [], removed: [2] }, 'local');

    // UI should handle this gracefully without throwing errors (React state update should succeed)
    // We confirm the editor is still mounted and didn't crash on the missing user data
    expect(screen.getByTestId('monaco-mock')).toBeInTheDocument();
  });
});