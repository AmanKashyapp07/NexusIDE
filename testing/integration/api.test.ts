import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import { server } from '../../backend/src/server.js';
import { getPool } from '../../backend/src/db.js';
import { userRepository } from '../../backend/src/repositories/user.repository.js';
import { workspaceRepository } from '../../backend/src/repositories/workspace.repository.js';
import { fetchWorkspaceFiles, createFile, deleteFile } from '../../frontend/src/api/workspace';
import { fetchFileHistory } from '../../frontend/src/api/history';
import { fetchCurrentUser } from '../../frontend/src/api/auth';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

describe('API Services (Live Integration)', () => {
  let httpListener: any;
  let testUser: any;
  let testWorkspace: any;
  let validToken: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      httpListener = server.listen(4000, () => resolve());
    });

    const ts = Date.now();
    testUser = await userRepository.createUser(`api_usr_${ts}`.slice(0, 30), `api_${ts}@example.com`);
    testWorkspace = await workspaceRepository.createWorkspace(testUser.id, `API_WS_${ts}`);
    validToken = jwt.sign({ id: testUser.id, username: testUser.username }, JWT_SECRET, { expiresIn: '1h' });
  });

  afterAll(async () => {
    const pool = getPool();
    if (testWorkspace?.id) {
      await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspace.id]);
    }
    if (testUser?.id) {
      await pool.query('DELETE FROM users WHERE id = $1', [testUser.id]);
    }
    if (httpListener) {
      await new Promise<void>((resolve) => httpListener.close(() => resolve()));
    }
  });

  it('fetchWorkspaceFiles includes Bearer token and returns JSON from live API', async () => {
    const result = await fetchWorkspaceFiles(validToken, testWorkspace.id);
    expect(Array.isArray(result)).toBe(true);
  });

  it('createFile constructs POST request correctly to live API', async () => {
    const newFile = await createFile(validToken, testWorkspace.id, {
      name: 'test_app.js',
      type: 'file',
      parent_id: null,
      language: 'javascript'
    });
    
    expect(newFile).toBeDefined();
    expect(newFile.name).toBe('test_app.js');

    if (newFile.id) {
      await deleteFile(validToken, testWorkspace.id, newFile.id);
    }
  });

  it('API functions throw error when response is not ok (unauthorized)', async () => {
    await expect(fetchCurrentUser('invalid-bearer-token')).rejects.toThrow();
  });

  it('fetchFileHistory queries live History API correctly', async () => {
    const createdFile = await createFile(validToken, testWorkspace.id, {
      name: 'history_test.js',
      type: 'file',
      parent_id: null,
      language: 'javascript'
    });

    const history = await fetchFileHistory(validToken, testWorkspace.id, createdFile.id);
    expect(history).toBeDefined();
    expect(history.authorMap).toBeDefined();
    expect(Array.isArray(history.steps)).toBe(true);

    await deleteFile(validToken, testWorkspace.id, createdFile.id);
  });
});

