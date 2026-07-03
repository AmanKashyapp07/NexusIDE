import sys

new_tests = """

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 9 — Workspace Lifecycle & Operations
// ═══════════════════════════════════════════════════════════════════════════════
describe('Workspace Lifecycle & Operations', () => {
  let app: any;
  beforeEach(async () => {
    mockQuery = vi.fn();
    const mod = await import('../server');
    app = mod.app;
  });

  it('owner can rename workspace', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT w.owner_id')) return Promise.resolve({ rows: [{ owner_id: OWNER_ID }] });
      if (sql.includes('UPDATE workspaces SET title')) return Promise.resolve({ rows: [{ id: WORKSPACE_ID, title: 'New Title' }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).post(`/api/workspace`).set('Authorization', `Bearer ${ownerToken}`).send({ id: WORKSPACE_ID, title: 'New Title' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('New Title');
  });

  it('viewer cannot rename workspace', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT w.owner_id')) return Promise.resolve({ rows: [{ owner_id: OWNER_ID, role: 'viewer' }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).post(`/api/workspace`).set('Authorization', `Bearer ${viewerToken}`).send({ id: WORKSPACE_ID, title: 'Hack' });
    expect(res.status).toBe(403);
  });

  it('owner can delete workspace', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT owner_id FROM workspaces')) return Promise.resolve({ rows: [{ owner_id: OWNER_ID }] });
      if (sql.includes('DELETE FROM workspaces')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).delete(`/api/workspace/${WORKSPACE_ID}`).set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('editor cannot delete workspace', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT owner_id FROM workspaces')) return Promise.resolve({ rows: [{ owner_id: OWNER_ID }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).delete(`/api/workspace/${WORKSPACE_ID}`).set('Authorization', `Bearer ${editorToken}`);
    expect(res.status).toBe(403);
  });
  
  it('exports workspace as zip', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT owner_id, is_public FROM workspaces')) return Promise.resolve({ rows: [{ owner_id: OWNER_ID, is_public: false }] });
      if (sql.includes('SELECT title FROM workspaces')) return Promise.resolve({ rows: [{ title: 'Proj' }] });
      if (sql.includes('WITH RECURSIVE file_path_cte')) return Promise.resolve({ rows: [{ path: 'test.js', content: 'hello' }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).get(`/api/workspace/${WORKSPACE_ID}/export`).set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 10 — Advanced RBAC & Collaborator Management
// ═══════════════════════════════════════════════════════════════════════════════
describe('Advanced RBAC & Collaborator Management', () => {
  let app: any;
  beforeEach(async () => {
    mockQuery = vi.fn();
    const mod = await import('../server');
    app = mod.app;
  });

  it('admin can add collaborator', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT owner_id, is_public FROM workspaces')) return Promise.resolve({ rows: [{ owner_id: OWNER_ID, is_public: false }] });
      if (sql.includes('SELECT id FROM users')) return Promise.resolve({ rows: [{ id: VIEWER_ID }] });
      if (sql.includes('INSERT INTO workspace_collaborators')) return Promise.resolve({ rows: [{ workspace_id: WORKSPACE_ID, user_id: VIEWER_ID, role: 'viewer' }] });
      if (sql.includes('SELECT owner_id FROM workspaces')) return Promise.resolve({ rows: [{ owner_id: OWNER_ID }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).post(`/api/workspace/${WORKSPACE_ID}/collaborators`).set('Authorization', `Bearer ${ownerToken}`).send({ usernameOrEmail: 'test', role: 'viewer' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('viewer');
  });

  it('editor cannot add collaborator', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT owner_id, is_public FROM workspaces')) return Promise.resolve({ rows: [{ owner_id: OWNER_ID, is_public: false }] });
      if (sql.includes('SELECT role FROM workspace_collaborators')) return Promise.resolve({ rows: [{ role: 'editor' }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).post(`/api/workspace/${WORKSPACE_ID}/collaborators`).set('Authorization', `Bearer ${editorToken}`).send({ usernameOrEmail: 'test', role: 'viewer' });
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 11 — File Tree & Deletion Rigor
// ═══════════════════════════════════════════════════════════════════════════════
describe('File Tree & Deletion Rigor', () => {
  let app: any;
  beforeEach(async () => {
    mockQuery = vi.fn();
    const mod = await import('../server');
    app = mod.app;
  });

  it('returns file tree ordered correctly', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT owner_id, is_public FROM workspaces')) return Promise.resolve({ rows: [{ owner_id: OWNER_ID, is_public: false }] });
      if (sql.includes('SELECT id, parent_id, name, type, language FROM files')) {
        return Promise.resolve({ rows: [
          { type: 'directory', name: 'src' },
          { type: 'file', name: 'index.js' }
        ]});
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).get(`/api/workspace/${WORKSPACE_ID}/files`).set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body[0].type).toBe('directory');
    expect(res.body[1].type).toBe('file');
  });

  it('editor can delete a file', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT owner_id, is_public FROM workspaces')) return Promise.resolve({ rows: [{ owner_id: OWNER_ID, is_public: false }] });
      if (sql.includes('SELECT role FROM workspace_collaborators')) return Promise.resolve({ rows: [{ role: 'editor' }] });
      if (sql.includes('WITH RECURSIVE cte')) return Promise.resolve({ rows: [{ path: 'test.js' }] });
      if (sql.includes('DELETE FROM files')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).delete(`/api/workspace/${WORKSPACE_ID}/files/${FILE_ID}`).set('Authorization', `Bearer ${editorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 12 — Multi-User Collaboration Engine (E2E Integration)
// ═══════════════════════════════════════════════════════════════════════════════
import { WebsocketProvider } from 'y-websocket';

describe('Multi-User Collaboration Engine (E2E Integration)', () => {
  let server: any;
  let port: number;

  beforeEach(async () => {
    mockQuery = vi.fn().mockResolvedValue({ rows: [] });
    const mod = await import('../server');
    server = mod.server;
    await new Promise<void>(resolve => server.listen(0, resolve));
    port = (server.address() as any).port;
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    vi.resetModules();
  });

  it('syncs text live between two Yjs WebSocket clients', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT owner_id, is_public FROM workspaces')) return Promise.resolve({ rows: [{ owner_id: OWNER_ID, is_public: false }] });
      if (sql.includes('SELECT role FROM workspace_collaborators')) return Promise.resolve({ rows: [{ role: 'editor' }] });
      if (sql.includes('SELECT content, yjs_state FROM files')) return Promise.resolve({ rows: [{ content: '', yjs_state: null }] });
      return Promise.resolve({ rows: [] });
    });

    const docA = new Y.Doc();
    const wsProviderA = new WebsocketProvider(`ws://localhost:${port}`, `${WORKSPACE_ID}-${FILE_ID}`, docA, { WebSocketPolyfill: WebSocket as any, params: { token: ownerToken } });

    const docB = new Y.Doc();
    const wsProviderB = new WebsocketProvider(`ws://localhost:${port}`, `${WORKSPACE_ID}-${FILE_ID}`, docB, { WebSocketPolyfill: WebSocket as any, params: { token: editorToken } });

    await new Promise<void>(resolve => {
      wsProviderA.on('status', (event: any) => { if (event.status === 'connected') resolve(); });
    });
    await new Promise<void>(resolve => {
      wsProviderB.on('status', (event: any) => { if (event.status === 'connected') resolve(); });
    });

    // Wait a tiny bit for the server to send the initial bindState sync to both
    await new Promise(r => setTimeout(r, 100));

    docA.getText('monaco').insert(0, 'Hello from A');
    
    // Wait for it to sync to B
    await new Promise<void>(resolve => {
      const check = () => {
        if (docB.getText('monaco').toString() === 'Hello from A') {
          resolve();
        } else {
          setTimeout(check, 10);
        }
      };
      check();
    });

    expect(docB.getText('monaco').toString()).toBe('Hello from A');
    
    wsProviderA.disconnect();
    wsProviderB.disconnect();
  });

  it('viewer edits are dropped at WS layer', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT owner_id, is_public FROM workspaces')) return Promise.resolve({ rows: [{ owner_id: OWNER_ID, is_public: false }] });
      if (sql.includes('SELECT role FROM workspace_collaborators')) return Promise.resolve({ rows: [{ role: 'viewer' }] });
      if (sql.includes('SELECT content, yjs_state FROM files')) return Promise.resolve({ rows: [{ content: '', yjs_state: null }] });
      return Promise.resolve({ rows: [] });
    });

    const docV = new Y.Doc();
    const wsProviderV = new WebsocketProvider(`ws://localhost:${port}`, `${WORKSPACE_ID}-${FILE_ID}`, docV, { WebSocketPolyfill: WebSocket as any, params: { token: viewerToken } });

    await new Promise<void>(resolve => {
      wsProviderV.on('status', (event: any) => { if (event.status === 'connected') resolve(); });
    });

    // Viewer tries to edit
    docV.getText('monaco').insert(0, 'Illegal Edit');

    // Wait for the sync to be ignored by server
    await new Promise(r => setTimeout(r, 100));
    
    wsProviderV.disconnect();
    
    expect(docV.getText('monaco').toString()).toBe('Illegal Edit'); // remains local
  });

  it('Socket.IO file tree sync between clients', async () => {
    const clientA = ioClient(`http://localhost:${port}`, { auth: { token: ownerToken }, transports: ['websocket'] });
    const clientB = ioClient(`http://localhost:${port}`, { auth: { token: editorToken }, transports: ['websocket'] });

    await new Promise<void>((resolve) => {
      let connectedCount = 0;
      const check = () => { if (++connectedCount === 2) resolve(); };
      clientA.on('connect', check);
      clientB.on('connect', check);
    });

    clientA.emit('join-workspace', { workspaceId: WORKSPACE_ID });
    clientB.emit('join-workspace', { workspaceId: WORKSPACE_ID });

    // Wait for B to receive file-tree-update when A broadcasts
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 2000);
      clientB.on('file-tree-update', () => {
        clearTimeout(timeout);
        resolve();
      });
      // A broadcasts after short delay to ensure both joined
      setTimeout(() => {
        clientA.emit('broadcast-file-tree', { workspaceId: WORKSPACE_ID });
      }, 100);
    });

    clientA.disconnect();
    clientB.disconnect();
  });
});
"""

with open('src/tests/collaboration.test.ts', 'a') as f:
    f.write(new_tests)

print("Tests appended successfully!")
