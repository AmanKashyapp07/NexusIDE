import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server';
import { getPool } from '../src/db';

describe('Auth API', () => {
  const testUser = {
    username: `testuser_${Date.now()}`,
    email: `test_${Date.now()}@example.com`,
    password: 'password123'
  };

  afterAll(async () => {
    // Cleanup test user
    await getPool().query('DELETE FROM users WHERE email = $1', [testUser.email]);
  });

  it('should register a new user', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send(testUser);
    
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user).toHaveProperty('id');
    expect(res.body.user.username).toBe(testUser.username);
  });

  it('should not allow duplicate email registration', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send(testUser);
    
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Username or email already taken');
  });

  it('should login an existing user', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        username: testUser.username,
        password: testUser.password
      });
    
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
  });

  it('should reject login with wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        username: testUser.username,
        password: 'wrongpassword'
      });
    
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Invalid credentials');
  });
});
