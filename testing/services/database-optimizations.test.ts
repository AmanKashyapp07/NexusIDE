import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fileRepository } from '../../backend/src/repositories/file.repository.js';
import { workspaceRepository } from '../../backend/src/repositories/workspace.repository.js';
import { getPool, ensureDatabaseIndexes } from '../../backend/src/db.js';

describe('PostgreSQL Database & Query Optimizations', () => {
   const mockWorkspaceId = '00000000-0000-0000-0000-000000000001';
   const mockUserId = '00000000-0000-0000-0000-000000000002';
   const mockFileId = '00000000-0000-0000-0000-000000000003';

   it('configures connection pool with statement timeouts and application name', () => {
      const pool = getPool();
      expect(pool).toBeDefined();
      expect(pool.options.max).toBe(30);
      expect(pool.options.statement_timeout).toBe(5000);
      expect(pool.options.query_timeout).toBe(5000);
      expect(pool.options.application_name).toBe('NexusIDE-Cluster');
   });

   it('creates covering B-Tree indexes on pool initialization without error', async () => {
      const mockPool: any = {
         query: vi.fn().mockResolvedValue({ rows: [] })
      };

      await ensureDatabaseIndexes(mockPool);
      expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('idx_files_tree'));
      expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('idx_collab_auth'));
      expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('idx_file_updates_ordered'));
   });

   it('executes high-frequency queries with parameterized SQL and values', async () => {
      const pool = getPool();
      const querySpy = vi.spyOn(pool, 'query').mockImplementation(async (sql: any, params: any) => {
         if (typeof sql === 'string' && sql.includes('SELECT owner_id, is_public FROM workspaces')) {
            return { rows: [{ owner_id: mockUserId, is_public: false }] } as any;
         }
         if (typeof sql === 'string' && sql.includes('SELECT role FROM workspace_collaborators')) {
            return { rows: [{ role: 'editor' }] } as any;
         }
         if (typeof sql === 'string' && sql.includes('SELECT id, parent_id, name, type, language FROM files')) {
            return { rows: [{ id: mockFileId, name: 'index.ts', type: 'file', parent_id: null, language: 'typescript' }] } as any;
         }
         return { rows: [] } as any;
      });

      const auth = await workspaceRepository.findWorkspaceAuth(mockWorkspaceId);
      expect(auth).toEqual({ owner_id: mockUserId, is_public: false });

      const role = await workspaceRepository.findCollaboratorRole(mockWorkspaceId, mockUserId);
      expect(role).toBe('editor');

      const files = await fileRepository.getWorkspaceFiles(mockWorkspaceId);
      expect(files).toHaveLength(1);

      querySpy.mockRestore();
   });

   it('performs bulk vectorized unnest file insertion in a single network roundtrip', async () => {
      const pool = getPool();
      const querySpy = vi.spyOn(pool, 'query').mockImplementation(async (sql: any, params: any) => {
         expect(sql).toContain('unnest($2::text[])');
         expect(params[0]).toBe(mockWorkspaceId);
         expect(params[1]).toEqual(['App.tsx', 'index.css', 'package.json']);
         return {
            rows: [
               { id: 'f1', name: 'App.tsx', type: 'file', parent_id: null, language: 'typescript' },
               { id: 'f2', name: 'index.css', type: 'file', parent_id: null, language: 'css' },
               { id: 'f3', name: 'package.json', type: 'file', parent_id: null, language: 'json' }
            ]
         } as any;
      });

      const inserted = await fileRepository.insertManyFiles(mockWorkspaceId, [
         { name: 'App.tsx', type: 'file', language: 'typescript', content: 'export default () => null;' },
         { name: 'index.css', type: 'file', language: 'css', content: 'body { margin: 0; }' },
         { name: 'package.json', type: 'file', language: 'json', content: '{}' }
      ]);

      expect(inserted).toHaveLength(3);
      expect(querySpy).toHaveBeenCalledTimes(1);

      querySpy.mockRestore();
   });

   it('performs multi-key batch lookups via findFilesByIds', async () => {
      const pool = getPool();
      const querySpy = vi.spyOn(pool, 'query').mockImplementation(async (queryConfig: any) => {
         expect(queryConfig.name).toBe('find-files-by-ids');
         expect(queryConfig.values).toEqual([['f1', 'f2'], mockWorkspaceId]);
         return {
            rows: [
               { id: 'f1', name: 'App.tsx', type: 'file', parent_id: null, language: 'typescript', content: 'A' },
               { id: 'f2', name: 'index.css', type: 'file', parent_id: null, language: 'css', content: 'B' }
            ]
         } as any;
      });

      const files = await fileRepository.findFilesByIds(['f1', 'f2'], mockWorkspaceId);
      expect(files).toHaveLength(2);
      expect(files[0]!.name).toBe('App.tsx');
      expect(files[1]!.name).toBe('index.css');

      querySpy.mockRestore();
   });
});
