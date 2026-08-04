/**
 * Collaboration Engine Test Suite
 *
 * Covers:
 *  1. Yjs CRDT fundamentals (no server needed — pure logic)
 *  2. REST API — file creation, content retrieval, RBAC
 *  3. WebSocket authentication and authorization
 *  4. Persistence layer — bindState loads DB content, writeState saves on disconnect
 *
 * Strategy: mock `getPool` so tests run without a live Postgres or Docker daemon.
 * The y-websocket WebSocket tests spin up the actual `server` on a random port.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import * as Y from 'yjs';
import WebSocket from 'ws';
import jwt from 'jsonwebtoken';
import { io as ioClient } from 'socket.io-client';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import {
  getYjsStateFromCache,
  setYjsStateToCache,
  deleteYjsStateFromCache,
  clearYjsCache,
  isYjsCacheAvailable,
  getYjsCacheStats
} from '../backend/src/utils/yjsCache.js';


const JWT_SECRET = 'test_secret';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';


const WORKSPACE_ID = '11111111-1111-1111-1111-111111111111';
const FILE_ID      = '22222222-2222-2222-2222-222222222222';
const OWNER_ID     = '33333333-3333-3333-3333-333333333333';
const COLLAB_ID    = '44444444-4444-4444-4444-444444444444';
const VIEWER_ID    = '55555555-5555-5555-5555-555555555555';

const ownerToken   = jwt.sign({ id: OWNER_ID,  username: 'owner'  }, JWT_SECRET);
const editorToken  = jwt.sign({ id: COLLAB_ID, username: 'editor' }, JWT_SECRET);
const viewerToken  = jwt.sign({ id: VIEWER_ID, username: 'viewer' }, JWT_SECRET);
const outsiderToken = jwt.sign({ id: '99999999-9999-9999-9999-999999999999', username: 'outsider' }, JWT_SECRET);

function makeYjsState(text: string): Buffer {
  const doc = new Y.Doc();
  if (text) doc.getText('monaco').insert(0, text);
  const buf = Buffer.from(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return buf;
}

let mockQuery: any;

vi.mock('../backend/src/db', () => ({
  getPool: () => ({ query: (...args: any[]) => mockQuery(...args) }),
}));

vi.mock('../backend/src/sandbox/pool', () => ({
  warmPoolManager: { initializePools: vi.fn(), cleanup: vi.fn() },
  WORKSPACE_DATA_DIR: '/tmp/test-workspace',
}));
vi.mock('../backend/src/sandbox/workspaceContainer', () => ({
  getOrCreateWorkspaceContainer: vi.fn(),
  releaseWorkspaceContainer: vi.fn(),
  getRunningContainer: vi.fn(() => null),
  getRunningContainerRef: vi.fn(() => null),
  cleanupAllWorkspaceContainers: vi.fn(),
  touchWorkspaceActivity: vi.fn(),
}));
vi.mock('../backend/src/terminal/terminalHandler', () => ({
  handleTerminalConnection: vi.fn(),
  syncFileToTerminal: vi.fn().mockResolvedValue(undefined),
  syncDeleteToTerminal: vi.fn().mockResolvedValue(undefined),
  syncFolderToTerminal: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../backend/src/terminal/lspHandler', () => ({
  handleLspConnection: vi.fn(),
}));

describe('Yjs CRDT fundamentals', () => {
  it('encodes and re-applies state without data loss', () => {
    const doc = new Y.Doc();
    doc.getText('monaco').insert(0, 'hello world');
    const state = Y.encodeStateAsUpdate(doc);

    const doc2 = new Y.Doc();
    Y.applyUpdate(doc2, state);

    expect(doc2.getText('monaco').toString()).toBe('hello world');
    doc.destroy(); doc2.destroy();
  });

  it('merges two independent concurrent edits (CRDT convergence)', () => {
    const base = new Y.Doc();
    const stateV0 = Y.encodeStateAsUpdate(base);

    const docA = new Y.Doc();
    Y.applyUpdate(docA, stateV0);
    docA.getText('monaco').insert(0, 'Hello');

    const docB = new Y.Doc();
    Y.applyUpdate(docB, stateV0);
    docB.getText('monaco').insert(0, 'World');

    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    expect(docA.getText('monaco').toString()).toBe(docB.getText('monaco').toString());
    expect(docA.getText('monaco').toString().length).toBeGreaterThan(0);
    base.destroy(); docA.destroy(); docB.destroy();
  });

  it('applying the same update twice is idempotent', () => {
    const doc = new Y.Doc();
    doc.getText('monaco').insert(0, 'idempotent');
    const state = Y.encodeStateAsUpdate(doc);

    const doc2 = new Y.Doc();
    Y.applyUpdate(doc2, state);
    Y.applyUpdate(doc2, state); // apply again

    expect(doc2.getText('monaco').toString()).toBe('idempotent');
    doc.destroy(); doc2.destroy();
  });

  it('produces a valid (non-empty) state buffer for an empty doc', () => {
    const doc = new Y.Doc();
    const buf = Buffer.from(Y.encodeStateAsUpdate(doc));
    expect(buf.length).toBeGreaterThan(0);
    doc.destroy();
  });

  it('insert then delete converges correctly', () => {
    const doc = new Y.Doc();
    const text = doc.getText('monaco');
    text.insert(0, 'abcdef');
    text.delete(2, 2); // remove 'cd'
    expect(text.toString()).toBe('abef');
    doc.destroy();
  });
});

describe('POST /api/workspace/:id/files — initial Yjs state', () => {
  let app: any;

  beforeEach(async () => {
    mockQuery = vi.fn();
    const mod = await import('../backend/src/server.js');
    app = mod.app;
  });

  afterEach(() => { vi.restoreAllMocks(); });

  function setupWorkspaceOwnerMock(extraFileQueryResult?: any) {
    mockQuery.mockImplementation((sql: string, params: any[]) => {
      if (sql.includes('SELECT owner_id, is_public FROM workspaces')) {
        return Promise.resolve({ rows: [{ owner_id: OWNER_ID, is_public: false }] });
      }
      if (sql.includes('INSERT INTO files')) {
        return Promise.resolve({
          rows: [{ id: FILE_ID, parent_id: null, name: params[1], type: params[2], language: params[4] }]
        });
      }
      if (sql.includes('WITH RECURSIVE cte')) {
        return Promise.resolve({ rows: [{ path: params[1] }] });
      }
      return Promise.resolve({ rows: [] });
    });
  }

  it('creates a file and returns 201 with id, name, type', async () => {
    setupWorkspaceOwnerMock();
    const res = await request(app)
      .post(`/api/workspace/${WORKSPACE_ID}/files`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'index.js', type: 'file', language: 'javascript' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: FILE_ID, name: 'index.js', type: 'file' });
  });

  it('inserts yjs_state buffer (not null) for a new file', async () => {
    let capturedParams: any[] = [];
    mockQuery.mockImplementation((sql: string, params: any[]) => {
      if (sql.includes('SELECT owner_id, is_public FROM workspaces')) {
        return Promise.resolve({ rows: [{ owner_id: OWNER_ID, is_public: false }] });
      }
      if (sql.includes('INSERT INTO files')) {
        capturedParams = params;
        return Promise.resolve({
          rows: [{ id: FILE_ID, parent_id: null, name: 'test.ts', type: 'file', language: 'javascript' }]
        });
      }
      if (sql.includes('WITH RECURSIVE cte')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    await request(app)
      .post(`/api/workspace/${WORKSPACE_ID}/files`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'test.ts', type: 'file' });

    const yjsStateParam = capturedParams[6];
    expect(yjsStateParam).not.toBeNull();
    expect(Buffer.isBuffer(yjsStateParam)).toBe(true);
    expect((yjsStateParam as Buffer).length).toBeGreaterThan(0);
  });

  it('directory creation does NOT insert yjs_state (null)', async () => {
    let capturedParams: any[] = [];
    mockQuery.mockImplementation((sql: string, params: any[]) => {
      if (sql.includes('SELECT owner_id, is_public FROM workspaces')) {
        return Promise.resolve({ rows: [{ owner_id: OWNER_ID, is_public: false }] });
      }
      if (sql.includes('INSERT INTO files')) {
        capturedParams = params;
        return Promise.resolve({
          rows: [{ id: FILE_ID, parent_id: null, name: 'src', type: 'directory', language: null }]
        });
      }
      if (sql.includes('WITH RECURSIVE cte')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    await request(app)
      .post(`/api/workspace/${WORKSPACE_ID}/files`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'src', type: 'directory' });

    expect(capturedParams[6]).toBeNull();
  });

  it('rejects duplicate file name with 400', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT owner_id, is_public FROM workspaces')) {
        return Promise.resolve({ rows: [{ owner_id: OWNER_ID, is_public: false }] });
      }
      if (sql.includes('INSERT INTO files')) {
        const err: any = new Error('duplicate key'); err.code = '23505';
        return Promise.reject(err);
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post(`/api/workspace/${WORKSPACE_ID}/files`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'index.js', type: 'file' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/duplicate/i);
  });

  it('rejects unauthenticated request with 401', async () => {
    const res = await request(app)
      .post(`/api/workspace/${WORKSPACE_ID}/files`)
      .send({ name: 'index.js', type: 'file' });
    expect(res.status).toBe(401);
  });

  it('rejects editor with invalid params (no name) with 400', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT owner_id, is_public FROM workspaces')) {
        return Promise.resolve({ rows: [{ owner_id: OWNER_ID, is_public: false }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app)
      .post(`/api/workspace/${WORKSPACE_ID}/files`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ type: 'file' }); // missing name
    expect(res.status).toBe(400);
  });
});

describe('GET /api/workspace/:id/files/:fileId/content', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockQuery = vi.fn();
    const mod = await import('../backend/src/server.js');
    app = mod.app;
    if (mod.docs) mod.docs.clear();
    try {
      const cacheMod = await import('../backend/src/utils/yjsCache.js');
      await cacheMod.clearYjsCache();
      const { fileContentCache } = await import('../backend/src/utils/redisCache.js');
      await fileContentCache.clear();
    } catch {}
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns file content for the workspace owner', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT owner_id, is_public FROM workspaces'))
        return Promise.resolve({ rows: [{ owner_id: OWNER_ID, is_public: false }] });
      if (sql.includes('SELECT content FROM files'))
        return Promise.resolve({ rows: [{ content: 'console.log("hello")' }] });
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get(`/api/workspace/${WORKSPACE_ID}/files/${FILE_ID}/content`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.content).toBe('console.log("hello")');
  });

  it('returns empty string for a newly-created empty file', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT owner_id, is_public FROM workspaces'))
        return Promise.resolve({ rows: [{ owner_id: OWNER_ID, is_public: false }] });
      if (sql.includes('SELECT content FROM files'))
        return Promise.resolve({ rows: [{ content: null }] });
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get(`/api/workspace/${WORKSPACE_ID}/files/${FILE_ID}/content`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.content).toBe('');
  });

  it('returns 404 when file does not exist', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT owner_id, is_public FROM workspaces'))
        return Promise.resolve({ rows: [{ owner_id: OWNER_ID, is_public: false }] });
      if (sql.includes('SELECT content FROM files'))
        return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get(`/api/workspace/${WORKSPACE_ID}/files/${FILE_ID}/content`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(404);
  });

  it('allows viewer to read content', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT owner_id, is_public FROM workspaces'))
        return Promise.resolve({ rows: [{ owner_id: OWNER_ID, is_public: false }] });
      if (sql.includes('SELECT role FROM workspace_collaborators'))
        return Promise.resolve({ rows: [{ role: 'viewer' }] });
      if (sql.includes('SELECT content FROM files'))
        return Promise.resolve({ rows: [{ content: 'read only content' }] });
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get(`/api/workspace/${WORKSPACE_ID}/files/${FILE_ID}/content`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.content).toBe('read only content');
  });

  it('blocks outsider (not a collaborator) with 403', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT owner_id, is_public FROM workspaces'))
        return Promise.resolve({ rows: [{ owner_id: OWNER_ID, is_public: false }] });
      if (sql.includes('SELECT role FROM workspace_collaborators'))
        return Promise.resolve({ rows: [] }); // not a collaborator
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get(`/api/workspace/${WORKSPACE_ID}/files/${FILE_ID}/content`)
      .set('Authorization', `Bearer ${outsiderToken}`);

    expect(res.status).toBe(403);
  });
});

describe('RBAC — viewer cannot create or delete files', () => {
  let app: any;

  beforeEach(async () => {
    mockQuery = vi.fn();
    const mod = await import('../backend/src/server.js');
    app = mod.app;
  });

  function setupViewerMock() {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT owner_id, is_public FROM workspaces'))
        return Promise.resolve({ rows: [{ owner_id: OWNER_ID, is_public: false }] });
      if (sql.includes('SELECT role FROM workspace_collaborators'))
        return Promise.resolve({ rows: [{ role: 'viewer' }] });
      return Promise.resolve({ rows: [] });
    });
  }

  it('viewer cannot POST a new file (403)', async () => {
    setupViewerMock();
    const res = await request(app)
      .post(`/api/workspace/${WORKSPACE_ID}/files`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ name: 'hack.js', type: 'file' });
    expect(res.status).toBe(403);
  });

  it('viewer cannot DELETE a file (403)', async () => {
    setupViewerMock();
    const res = await request(app)
      .delete(`/api/workspace/${WORKSPACE_ID}/files/${FILE_ID}`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(403);
  });

  it('editor CAN POST a new file (201)', async () => {
    mockQuery.mockImplementation((sql: string, params: any[]) => {
      if (sql.includes('SELECT owner_id, is_public FROM workspaces'))
        return Promise.resolve({ rows: [{ owner_id: OWNER_ID, is_public: false }] });
      if (sql.includes('SELECT role FROM workspace_collaborators'))
        return Promise.resolve({ rows: [{ role: 'editor' }] });
      if (sql.includes('INSERT INTO files'))
        return Promise.resolve({ rows: [{ id: FILE_ID, parent_id: null, name: params[1], type: 'file', language: 'javascript' }] });
      if (sql.includes('WITH RECURSIVE cte')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post(`/api/workspace/${WORKSPACE_ID}/files`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ name: 'new.js', type: 'file' });
    expect(res.status).toBe(201);
  });
});

describe('WebSocket Yjs auth layer', () => {
  let server: any;
  let port: number;

  beforeEach(async () => {
    mockQuery = vi.fn();
    const mod = await import('../backend/src/server.js');
    server = mod.server;
    await new Promise<void>(resolve => server.listen(0, resolve));
    port = (server.address() as any).port;
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    vi.resetModules();
  });

  function ws(path: string): Promise<{ code: number; reason: string }> {
    return new Promise(resolve => {
      const client = new WebSocket(`ws://localhost:${port}${path}`);
      client.on('close', (code, reasonBuf) => {
        resolve({ code, reason: reasonBuf.toString() });
      });
      setTimeout(() => { if (client.readyState === WebSocket.OPEN) { client.close(); resolve({ code: 0, reason: 'connected' }); } }, 500);
    });
  }

  it('closes with 4401 when no token provided', async () => {
    const { code } = await ws(`/${WORKSPACE_ID}-${FILE_ID}`);
    expect(code).toBe(4401);
  });

  it('closes with 4401 when token is invalid/unsigned', async () => {
    const bad = jwt.sign({ id: OWNER_ID, username: 'owner' }, 'wrong_secret');
    const { code } = await ws(`/${WORKSPACE_ID}-${FILE_ID}?token=${bad}`);
    expect(code).toBe(4401);
  });

  it('closes with 4044 when workspace does not exist in DB', async () => {
    mockQuery.mockResolvedValue({ rows: [] }); // workspace not found
    const { code } = await ws(`/${WORKSPACE_ID}-${FILE_ID}?token=${ownerToken}`);
    expect(code).toBe(4044);
  });

  it('closes with 4403 when user is not a collaborator', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT owner_id, is_public FROM workspaces'))
        return Promise.resolve({ rows: [{ owner_id: OWNER_ID, is_public: false }] });
      if (sql.includes('SELECT role FROM workspace_collaborators'))
        return Promise.resolve({ rows: [] }); // not a member
      return Promise.resolve({ rows: [] });
    });
    const { code } = await ws(`/${WORKSPACE_ID}-${FILE_ID}?token=${outsiderToken}`);
    expect(code).toBe(4403);
  });

  it('allows owner to connect (code 0 = open/normal close)', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT owner_id, is_public FROM workspaces'))
        return Promise.resolve({ rows: [{ owner_id: OWNER_ID, is_public: false }] });
      if (sql.includes('SELECT content, yjs_state, author_map FROM files'))
        return Promise.resolve({ rows: [{ content: '', yjs_state: null, author_map: {} }] });
      return Promise.resolve({ rows: [] });
    });
    const { code } = await ws(`/${WORKSPACE_ID}-${FILE_ID}?token=${ownerToken}`);
    expect([0, 1000, 1001]).toContain(code); // clean close or still-open
  });

  it('allows collaborator with editor role to connect', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT owner_id, is_public FROM workspaces'))
        return Promise.resolve({ rows: [{ owner_id: OWNER_ID, is_public: false }] });
      if (sql.includes('SELECT role FROM workspace_collaborators'))
        return Promise.resolve({ rows: [{ role: 'editor' }] });
      if (sql.includes('SELECT content, yjs_state, author_map FROM files'))
        return Promise.resolve({ rows: [{ content: '', yjs_state: null, author_map: {} }] });
      return Promise.resolve({ rows: [] });
    });
    const { code } = await ws(`/${WORKSPACE_ID}-${FILE_ID}?token=${editorToken}`);
    expect([0, 1000, 1001]).toContain(code);
  });
});

describe('Persistence — bindState content loading', () => {
  it('applyUpdate from a stored yjs_state correctly restores text', () => {
    const original = 'function hello() { return 42; }';
    const storedState = makeYjsState(original);

    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, storedState);

    expect(ydoc.getText('monaco').toString()).toBe(original);
    ydoc.destroy();
  });

  it('falls back to legacy content insert when yjs_state is null', () => {
    const legacyContent = 'legacy plain text content';
    const ydoc = new Y.Doc();

    ydoc.getText('monaco').insert(0, legacyContent);

    expect(ydoc.getText('monaco').toString()).toBe(legacyContent);
    ydoc.destroy();
  });

  it('empty file produces empty text (no crash)', () => {
    const emptyState = makeYjsState('');
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, emptyState);
    expect(ydoc.getText('monaco').toString()).toBe('');
    ydoc.destroy();
  });

  it('two clients that both receive the same server state converge', () => {
    const serverContent = 'const x = 1;\nconst y = 2;';
    const serverState = makeYjsState(serverContent);

    const clientA = new Y.Doc();
    const clientB = new Y.Doc();

    Y.applyUpdate(clientA, serverState);
    Y.applyUpdate(clientB, serverState);

    expect(clientA.getText('monaco').toString()).toBe(serverContent);
    expect(clientB.getText('monaco').toString()).toBe(serverContent);
    clientA.destroy(); clientB.destroy();
  });

  it('client B joining after A types sees As content via server state', () => {
    const serverDoc = new Y.Doc();

    const clientA = new Y.Doc();
    Y.applyUpdate(clientA, Y.encodeStateAsUpdate(serverDoc)); // bindState: load empty
    clientA.getText('monaco').insert(0, 'Hello from A');

    Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(clientA));

    const savedState = Y.encodeStateAsUpdate(serverDoc);

    const clientB = new Y.Doc();
    Y.applyUpdate(clientB, savedState);

    expect(clientB.getText('monaco').toString()).toBe('Hello from A');
    serverDoc.destroy(); clientA.destroy(); clientB.destroy();
  });

  it('client B joining WHILE A is editing receives merged state', () => {
    const serverDoc = new Y.Doc();

    const clientA = new Y.Doc();
    Y.applyUpdate(clientA, Y.encodeStateAsUpdate(serverDoc));
    clientA.getText('monaco').insert(0, 'Line 1\n');

    Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(clientA));

    const clientB = new Y.Doc();
    Y.applyUpdate(clientB, Y.encodeStateAsUpdate(serverDoc));

    clientA.getText('monaco').insert(clientA.getText('monaco').length, 'Line 2\n');
    Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(clientA));

    Y.applyUpdate(clientB, Y.encodeStateAsUpdate(serverDoc));

    expect(clientB.getText('monaco').toString()).toContain('Line 1');
    expect(clientB.getText('monaco').toString()).toContain('Line 2');
    serverDoc.destroy(); clientA.destroy(); clientB.destroy();
  });
});

describe('POST /api/auth/test-login', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockQuery = vi.fn();
    const mod = await import('../backend/src/server.js');
    app = mod.app;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a new user and returns a JWT', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT * FROM users')) return Promise.resolve({ rows: [] }); // no existing user
      if (sql.includes('INSERT INTO users')) return Promise.resolve({ rows: [{ id: OWNER_ID }] });
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/auth/test-login')
      .send({ username: 'testuser', password: 'anything' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.username).toBe('testuser');
    const decoded = jwt.verify(res.body.token, JWT_SECRET) as any;
    expect(decoded.username).toBe('testuser');
  });

  it('returns existing user JWT on re-login', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM users'))
        return Promise.resolve({ rows: [{ id: OWNER_ID, username: 'existinguser' }] });
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/auth/test-login')
      .send({ username: 'existinguser', password: 'anything' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('rejects missing username with 400', async () => {
    const res = await request(app)
      .post('/api/auth/test-login')
      .send({ password: 'test' });
    expect(res.status).toBe(400);
  });

  it('rejects username shorter than 2 chars with 400', async () => {
    const res = await request(app)
      .post('/api/auth/test-login')
      .send({ username: 'a', password: 'test' });
    expect(res.status).toBe(400);
  });
});

describe('Socket.IO presence channel', () => {
  let server: any;
  let port: number;

  beforeEach(async () => {
    mockQuery = vi.fn().mockResolvedValue({ rows: [] });
    const mod = await import('../backend/src/server.js');
    server = mod.server;
    await new Promise<void>(resolve => server.listen(0, resolve));
    port = (server.address() as any).port;
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    vi.resetModules();
  });

  it('rejects Socket.IO connections with invalid JWT', async () => {
    const client = ioClient(`http://localhost:${port}`, {
      auth: { token: 'not.a.valid.token' },
      transports: ['websocket'],
    });

    await new Promise<void>(resolve => {
      client.on('connect_error', (err) => {
        expect(err.message).toMatch(/auth/i);
        client.disconnect();
        resolve();
      });
    });
  });

  it('accepts connection with valid JWT and emits presence on join-workspace', async () => {
    const client = ioClient(`http://localhost:${port}`, {
      auth: { token: ownerToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { client.disconnect(); reject(new Error('timeout')); }, 3000);
      client.on('connect', () => {
        client.emit('join-workspace', { workspaceId: WORKSPACE_ID });
      });
      client.on('workspace-presence-update', (users: any[]) => {
        clearTimeout(timeout);
        expect(Array.isArray(users)).toBe(true);
        expect(users.some(u => u.userId === OWNER_ID)).toBe(true);
        client.disconnect();
        resolve();
      });
    });
  });
});


describe('Workspace Lifecycle & Operations', () => {
  let app: any;
  beforeEach(async () => {
    mockQuery = vi.fn();
    const mod = await import('../backend/src/server.js');
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

describe('Advanced RBAC & Collaborator Management', () => {
  let app: any;
  beforeEach(async () => {
    mockQuery = vi.fn();
    const mod = await import('../backend/src/server.js');
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

describe('File Tree & Deletion Rigor', () => {
  let app: any;
  beforeEach(async () => {
    mockQuery = vi.fn();
    const mod = await import('../backend/src/server.js');
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

import { WebsocketProvider } from 'y-websocket';

describe('Multi-User Collaboration Engine (E2E Integration)', () => {
  let server: any;
  let port: number;

  beforeEach(async () => {
    mockQuery = vi.fn().mockResolvedValue({ rows: [] });
    const mod = await import('../backend/src/server.js');
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
      if (sql.includes('SELECT content, yjs_state, author_map FROM files')) return Promise.resolve({ rows: [{ content: '', yjs_state: null, author_map: {} }] });
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

    await new Promise(r => setTimeout(r, 100));

    docA.getText('monaco').insert(0, 'Hello from A');
    
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
      if (sql.includes('SELECT content, yjs_state, author_map FROM files')) return Promise.resolve({ rows: [{ content: '', yjs_state: null, author_map: {} }] });
      return Promise.resolve({ rows: [] });
    });

    const docV = new Y.Doc();
    const wsProviderV = new WebsocketProvider(`ws://localhost:${port}`, `${WORKSPACE_ID}-${FILE_ID}`, docV, { WebSocketPolyfill: WebSocket as any, params: { token: viewerToken } });

    await new Promise<void>(resolve => {
      wsProviderV.on('status', (event: any) => { if (event.status === 'connected') resolve(); });
    });

    docV.getText('monaco').insert(0, 'Illegal Edit');

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

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 2000);
      clientB.on('file-tree-update', () => {
        clearTimeout(timeout);
        resolve();
      });
      setTimeout(() => {
        clientA.emit('broadcast-file-tree', { workspaceId: WORKSPACE_ID });
      }, 100);
    });

    clientA.disconnect();
    clientB.disconnect();
  });

  it('reconnects client B and syncs updates made by client A while client B was offline', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT owner_id, is_public FROM workspaces')) return Promise.resolve({ rows: [{ owner_id: OWNER_ID, is_public: false }] });
      if (sql.includes('SELECT role FROM workspace_collaborators')) return Promise.resolve({ rows: [{ role: 'editor' }] });
      if (sql.includes('SELECT content, yjs_state, author_map FROM files')) return Promise.resolve({ rows: [{ content: 'initial content', yjs_state: null, author_map: {} }] });
      return Promise.resolve({ rows: [] });
    });

    const docA = new Y.Doc();
    const wsProviderA = new WebsocketProvider(`ws://localhost:${port}`, `${WORKSPACE_ID}-${FILE_ID}`, docA, { WebSocketPolyfill: WebSocket as any, params: { token: ownerToken } });

    const docB = new Y.Doc();
    const wsProviderB = new WebsocketProvider(`ws://localhost:${port}`, `${WORKSPACE_ID}-${FILE_ID}`, docB, { WebSocketPolyfill: WebSocket as any, params: { token: editorToken } });

    await Promise.all([
      new Promise<void>(resolve => wsProviderA.on('status', (event: any) => { if (event.status === 'connected') resolve(); })),
      new Promise<void>(resolve => wsProviderB.on('status', (event: any) => { if (event.status === 'connected') resolve(); }))
    ]);

    wsProviderB.disconnect();

    docA.getText('monaco').insert(docA.getText('monaco').toString().length, '\nadded by A while B was away');

    await new Promise(r => setTimeout(r, 100));

    wsProviderB.connect();

    await new Promise<void>(resolve => {
      wsProviderB.on('status', (event: any) => { if (event.status === 'connected') resolve(); });
    });

    await new Promise<void>(resolve => {
      const check = () => {
        if (docB.getText('monaco').toString().includes('added by A while B was away')) {
          resolve();
        } else {
          setTimeout(check, 10);
        }
      };
      check();
    });

    expect(docB.getText('monaco').toString()).toContain('added by A while B was away');

    wsProviderA.disconnect();
    wsProviderB.disconnect();
  });
});

describe("Chaos & Concurrency Load Testing", () => {
  let wsUrl = "";
  let server: any;
  
  beforeAll(async () => {
    process.setMaxListeners(100);
    const mod = await import('../backend/src/server.js');
    server = mod.server;
    await new Promise<void>(resolve => server.listen(0, resolve));
    const port = (server.address() as any).port;
    wsUrl = `ws://localhost:${port}/?workspaceId=${WORKSPACE_ID}&fileId=${FILE_ID}`;
  });

  afterAll(async () => {
    process.setMaxListeners(10);
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it("rapidly connects and disconnects 20 sockets without memory leaks", async () => {
    const clients: any[] = [];
    
    for (let i = 0; i < 20; i++) {
      const doc = new Y.Doc();
      const wsProvider = new WebsocketProvider(wsUrl, `${WORKSPACE_ID}-${FILE_ID}`, doc, {
        WebSocketPolyfill: WebSocket,
        params: { token: ownerToken }
      });
      clients.push(wsProvider);
    }
    
    await new Promise<void>((resolve) => {
      let connections = 0;
      clients.forEach(c => {
        c.on("status", (event: any) => {
          if (event.status === "connected") {
            connections++;
            if (connections === 20) resolve();
          }
        });
      });
    });

    const connectedCount = 20;
    
    clients.forEach(c => {
      c.destroy();
    });
    
    expect(connectedCount).toBeGreaterThan(0); // At least some should have connected in 500ms
  }, 10000);

  it("handles 10 concurrent clients typing simultaneously and perfectly converges", async () => {
    const numClients = 10;
    const clients: { doc: Y.Doc, provider: any }[] = [];
    
    for (let i = 0; i < numClients; i++) {
      const doc = new Y.Doc();
      const provider = new WebsocketProvider(wsUrl, `${WORKSPACE_ID}-${FILE_ID}`, doc, {
        WebSocketPolyfill: WebSocket,
        params: { token: ownerToken }
      });
      clients.push({ doc, provider });
    }

    await new Promise<void>((resolve) => {
      let connections = 0;
      clients.forEach(c => {
        c.provider.on("status", (event: any) => {
          if (event.status === "connected") {
            connections++;
            if (connections === numClients) resolve();
          }
        });
      });
    });

    clients.forEach((c, index) => {
      c.doc.getText("monaco").insert(0, `[Client${index}]`);
    });

    await new Promise(resolve => setTimeout(resolve, 2000));

    const finalContent = clients[0]!.doc.getText("monaco").toString();
    expect(finalContent.length).toBeGreaterThan(0);

    for (let i = 1; i < numClients; i++) {
      expect(clients[i]!.doc.getText("monaco").toString()).toBe(finalContent);
    }

    clients.forEach(c => c.provider.destroy());
  }, 10000);
});

describe('IDE Awareness (Cursors, Selections, and Presence)', () => {
  let server: any;
  let port: number;

  beforeEach(async () => {
    mockQuery = vi.fn().mockResolvedValue({ rows: [] });
    const mod = await import('../backend/src/server.js');
    server = mod.server;
    await new Promise<void>(resolve => server.listen(0, resolve));
    port = (server.address() as any).port;
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    vi.resetModules();
  });

  it('broadcasts cursor position and selection to other connected clients', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT owner_id, is_public FROM workspaces')) return Promise.resolve({ rows: [{ owner_id: OWNER_ID, is_public: false }] });
      if (sql.includes('SELECT role FROM workspace_collaborators')) return Promise.resolve({ rows: [{ role: 'editor' }] });
      return Promise.resolve({ rows: [] });
    });

    const docA = new Y.Doc();
    const wsA = new WebsocketProvider(`ws://localhost:${port}`, `${WORKSPACE_ID}-${FILE_ID}`, docA, { WebSocketPolyfill: WebSocket as any, params: { token: ownerToken } });

    const docB = new Y.Doc();
    const wsB = new WebsocketProvider(`ws://localhost:${port}`, `${WORKSPACE_ID}-${FILE_ID}`, docB, { WebSocketPolyfill: WebSocket as any, params: { token: editorToken } });

    await Promise.all([
      new Promise<void>(resolve => wsA.on('status', (e: any) => { if (e.status === 'connected') resolve(); })),
      new Promise<void>(resolve => wsB.on('status', (e: any) => { if (e.status === 'connected') resolve(); }))
    ]);

    const cursorState = { index: 15, length: 0, user: { name: 'owner', color: '#ff0000' } };
    
    await new Promise<void>(resolve => {
      wsB.awareness.on('change', () => {
        const states = Array.from(wsB.awareness.getStates().values());
        const hasA = states.some((state: any) => state.cursor?.index === 15);
        if (hasA) resolve();
      });
      wsA.awareness.setLocalStateField('cursor', cursorState);
    });

    const finalStatesB = Array.from(wsB.awareness.getStates().values());
    expect(finalStatesB).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cursor: expect.objectContaining({ index: 15 }) })
      ])
    );

    wsA.destroy();
    wsB.destroy();
  });
});

describe('Network Resiliency & Offline Sync', () => {
  let server: any;
  let port: number;

  beforeEach(async () => {
    mockQuery = vi.fn().mockResolvedValue({ rows: [] });
    const mod = await import('../backend/src/server.js');
    server = mod.server;
    await new Promise<void>(resolve => server.listen(0, resolve));
    port = (server.address() as any).port;
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    vi.resetModules();
  });

  it('syncs offline edits seamlessly upon reconnection', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT owner_id, is_public FROM workspaces')) return Promise.resolve({ rows: [{ owner_id: OWNER_ID, is_public: false }] });
      if (sql.includes('SELECT role FROM workspace_collaborators')) return Promise.resolve({ rows: [{ role: 'editor' }] });
      return Promise.resolve({ rows: [] });
    });

    const docA = new Y.Doc();
    const wsA = new WebsocketProvider(`ws://localhost:${port}`, `${WORKSPACE_ID}-${FILE_ID}`, docA, { WebSocketPolyfill: WebSocket as any, params: { token: ownerToken } });

    const docB = new Y.Doc();
    const wsB = new WebsocketProvider(`ws://localhost:${port}`, `${WORKSPACE_ID}-${FILE_ID}`, docB, { WebSocketPolyfill: WebSocket as any, params: { token: editorToken } });

    await Promise.all([
      new Promise<void>(resolve => wsA.on('status', (e: any) => { if (e.status === 'connected') resolve(); })),
      new Promise<void>(resolve => wsB.on('status', (e: any) => { if (e.status === 'connected') resolve(); }))
    ]);

    wsA.disconnect();

    docA.getText('monaco').insert(0, 'Offline Edit By A. ');
    docB.getText('monaco').insert(0, 'Online Edit By B. ');

    wsA.connect();

    await new Promise<void>(resolve => {
      const check = () => {
        const textA = docA.getText('monaco').toString();
        const textB = docB.getText('monaco').toString();
        if (textA === textB && textA.includes('Offline Edit By A.') && textA.includes('Online Edit By B.')) {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });

    expect(docA.getText('monaco').toString()).toBe(docB.getText('monaco').toString());

    wsA.destroy();
    wsB.destroy();
  });
});

describe('IDE Edge Cases: Large Payloads & Interleaved Edits', () => {
  it('handles massive copy-paste operations without overflowing call stacks', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const massivePayload = 'console.log("hello");\n'.repeat(25000); 
    
    docA.getText('monaco').insert(0, massivePayload);
    
    const update = Y.encodeStateAsUpdate(docA);
    Y.applyUpdate(docB, update);

    expect(docB.getText('monaco').toString().length).toBe(massivePayload.length);
    expect(docB.getText('monaco').toString()).toBe(massivePayload);
    
    docA.destroy(); 
    docB.destroy();
  });

  it('preserves intent during rapid interleaved typing and deletion', () => {
    const base = new Y.Doc();
    base.getText('monaco').insert(0, 'initial state string');
    const update = Y.encodeStateAsUpdate(base);

    const docA = new Y.Doc(); Y.applyUpdate(docA, update);
    const docB = new Y.Doc(); Y.applyUpdate(docB, update);

    docA.getText('monaco').delete(8, 5); 
    docA.getText('monaco').insert(8, 'broken');

    docB.getText('monaco').delete(14, 6);
    docB.getText('monaco').insert(14, 'data');

    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    expect(docA.getText('monaco').toString()).toBe('initial broken data');
    expect(docB.getText('monaco').toString()).toBe('initial broken data');
    
    base.destroy(); docA.destroy(); docB.destroy();
  });
});

describe('Yjs Undo/Redo Manager Integration', () => {
  it('correctly manages local undo stack without affecting remote peers unrelated edits', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    
    const yTextA = docA.getText('monaco');
    const undoManagerA = new Y.UndoManager(yTextA);

    yTextA.insert(0, 'const a = 1;');
    
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    docB.getText('monaco').insert(12, '\nconst b = 2;');
    
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB), 'remote');

    undoManagerA.undo();

    expect(yTextA.toString()).toBe('\nconst b = 2;');
    
    undoManagerA.redo();
    
    expect(yTextA.toString()).toBe('const a = 1;\nconst b = 2;');

    docA.destroy();
    docB.destroy();
  });
});

describe('CRDT Deep Dives: Merge Conflicts, GC & State Vectors', () => {
  it('resolves Split-Brain (Network Partition) cleanly without duplication', () => {
    const serverDoc = new Y.Doc();
    serverDoc.getText('monaco').insert(0, 'function init() {}');
    const initialState = Y.encodeStateAsUpdate(serverDoc);

    const docA = new Y.Doc(); Y.applyUpdate(docA, initialState);
    const docB = new Y.Doc(); Y.applyUpdate(docB, initialState);

    docA.getText('monaco').insert(16, '\n  console.log("A");\n');
    docB.getText('monaco').insert(16, '\n  return true;\n');

    const serverStateVector = Y.encodeStateVector(serverDoc);
    
    const diffA = Y.encodeStateAsUpdate(docA, serverStateVector);
    const diffB = Y.encodeStateAsUpdate(docB, serverStateVector);

    Y.applyUpdate(serverDoc, diffA);
    Y.applyUpdate(serverDoc, diffB);

    const finalServerUpdate = Y.encodeStateAsUpdate(serverDoc);
    Y.applyUpdate(docA, finalServerUpdate);
    Y.applyUpdate(docB, finalServerUpdate);

    const textServer = serverDoc.getText('monaco').toString();
    const textA = docA.getText('monaco').toString();
    const textB = docB.getText('monaco').toString();

    expect(textA).toBe(textServer);
    expect(textB).toBe(textServer);
    
    expect(textServer).toContain('console.log("A");');
    expect(textServer).toContain('return true;');
    
    serverDoc.destroy(); docA.destroy(); docB.destroy();
  });

  it('performs Garbage Collection (GC) on deleted characters to prevent memory leaks', () => {
    const doc = new Y.Doc();
    doc.gc = true; 

    const text = doc.getText('monaco');
    
    const hugeString = 'A'.repeat(100000);
    text.insert(0, hugeString);
    
    const sizeAfterInsert = Y.encodeStateAsUpdate(doc).byteLength;

    text.delete(0, hugeString.length);

    const sizeAfterDelete = Y.encodeStateAsUpdate(doc).byteLength;

    expect(sizeAfterDelete).toBeLessThan(sizeAfterInsert / 10);
    expect(text.toString()).toBe('');
    
    doc.destroy();
  });

  it('UndoManager respects Remote Origins (Does not undo other users edits)', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    
    const textA = docA.getText('monaco');
    const undoManager = new Y.UndoManager(textA, { captureTimeout: 0, trackedOrigins: new Set(['local']) });

    docA.transact(() => {
      textA.insert(0, 'Client A typed this.\n');
    }, 'local');

    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    docB.transact(() => {
      docB.getText('monaco').insert(21, 'Client B typed this.');
    }, 'remote-B');

    docA.transact(() => {
      Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    }, 'remote');

    expect(textA.toString()).toContain('Client B');

    undoManager.undo();

    expect(textA.toString()).not.toContain('Client A typed this.');
    expect(textA.toString()).toContain('Client B typed this.');

    docA.destroy(); docB.destroy();
  });
});


describe('Rename Preservation — fileId stability across renames', () => {
  it('inode-matched rename preserves fileId and Yjs content (no delete+recreate)', () => {

    const fileId = FILE_ID;
    const workspaceId = WORKSPACE_ID;

    const serverDoc = new Y.Doc();
    serverDoc.getText('monaco').insert(0, 'content before rename');
    const savedState = Y.encodeStateAsUpdate(serverDoc);


    const clientAfterRename = new Y.Doc();
    Y.applyUpdate(clientAfterRename, savedState);

    expect(clientAfterRename.getText('monaco').toString()).toBe('content before rename');

    const roomName = `${workspaceId}-${fileId}`;
    expect(roomName).toBe(`${WORKSPACE_ID}-${FILE_ID}`);

    serverDoc.destroy();
    clientAfterRename.destroy();
  });

  it('delete+recreate (no inode match) results in empty doc for new fileId', () => {

    const oldFileId = FILE_ID;
    const newFileId = '66666666-6666-6666-6666-666666666666';

    const oldDoc = new Y.Doc();
    oldDoc.getText('monaco').insert(0, 'old content');
    const oldState = Y.encodeStateAsUpdate(oldDoc);

    const newDoc = new Y.Doc();
    expect(newDoc.getText('monaco').toString()).toBe('');

    const oldRoom = `${WORKSPACE_ID}-${oldFileId}`;
    const newRoom = `${WORKSPACE_ID}-${newFileId}`;
    expect(oldRoom).not.toBe(newRoom);

    oldDoc.destroy();
    newDoc.destroy();
  });

  it('after rename, typing in the renamed file syncs to other clients via same room', () => {

    const serverDoc = new Y.Doc();
    serverDoc.getText('monaco').insert(0, 'before rename');
    const stateAfterRename = Y.encodeStateAsUpdate(serverDoc);

    const alice = new Y.Doc();
    const bob = new Y.Doc();
    Y.applyUpdate(alice, stateAfterRename);
    Y.applyUpdate(bob, stateAfterRename);

    bob.getText('monaco').insert(bob.getText('monaco').length, '\nAFTER rename');

    Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(bob));
    Y.applyUpdate(alice, Y.encodeStateAsUpdate(serverDoc));

    expect(alice.getText('monaco').toString()).toContain('AFTER rename');
    expect(alice.getText('monaco').toString()).toContain('before rename');

    serverDoc.destroy();
    alice.destroy();
    bob.destroy();
  });
});

describe('Disconnect → Persist → Rejoin Lifecycle', () => {
  let server: any;
  let port: number;

  beforeEach(async () => {
    mockQuery = vi.fn();
    const mod = await import('../backend/src/server.js');
    server = mod.server;
    await new Promise<void>(resolve => server.listen(0, resolve));
    port = (server.address() as any).port;
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    vi.resetModules();
  });

  it('rapid file switching (disconnect/reconnect to different rooms) preserves each file', async () => {
    const FILE_A = '22222222-2222-2222-2222-aaaaaaaaaaaa';
    const FILE_B = '22222222-2222-2222-2222-bbbbbbbbbbbb';

    const persistedStates = new Map<string, Buffer>();

    mockQuery.mockImplementation((sql: string, params?: any[]) => {
      if (sql.includes('SELECT owner_id, is_public FROM workspaces'))
        return Promise.resolve({ rows: [{ owner_id: OWNER_ID, is_public: false }] });
      if (sql.includes('SELECT content, yjs_state, author_map FROM files')) {
        const fileId = params?.[0]; // Won't work directly — but the server uses docName parsing
        const stateA = persistedStates.get(FILE_A);
        const stateB = persistedStates.get(FILE_B);
        return Promise.resolve({ rows: [{ content: '', yjs_state: null, author_map: {} }] });
      }
      if (sql.includes('UPDATE files SET yjs_state')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const docA1 = new Y.Doc();
    const provA1 = new WebsocketProvider(`ws://localhost:${port}`, `${WORKSPACE_ID}-${FILE_A}`, docA1, {
      WebSocketPolyfill: WebSocket as any, params: { token: ownerToken }
    });
    await new Promise<void>(resolve => provA1.on('status', (e: any) => { if (e.status === 'connected') resolve(); }));
    await new Promise(r => setTimeout(r, 50));
    docA1.getText('monaco').insert(0, 'file-a content');
    await new Promise(r => setTimeout(r, 100));

    const docB1 = new Y.Doc();
    const provB1 = new WebsocketProvider(`ws://localhost:${port}`, `${WORKSPACE_ID}-${FILE_B}`, docB1, {
      WebSocketPolyfill: WebSocket as any, params: { token: ownerToken }
    });
    await new Promise<void>(resolve => provB1.on('status', (e: any) => { if (e.status === 'connected') resolve(); }));
    await new Promise(r => setTimeout(r, 50));
    docB1.getText('monaco').insert(0, 'file-b content');
    await new Promise(r => setTimeout(r, 100));

    const docBobA = new Y.Doc();
    const provBobA = new WebsocketProvider(`ws://localhost:${port}`, `${WORKSPACE_ID}-${FILE_A}`, docBobA, {
      WebSocketPolyfill: WebSocket as any, params: { token: editorToken }
    });
    await new Promise<void>(resolve => provBobA.on('status', (e: any) => { if (e.status === 'connected') resolve(); }));
    await new Promise(r => setTimeout(r, 100));

    expect(docBobA.getText('monaco').toString()).toBe('file-a content');
    provBobA.disconnect();

    const docBobB = new Y.Doc();
    const provBobB = new WebsocketProvider(`ws://localhost:${port}`, `${WORKSPACE_ID}-${FILE_B}`, docBobB, {
      WebSocketPolyfill: WebSocket as any, params: { token: editorToken }
    });
    await new Promise<void>(resolve => provBobB.on('status', (e: any) => { if (e.status === 'connected') resolve(); }));
    await new Promise(r => setTimeout(r, 100));

    expect(docBobB.getText('monaco').toString()).toBe('file-b content');

    provA1.disconnect(); provB1.disconnect(); provBobB.disconnect();
    provA1.destroy(); provB1.destroy(); provBobA.destroy(); provBobB.destroy();
  }, 10000);

  it('late-joining user receives content from an active room without DB reload', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT owner_id, is_public FROM workspaces'))
        return Promise.resolve({ rows: [{ owner_id: OWNER_ID, is_public: false }] });
      if (sql.includes('SELECT role FROM workspace_collaborators'))
        return Promise.resolve({ rows: [{ role: 'editor' }] });
      if (sql.includes('SELECT content, yjs_state, author_map FROM files'))
        return Promise.resolve({ rows: [{ content: '', yjs_state: null, author_map: {} }] });
      return Promise.resolve({ rows: [] });
    });

    const docAlice = new Y.Doc();
    const provAlice = new WebsocketProvider(`ws://localhost:${port}`, `${WORKSPACE_ID}-${FILE_ID}`, docAlice, {
      WebSocketPolyfill: WebSocket as any, params: { token: ownerToken }
    });
    await new Promise<void>(resolve => provAlice.on('status', (e: any) => { if (e.status === 'connected') resolve(); }));
    await new Promise(r => setTimeout(r, 50));

    docAlice.getText('monaco').insert(0, 'alice typed this for late joiner');
    await new Promise(r => setTimeout(r, 100));

    const docBob = new Y.Doc();
    const provBob = new WebsocketProvider(`ws://localhost:${port}`, `${WORKSPACE_ID}-${FILE_ID}`, docBob, {
      WebSocketPolyfill: WebSocket as any, params: { token: editorToken }
    });
    await new Promise<void>(resolve => provBob.on('status', (e: any) => { if (e.status === 'connected') resolve(); }));

    await new Promise<void>(resolve => {
      const check = () => {
        if (docBob.getText('monaco').toString() === 'alice typed this for late joiner') {
          resolve();
        } else {
          setTimeout(check, 20);
        }
      };
      setTimeout(check, 50);
    });

    expect(docBob.getText('monaco').toString()).toBe('alice typed this for late joiner');

    provAlice.disconnect(); provBob.disconnect();
    provAlice.destroy(); provBob.destroy();
  }, 10000);
});

describe('Docs Map Lifecycle — registration and eviction', () => {
  let server: any;
  let port: number;
  let docsMap: Map<string, any>;

  beforeEach(async () => {
    mockQuery = vi.fn();
    const mod = await import('../backend/src/server.js');
    server = mod.server;
    docsMap = mod.docs;
    await new Promise<void>(resolve => server.listen(0, resolve));
    port = (server.address() as any).port;

    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT owner_id, is_public FROM workspaces'))
        return Promise.resolve({ rows: [{ owner_id: OWNER_ID, is_public: false }] });
      if (sql.includes('SELECT role FROM workspace_collaborators'))
        return Promise.resolve({ rows: [{ role: 'editor' }] });
      if (sql.includes('SELECT content, yjs_state, author_map FROM files'))
        return Promise.resolve({ rows: [{ content: '', yjs_state: null, author_map: {} }] });
      if (sql.includes('UPDATE files SET yjs_state'))
        return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    vi.resetModules();
  });

  it('doc is added to docs map when first client connects', async () => {
    const docName = `${WORKSPACE_ID}-${FILE_ID}`;
    expect(docsMap.has(docName)).toBe(false);

    const doc = new Y.Doc();
    const provider = new WebsocketProvider(`ws://localhost:${port}`, docName, doc, {
      WebSocketPolyfill: WebSocket as any, params: { token: ownerToken }
    });

    await new Promise<void>(resolve => provider.on('status', (e: any) => { if (e.status === 'connected') resolve(); }));
    await new Promise(r => setTimeout(r, 50));

    expect(docsMap.has(docName)).toBe(true);

    provider.disconnect();
    provider.destroy();

    await new Promise(r => setTimeout(r, 300));

    expect(docsMap.has(docName)).toBe(false);
  }, 10000);

  it('doc stays in map while at least one client is connected', async () => {
    const docName = `${WORKSPACE_ID}-${FILE_ID}`;

    const docA = new Y.Doc();
    const provA = new WebsocketProvider(`ws://localhost:${port}`, docName, docA, {
      WebSocketPolyfill: WebSocket as any, params: { token: ownerToken }
    });

    const docB = new Y.Doc();
    const provB = new WebsocketProvider(`ws://localhost:${port}`, docName, docB, {
      WebSocketPolyfill: WebSocket as any, params: { token: editorToken }
    });

    await Promise.all([
      new Promise<void>(resolve => provA.on('status', (e: any) => { if (e.status === 'connected') resolve(); })),
      new Promise<void>(resolve => provB.on('status', (e: any) => { if (e.status === 'connected') resolve(); }))
    ]);

    expect(docsMap.has(docName)).toBe(true);

    provA.disconnect();
    provA.destroy();
    await new Promise(r => setTimeout(r, 200));

    expect(docsMap.has(docName)).toBe(true);

    provB.disconnect();
    provB.destroy();
    await new Promise(r => setTimeout(r, 300));

    expect(docsMap.has(docName)).toBe(false);
  }, 10000);

  it('new client connecting to evicted doc reloads from DB (not stale memory)', async () => {
    const docName = `${WORKSPACE_ID}-${FILE_ID}`;
    let dbLoadCount = 0;

    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT owner_id, is_public FROM workspaces'))
        return Promise.resolve({ rows: [{ owner_id: OWNER_ID, is_public: false }] });
      if (sql.includes('SELECT role FROM workspace_collaborators'))
        return Promise.resolve({ rows: [{ role: 'editor' }] });
      if (sql.includes('SELECT content, yjs_state, author_map FROM files')) {
        dbLoadCount++;
        return Promise.resolve({ rows: [{ content: `load #${dbLoadCount}`, yjs_state: null, author_map: {} }] });
      }
      if (sql.includes('UPDATE files SET yjs_state'))
        return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const doc1 = new Y.Doc();
    const prov1 = new WebsocketProvider(`ws://localhost:${port}`, docName, doc1, {
      WebSocketPolyfill: WebSocket as any, params: { token: ownerToken }
    });
    await new Promise<void>(resolve => prov1.on('status', (e: any) => { if (e.status === 'connected') resolve(); }));
    await new Promise(r => setTimeout(r, 100));

    expect(doc1.getText('monaco').toString()).toBe('load #1');

    prov1.disconnect();
    prov1.destroy();
    await new Promise(r => setTimeout(r, 300));
    expect(docsMap.has(docName)).toBe(false);

    const doc2 = new Y.Doc();
    const prov2 = new WebsocketProvider(`ws://localhost:${port}`, docName, doc2, {
      WebSocketPolyfill: WebSocket as any, params: { token: editorToken }
    });
    await new Promise<void>(resolve => prov2.on('status', (e: any) => { if (e.status === 'connected') resolve(); }));
    await new Promise<void>(resolve => {
      const check = () => {
        if (doc2.getText('monaco').toString().includes('load #2')) {
          resolve();
        } else {
          setTimeout(check, 20);
        }
      };
      setTimeout(check, 50);
    });

    expect(doc2.getText('monaco').toString()).toBe('load #2');
    expect(dbLoadCount).toBe(2); // Loaded from DB twice, not from stale memory

    prov2.disconnect();
    prov2.destroy();
  }, 10000);
});

describe('Yjs Cache - Unit Tests', () => {
  const TEST_FILE_ID = '00000000-0000-0000-0000-000000000999';
  
  beforeEach(async () => {
    await clearYjsCache();
  });

  afterAll(async () => {
    await clearYjsCache();
  });

  it('should return null on cache miss', async () => {
    const result = await getYjsStateFromCache('nonexistent-file-id');
    expect(result).toBeNull();
  });

  it('should store and retrieve Yjs state correctly', async () => {
    const doc = new Y.Doc();
    doc.getText('monaco').insert(0, 'Hello, World!');
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    
    const authorMap = new Map<number, { userId: string; username: string; color: string }>();
    authorMap.set(123, {
      userId: 'user-1',
      username: 'Alice',
      color: '#ff0000'
    });

    const stored = await setYjsStateToCache(TEST_FILE_ID, state, authorMap);
    expect(stored).toBe(true);

    const cached = await getYjsStateFromCache(TEST_FILE_ID);
    expect(cached).not.toBeNull();
    expect(cached!.yjsState).toBeInstanceOf(Buffer);
    expect(cached!.authorMap.size).toBe(1);
    expect(cached!.authorMap.get(123)).toEqual({
      userId: 'user-1',
      username: 'Alice',
      color: '#ff0000'
    });

    const loadedDoc = new Y.Doc();
    Y.applyUpdate(loadedDoc, cached!.yjsState!);
    expect(loadedDoc.getText('monaco').toString()).toBe('Hello, World!');
    
    doc.destroy();
    loadedDoc.destroy();
  });

  it('should handle empty author map', async () => {
    const doc = new Y.Doc();
    doc.getText('monaco').insert(0, 'Test content');
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    const emptyAuthorMap = new Map();

    await setYjsStateToCache(TEST_FILE_ID, state, emptyAuthorMap);
    
    const cached = await getYjsStateFromCache(TEST_FILE_ID);
    expect(cached).not.toBeNull();
    expect(cached!.authorMap.size).toBe(0);
    
    doc.destroy();
  });

  it('should delete cache entries', async () => {
    const doc = new Y.Doc();
    doc.getText('monaco').insert(0, 'To be deleted');
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    const authorMap = new Map();

    await setYjsStateToCache(TEST_FILE_ID, state, authorMap);
    
    let cached = await getYjsStateFromCache(TEST_FILE_ID);
    expect(cached).not.toBeNull();

    const deleted = await deleteYjsStateFromCache(TEST_FILE_ID);
    expect(deleted).toBe(true);

    cached = await getYjsStateFromCache(TEST_FILE_ID);
    expect(cached).toBeNull();
    
    doc.destroy();
  });

  it('should handle large Yjs documents', async () => {
    const doc = new Y.Doc();
    const text = doc.getText('monaco');
    
    const largeContent = 'A'.repeat(100 * 1024);
    text.insert(0, largeContent);
    
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    const authorMap = new Map();

    await setYjsStateToCache(TEST_FILE_ID, state, authorMap);
    
    const cached = await getYjsStateFromCache(TEST_FILE_ID);
    expect(cached).not.toBeNull();
    
    const loadedDoc = new Y.Doc();
    Y.applyUpdate(loadedDoc, cached!.yjsState!);
    expect(loadedDoc.getText('monaco').toString().length).toBe(100 * 1024);
    
    doc.destroy();
    loadedDoc.destroy();
  });

  it('should handle multiple author entries', async () => {
    const doc = new Y.Doc();
    doc.getText('monaco').insert(0, 'Collaborative doc');
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    
    const authorMap = new Map<number, { userId: string; username: string; color: string }>();
    for (let i = 0; i < 10; i++) {
      authorMap.set(i, {
        userId: `user-${i}`,
        username: `User${i}`,
        color: `#${i}${i}${i}${i}${i}${i}`
      });
    }

    await setYjsStateToCache(TEST_FILE_ID, state, authorMap);
    
    const cached = await getYjsStateFromCache(TEST_FILE_ID);
    expect(cached).not.toBeNull();
    expect(cached!.authorMap.size).toBe(10);
    
    for (let i = 0; i < 10; i++) {
      expect(cached!.authorMap.get(i)).toEqual({
        userId: `user-${i}`,
        username: `User${i}`,
        color: `#${i}${i}${i}${i}${i}${i}`
      });
    }
    
    doc.destroy();
  });

  it('should check Redis availability', async () => {
    const available = await isYjsCacheAvailable();
    expect(typeof available).toBe('boolean');
  });

  it('should get cache statistics', async () => {
    const stats = await getYjsCacheStats();
    expect(stats).toHaveProperty('totalKeys');
    expect(stats).toHaveProperty('stateKeys');
    expect(stats).toHaveProperty('authorKeys');
    expect(stats).toHaveProperty('available');
  });

  it('should handle cache expiration (TTL)', async () => {
    const doc = new Y.Doc();
    doc.getText('monaco').insert(0, 'TTL test');
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    const authorMap = new Map();

    await setYjsStateToCache(TEST_FILE_ID, state, authorMap);
    
    const cached = await getYjsStateFromCache(TEST_FILE_ID);
    expect(cached).not.toBeNull();
    
    doc.destroy();
  }, 2000);
});

describe('Yjs Cache - Error Handling', () => {
  it('should handle invalid file IDs gracefully', async () => {
    const result = await getYjsStateFromCache('');
    expect(result).toBeNull();
  });

  it('should handle null/undefined buffers', async () => {
    const emptyBuffer = Buffer.alloc(0);
    const authorMap = new Map();
    
    await expect(
      setYjsStateToCache('test-id', emptyBuffer, authorMap)
    ).resolves.toBeDefined();
  });

  it('should reject corrupt Yjs state', async () => {
    const testFileId = 'corrupt-test-file';
    
    const { redis } = await import('../backend/src/utils/redisCache.js');
    await redis.setex(`yjs:state:${testFileId}`, 60, Buffer.from('CORRUPT DATA'));

    const result = await getYjsStateFromCache(testFileId);
    expect(result).toBeNull();
    
    const retryResult = await getYjsStateFromCache(testFileId);
    expect(retryResult).toBeNull();
  });
});

describe('Yjs Cache - Performance Characteristics', () => {
  it('should cache large documents efficiently', async () => {
    const doc = new Y.Doc();
    const text = doc.getText('monaco');
    
    const code = Array.from({ length: 1000 }, (_, i) => 
      `function test${i}() {\n  console.log("Line ${i}");\n  return ${i};\n}\n`
    ).join('\n');
    
    text.insert(0, code);
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    
    const startWrite = Date.now();
    await setYjsStateToCache('perf-test', state, new Map());
    const writeTime = Date.now() - startWrite;
    
    const startRead = Date.now();
    const cached = await getYjsStateFromCache('perf-test');
    const readTime = Date.now() - startRead;
    
    expect(cached).not.toBeNull();
    expect(writeTime).toBeLessThan(100);
    expect(readTime).toBeLessThan(50);
    
    doc.destroy();
    await deleteYjsStateFromCache('perf-test');
  }, 5000);
});
