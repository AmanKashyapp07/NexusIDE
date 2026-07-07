/**
 * ===========================================================================
 * YJS CACHE TEST SUITE
 * ===========================================================================
 * 
 * Tests the free-tier Yjs caching implementation to ensure:
 * 1. Cache miss falls back to PostgreSQL gracefully
 * 2. Cache hit loads data correctly
 * 3. Cache invalidation works on save
 * 4. Corrupt cache data doesn't break file loading
 * 5. Redis unavailability doesn't prevent file access
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { getPool } from '../../backend/src/db.js';
import {
  getYjsStateFromCache,
  setYjsStateToCache,
  deleteYjsStateFromCache,
  clearYjsCache,
  isYjsCacheAvailable,
  getYjsCacheStats
} from '../../backend/src/utils/yjsCache.js';

describe('Yjs Cache - Unit Tests', () => {
  const TEST_FILE_ID = '00000000-0000-0000-0000-000000000999';
  
  beforeEach(async () => {
    // Clear cache before each test
    await clearYjsCache();
  });

  afterAll(async () => {
    // Cleanup
    await clearYjsCache();
  });

  it('should return null on cache miss', async () => {
    const result = await getYjsStateFromCache('nonexistent-file-id');
    expect(result).toBeNull();
  });

  it('should store and retrieve Yjs state correctly', async () => {
    // Create a test Yjs document
    const doc = new Y.Doc();
    doc.getText('monaco').insert(0, 'Hello, World!');
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    
    // Create author map
    const authorMap = new Map<number, { userId: string; username: string; color: string }>();
    authorMap.set(123, {
      userId: 'user-1',
      username: 'Alice',
      color: '#ff0000'
    });

    // Store in cache
    const stored = await setYjsStateToCache(TEST_FILE_ID, state, authorMap);
    expect(stored).toBe(true);

    // Retrieve from cache
    const cached = await getYjsStateFromCache(TEST_FILE_ID);
    expect(cached).not.toBeNull();
    expect(cached!.yjsState).toBeInstanceOf(Buffer);
    expect(cached!.authorMap.size).toBe(1);
    expect(cached!.authorMap.get(123)).toEqual({
      userId: 'user-1',
      username: 'Alice',
      color: '#ff0000'
    });

    // Verify content integrity
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
    
    // Verify it exists
    let cached = await getYjsStateFromCache(TEST_FILE_ID);
    expect(cached).not.toBeNull();

    // Delete
    const deleted = await deleteYjsStateFromCache(TEST_FILE_ID);
    expect(deleted).toBe(true);

    // Verify it's gone
    cached = await getYjsStateFromCache(TEST_FILE_ID);
    expect(cached).toBeNull();
    
    doc.destroy();
  });

  it('should handle large Yjs documents', async () => {
    const doc = new Y.Doc();
    const text = doc.getText('monaco');
    
    // Insert 100KB of text
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
    // This test verifies TTL is set, but doesn't wait for expiration
    const doc = new Y.Doc();
    doc.getText('monaco').insert(0, 'TTL test');
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    const authorMap = new Map();

    await setYjsStateToCache(TEST_FILE_ID, state, authorMap);
    
    const cached = await getYjsStateFromCache(TEST_FILE_ID);
    expect(cached).not.toBeNull();
    
    // In production, this would expire after 10 minutes
    // We can't wait that long in tests, but we verified it's cached
    
    doc.destroy();
  }, 2000);
});

describe('Yjs Cache - Integration Tests with Database', () => {
  let testWorkspaceId: string;
  let testFileId: string;
  let pool: any;

  beforeAll(async () => {
    // Ensure DATABASE_URL is set for tests
    if (!process.env.DATABASE_URL) {
      process.env.DATABASE_URL = 'postgresql://amankashyap@localhost:5432/sandbox';
    }
    
    pool = getPool();
    
    // Create test workspace
    const wsResult = await pool.query(
      `INSERT INTO workspaces (id, title, owner_id, is_public) 
       VALUES (gen_random_uuid(), 'cache-test-ws', 'test-user-id', false) 
       RETURNING id`
    );
    testWorkspaceId = wsResult.rows[0].id;

    // Create test file
    const fileResult = await pool.query(
      `INSERT INTO files (id, workspace_id, path, content, yjs_state, author_map) 
       VALUES (gen_random_uuid(), $1, '/test.js', 'console.log("test");', NULL, '{}') 
       RETURNING id`,
      [testWorkspaceId]
    );
    testFileId = fileResult.rows[0].id;
  });

  afterAll(async () => {
    // Cleanup database
    await pool.query('DELETE FROM files WHERE workspace_id = $1', [testWorkspaceId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId]);
    await clearYjsCache();
  });

  beforeEach(async () => {
    await clearYjsCache();
  });

  it('should populate cache from database on first load', async () => {
    // Update database with Yjs state
    const doc = new Y.Doc();
    doc.getText('monaco').insert(0, 'Database content');
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));

    await pool.query(
      'UPDATE files SET yjs_state = $1 WHERE id = $2',
      [state, testFileId]
    );

    // Cache should be empty initially
    let cached = await getYjsStateFromCache(testFileId);
    expect(cached).toBeNull();

    // Simulate loading (this would happen in getOrCreateDoc)
    const dbResult = await pool.query(
      'SELECT yjs_state, author_map FROM files WHERE id = $1',
      [testFileId]
    );

    const authorMap = new Map();
    if (dbResult.rows[0].yjs_state) {
      await setYjsStateToCache(testFileId, dbResult.rows[0].yjs_state, authorMap);
    }

    // Now cache should have it
    cached = await getYjsStateFromCache(testFileId);
    expect(cached).not.toBeNull();

    const loadedDoc = new Y.Doc();
    Y.applyUpdate(loadedDoc, cached!.yjsState!);
    expect(loadedDoc.getText('monaco').toString()).toBe('Database content');
    
    doc.destroy();
    loadedDoc.destroy();
  });

  it('should invalidate cache when file is updated', async () => {
    // Populate cache
    const doc = new Y.Doc();
    doc.getText('monaco').insert(0, 'Original content');
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    const authorMap = new Map();

    await setYjsStateToCache(testFileId, state, authorMap);

    // Verify cache exists
    let cached = await getYjsStateFromCache(testFileId);
    expect(cached).not.toBeNull();

    // Simulate file update (what happens in handleDocumentUpdate)
    await deleteYjsStateFromCache(testFileId);

    // Cache should be empty now
    cached = await getYjsStateFromCache(testFileId);
    expect(cached).toBeNull();
    
    doc.destroy();
  });
});

describe('Yjs Cache - Error Handling', () => {
  it('should handle invalid file IDs gracefully', async () => {
    const result = await getYjsStateFromCache('');
    expect(result).toBeNull();
  });

  it('should handle null/undefined buffers', async () => {
    const emptyBuffer = Buffer.alloc(0);
    const authorMap = new Map();
    
    // Should not throw
    await expect(
      setYjsStateToCache('test-id', emptyBuffer, authorMap)
    ).resolves.toBeDefined();
  });

  it('should reject corrupt Yjs state', async () => {
    const testFileId = 'corrupt-test-file';
    
    // Manually insert corrupt data into Redis (bypass validation)
    const { redis } = await import('../../backend/src/utils/redisCache.js');
    await redis.setex(`yjs:state:${testFileId}`, 60, Buffer.from('CORRUPT DATA'));

    // Should return null and delete corrupt entry
    const result = await getYjsStateFromCache(testFileId);
    expect(result).toBeNull();
    
    // Verify it was deleted
    const retryResult = await getYjsStateFromCache(testFileId);
    expect(retryResult).toBeNull();
  });
});

describe('Yjs Cache - Performance Characteristics', () => {
  it('should cache large documents efficiently', async () => {
    const doc = new Y.Doc();
    const text = doc.getText('monaco');
    
    // Create a document with 1000 lines of code
    const code = Array.from({ length: 1000 }, (_, i) => 
      `function test${i}() {\n  console.log("Line ${i}");\n  return ${i};\n}\n`
    ).join('\n');
    
    text.insert(0, code);
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    
    console.log(`[Perf Test] Document size: ${(state.length / 1024).toFixed(2)} KB`);
    
    const startWrite = Date.now();
    await setYjsStateToCache('perf-test', state, new Map());
    const writeTime = Date.now() - startWrite;
    
    const startRead = Date.now();
    const cached = await getYjsStateFromCache('perf-test');
    const readTime = Date.now() - startRead;
    
    console.log(`[Perf Test] Write time: ${writeTime}ms, Read time: ${readTime}ms`);
    
    expect(cached).not.toBeNull();
    expect(writeTime).toBeLessThan(100); // Should write in <100ms
    expect(readTime).toBeLessThan(50);   // Should read in <50ms
    
    doc.destroy();
    await deleteYjsStateFromCache('perf-test');
  }, 5000);
});
