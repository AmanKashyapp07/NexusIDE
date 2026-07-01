import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server';
import { getPool } from '../src/db';

describe('Workspace API', () => {
  const testUser = {
    username: `ws_testuser_${Date.now()}`,
    email: `ws_test_${Date.now()}@example.com`,
    password: 'password123'
  };

  let token: string;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send(testUser);
    token = res.body.token;
    userId = res.body.user.id;
  });

  afterAll(async () => {
    // Cascade delete handles workspaces/files when user is deleted
    await getPool().query('DELETE FROM users WHERE email = $1', [testUser.email]);
  });

  it('should create a new workspace on list load if none exists', async () => {
    const res = await request(app)
      .get('/api/workspace/default')
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('title');
    workspaceId = res.body.id;
  });

  it('should fetch workspace metadata', async () => {
    const res = await request(app)
      .get(`/api/workspace/${workspaceId}`)
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(workspaceId);
    expect(res.body.userRole).toBe('admin');
  });

  it('should create a new file in workspace', async () => {
    const res = await request(app)
      .post(`/api/workspace/${workspaceId}/files`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'test_script.py',
        type: 'file',
        language: 'python'
      });
    
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe('test_script.py');
  });

  it('should export workspace as a ZIP archive', async () => {
    const res = await request(app)
      .get(`/api/workspace/${workspaceId}/export`)
      .set('Authorization', `Bearer ${token}`)
      .responseType('blob'); // ensure we get a buffer, not parsed JSON
    if (res.status !== 200) {
      console.error('Export Error:', res.body.toString());
    }
    
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    expect(res.headers['content-disposition']).toContain('.zip');
    // Buffer length should be non-zero
    expect(res.body.length).toBeGreaterThan(0);
  });
});
