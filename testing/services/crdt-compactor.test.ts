import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import fs from 'fs';
import path from 'path';
import {
   compactFileCrdtDeltas,
   archiveWorkspaceToLocalDisk,
   hydrateArchivedWorkspaceFromLocalDisk,
   ARCHIVE_DATA_DIR,
} from '../../backend/src/services/crdtCompactor.service.js';

// In-memory mock database state
const mockFiles: Record<string, { id: string; name: string; content: string | null; yjs_state: Buffer | null; workspace_id: string }> = {};
const mockFileUpdates: Array<{ id: number; file_id: string; update: Buffer }> = [];

vi.mock('../../backend/src/db.js', () => ({
   getPool: () => ({
      query: vi.fn(async (sql: string, params?: any[]) => {
         if (sql.includes('SELECT yjs_state, content FROM files WHERE id = $1')) {
            const fileId = params?.[0];
            const file = mockFiles[fileId];
            return { rows: file ? [{ yjs_state: file.yjs_state, content: file.content }] : [] };
         }

         if (sql.includes('SELECT id, update FROM file_updates WHERE file_id = $1')) {
            const fileId = params?.[0];
            const updates = mockFileUpdates.filter((u) => u.file_id === fileId);
            return { rows: updates };
         }

         if (sql.includes('SELECT id, name, content, yjs_state FROM files WHERE workspace_id = $1')) {
            const wsId = params?.[0];
            const files = Object.values(mockFiles).filter((f) => f.workspace_id === wsId);
            return { rows: files };
         }

         if (sql.includes('UPDATE files SET yjs_state = $1')) {
            const yjsState = params?.[0];
            const content = params?.[1];
            const fileId = params?.[2];
            if (mockFiles[fileId]) {
               mockFiles[fileId].yjs_state = yjsState;
               mockFiles[fileId].content = content;
            }
            return { rowCount: 1 };
         }

         if (sql.includes('DELETE FROM file_updates WHERE file_id = $1')) {
            const fileId = params?.[0];
            for (let i = mockFileUpdates.length - 1; i >= 0; i--) {
               if (mockFileUpdates[i].file_id === fileId) {
                  mockFileUpdates.splice(i, 1);
               }
            }
            return { rowCount: 1 };
         }

         return { rows: [] };
      }),
      connect: vi.fn(async () => ({
         query: vi.fn(async (sql: string, params?: any[]) => {
            if (sql.includes('UPDATE files SET yjs_state = $1')) {
               const yjsState = params?.[0];
               const content = params?.[1];
               const fileId = params?.[2];
               if (mockFiles[fileId]) {
                  mockFiles[fileId].yjs_state = yjsState;
                  mockFiles[fileId].content = content;
               }
            }
            if (sql.includes('DELETE FROM file_updates WHERE file_id = $1')) {
               const fileId = params?.[0];
               for (let i = mockFileUpdates.length - 1; i >= 0; i--) {
                  if (mockFileUpdates[i].file_id === fileId) {
                     mockFileUpdates.splice(i, 1);
                  }
               }
            }
            return { rows: [] };
         }),
         release: vi.fn(),
      })),
   }),
}));

describe('CRDT Delta Compaction & Local Archiving Service', () => {
   const testFileId = 'test-file-compact-101';
   const testWorkspaceId = 'test-ws-archive-202';

   beforeEach(() => {
      // Reset mock data
      for (const k in mockFiles) delete mockFiles[k];
      mockFileUpdates.length = 0;

      // Seed initial base document
      const doc = new Y.Doc({ gc: false });
      doc.getText('monaco').insert(0, 'Hello Base Content!');
      const baseState = Buffer.from(Y.encodeStateAsUpdate(doc));

      mockFiles[testFileId] = {
         id: testFileId,
         name: 'index.ts',
         content: 'Hello Base Content!',
         yjs_state: baseState,
         workspace_id: testWorkspaceId,
      };

      // Create 3 incremental update deltas
      for (let i = 1; i <= 3; i++) {
         const updateDoc = new Y.Doc({ gc: false });
         updateDoc.getText('monaco').insert(0, `Edit ${i}: `);
         const updateBuf = Buffer.from(Y.encodeStateAsUpdate(updateDoc));
         mockFileUpdates.push({ id: i, file_id: testFileId, update: updateBuf });
      }
   });

   it('compacts incremental file_updates into a single unified yjs_state buffer and purges deltas', async () => {
      expect(mockFileUpdates.length).toBe(3);

      const result = await compactFileCrdtDeltas(testFileId);

      expect(result.fileId).toBe(testFileId);
      expect(result.updatesCompacted).toBe(3);
      expect(result.compactedSizeBytes).toBeGreaterThan(0);
      expect(mockFileUpdates.length).toBe(0); // All deltas purged
   });

   it('archives workspace state to local disk Gzip compressed file', async () => {
      const archiveRes = await archiveWorkspaceToLocalDisk(testWorkspaceId);

      expect(archiveRes.workspaceId).toBe(testWorkspaceId);
      expect(fs.existsSync(archiveRes.archivePath)).toBe(true);

      // Verify file is Gzip compressed
      const content = fs.readFileSync(archiveRes.archivePath);
      expect(content.length).toBeGreaterThan(0);

      // Cleanup generated archive file
      if (fs.existsSync(archiveRes.archivePath)) {
         fs.unlinkSync(archiveRes.archivePath);
      }
   });

   it('hydrates archived workspace from local disk compressed archive', async () => {
      const archiveRes = await archiveWorkspaceToLocalDisk(testWorkspaceId);
      expect(fs.existsSync(archiveRes.archivePath)).toBe(true);

      const hydrated = await hydrateArchivedWorkspaceFromLocalDisk(testWorkspaceId);
      expect(hydrated).toBe(true);

      if (fs.existsSync(archiveRes.archivePath)) {
         fs.unlinkSync(archiveRes.archivePath);
      }
   });
});
