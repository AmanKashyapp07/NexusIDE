import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import fs from 'fs';
import path from 'path';
import {
   compactFileCrdtDeltas,
   archiveWorkspaceToLocalDisk,
   hydrateArchivedWorkspaceFromLocalDisk,
   ARCHIVE_DATA_DIR,
} from '../../backend/src/services/crdtCompactor.service.js';

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
   const createdArchives: string[] = [];

   beforeEach(() => {
      for (const k in mockFiles) delete mockFiles[k];
      mockFileUpdates.length = 0;
      createdArchives.length = 0;

      const doc = new Y.Doc({ gc: false });
      const text = doc.getText('monaco');
      text.insert(0, 'Hello Base Content!');
      const baseState = Buffer.from(Y.encodeStateAsUpdate(doc));

      mockFiles[testFileId] = {
         id: testFileId,
         name: 'index.ts',
         content: 'Hello Base Content!',
         yjs_state: baseState,
         workspace_id: testWorkspaceId,
      };

      for (let i = 1; i <= 3; i++) {
         const prevSv = Y.encodeStateVector(doc);
         text.insert(text.length, ` Edit ${i}`);
         const updateBuf = Buffer.from(Y.encodeStateAsUpdate(doc, prevSv));
         mockFileUpdates.push({ id: i, file_id: testFileId, update: updateBuf });
      }

      doc.destroy();
   });

   afterEach(() => {
      for (const archPath of createdArchives) {
         if (fs.existsSync(archPath)) {
            try { fs.unlinkSync(archPath); } catch {}
         }
      }
   });

   it('1. compacts incremental file_updates into a single unified yjs_state buffer and purges deltas', async () => {
      expect(mockFileUpdates.length).toBe(3);

      const result = await compactFileCrdtDeltas(testFileId);

      expect(result.fileId).toBe(testFileId);
      expect(result.updatesCompacted).toBe(3);
      expect(result.compactedSizeBytes).toBeGreaterThan(0);
      expect(mockFileUpdates.length).toBe(0);
   });

   it('2. archives workspace state to local disk Gzip compressed file', async () => {
      const archiveRes = await archiveWorkspaceToLocalDisk(testWorkspaceId);
      createdArchives.push(archiveRes.archivePath);

      expect(archiveRes.workspaceId).toBe(testWorkspaceId);
      expect(fs.existsSync(archiveRes.archivePath)).toBe(true);

      const content = fs.readFileSync(archiveRes.archivePath);
      expect(content.length).toBeGreaterThan(0);
   });

   it('3. hydrates archived workspace from local disk compressed archive', async () => {
      const archiveRes = await archiveWorkspaceToLocalDisk(testWorkspaceId);
      createdArchives.push(archiveRes.archivePath);
      expect(fs.existsSync(archiveRes.archivePath)).toBe(true);

      const hydrated = await hydrateArchivedWorkspaceFromLocalDisk(testWorkspaceId);
      expect(hydrated).toBe(true);
   });

   it('4. scoped compaction leaves adjacent file updates untouched', async () => {
      const adjacentFileId = 'adjacent-file-999';
      mockFileUpdates.push({ id: 99, file_id: adjacentFileId, update: Buffer.from('adj_update') });

      await compactFileCrdtDeltas(testFileId);

      const remainingAdjacent = mockFileUpdates.filter(u => u.file_id === adjacentFileId);
      expect(remainingAdjacent.length).toBe(1);
   });

   it('5. 0-update compaction on an already compacted file is a safe no-op', async () => {
      mockFileUpdates.length = 0; // Clear all updates

      const result = await compactFileCrdtDeltas(testFileId);
      expect(result.updatesCompacted).toBe(0);
   });

   it('6. archiving an empty workspace handles 0 files without throwing', async () => {
      const emptyWsId = 'empty-ws-777';
      const archiveRes = await archiveWorkspaceToLocalDisk(emptyWsId);
      createdArchives.push(archiveRes.archivePath);

      expect(fs.existsSync(archiveRes.archivePath)).toBe(true);
   });

   it('7. hydrating a non-existent workspace archive returns false safely', async () => {
      const hydrated = await hydrateArchivedWorkspaceFromLocalDisk('ws-does-not-exist');
      expect(hydrated).toBe(false);
   });

   it('8. compacting non-existent file returns 0 updates compacted', async () => {
      const result = await compactFileCrdtDeltas('file-does-not-exist');
      expect(result.updatesCompacted).toBe(0);
   });
});
