import { Router, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { requireWorkspaceRole, WorkspaceAuthRequest } from '../middleware/workspaceAuth.js';
import { ZipArchive } from 'archiver';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { getRunningContainerRef, getRunningContainerRefByWorkspaceId, touchWorkspaceActivity, releaseWorkspaceContainer } from '../sandbox/workspaceContainer.js';
import { WORKSPACE_DATA_DIR } from '../sandbox/pool.js';
import * as path from 'path';
import { rmSync, existsSync } from 'fs';
import {
   getWorkspaceFiles,
   createWorkspaceFile,
   getFileContent,
   getFileHistory,
   updateFileContent,
   deleteWorkspaceFile,
   getFileConflicts,
   resolveFileConflict
} from '../services/workspaceFile.service.js';
import {
   createSnapshot,
   listSnapshots,
   getSnapshotFilesWithDiff,
   restoreSnapshot
} from '../services/workspaceSnapshot.service.js';
import { cancelAndEvictWorkspaceDocs } from '../docsRegistry.js';
import { PREVIEW_FALLBACK_HTML } from '../utils/previewFallback.utils.js';
import { workspaceRepository } from '../repositories/workspace.repository.js';
import { fileRepository } from '../repositories/file.repository.js';
import { userRepository } from '../repositories/user.repository.js';

const router = Router();

router.get('/', async (req: AuthRequest, res: Response) => {
   if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
   try {
      const workspaces = await workspaceRepository.getUserWorkspaces(req.user.id);
      res.json(workspaces);
   } catch { 
      res.status(500).json({ error: 'Server error' }); 
   }
});

router.post('/', async (req: AuthRequest, res: Response) => {
   const { id, title } = req.body as { id?: string; title?: string };
   const userId = req.user?.id;
   if (!userId) return res.status(401).json({ error: 'Unauthorized' });
   
   try {
      if (id) {
         const checkRes = await workspaceRepository.findWorkspaceWithUserAccess(id, userId);
         if (!checkRes) return res.status(404).json({ error: 'Not found' });
         if (checkRes.owner_id !== userId && checkRes.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
         
         const updated = await workspaceRepository.updateWorkspaceTitle(id, title || 'Untitled');
         return res.json(updated);
      }
      const created = await workspaceRepository.createWorkspace(userId, title || 'Untitled Project');
      res.json(created);
   } catch { 
      res.status(500).json({ error: 'Server error' }); 
   }
});

router.get('/default', async (req: AuthRequest, res: Response) => {
   if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
   try {
      let ws = await workspaceRepository.findFirstUserWorkspace(req.user.id);
      if (!ws) {
         ws = await workspaceRepository.createWorkspace(req.user.id, 'My First Sandbox');
      }
      res.json(ws);
   } catch (err: unknown) { 
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg }); 
   }
});

router.get('/:id', requireWorkspaceRole('viewer'), async (req: WorkspaceAuthRequest, res: Response) => {
   try {
      const ws = await workspaceRepository.findWorkspaceById(req.params.id as string);
      if (!ws) return res.status(404).json({ error: 'Not found' });
      res.json({ ...ws, userRole: req.workspaceRole });
   } catch (err: unknown) { 
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg }); 
   }
});

router.get('/:id/export', requireWorkspaceRole('viewer'), async (req: WorkspaceAuthRequest, res: Response) => {
   try {
      const ws = await workspaceRepository.findWorkspaceTitle(req.params.id as string);
      if (!ws) return res.status(404).json({ error: 'Not found' });
      
      const files = await fileRepository.getFlattenedFilePaths(req.params.id as string);
      const fileRows = files.filter(f => f.type === 'file');

      res.attachment(`${ws.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.zip`);
      const archive = new ZipArchive({ zlib: { level: 9 } });
      archive.pipe(res);
      fileRows.forEach(f => archive.append(f.content || '', { name: f.path }));
      archive.finalize();
   } catch (err: unknown) { 
      const msg = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) res.status(500).json({ error: msg }); 
   }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
   if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
   const id = req.params.id as string;
   try {
      const ws = await workspaceRepository.findWorkspaceOwner(id);
      if (!ws) return res.status(404).json({ error: 'Not found' });
      if (ws.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
      
      await workspaceRepository.deleteWorkspace(id);
      try { await cancelAndEvictWorkspaceDocs(id); } catch {}
      try { await releaseWorkspaceContainer(req.user.id, id); } catch {}

      const wsHostDir = path.join(WORKSPACE_DATA_DIR, id);
      if (existsSync(wsHostDir)) {
         rmSync(wsHostDir, { recursive: true, force: true });
      }

      res.json({ success: true });
   } catch (err: unknown) { 
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Delete Workspace Error]', err);
      res.status(500).json({ error: msg }); 
   }
});

router.post('/:id/snapshot', requireWorkspaceRole('admin'), async (req: WorkspaceAuthRequest, res: Response) => {
   const workspaceId = req.params.id as string;
   const userId = req.user?.id;
   if (!userId) return res.status(401).json({ error: 'Unauthorized' });

   const { label } = req.body as { label?: string };
   try {
      const snapshot = await createSnapshot(workspaceId, userId, label);
      res.status(201).json(snapshot);
   } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Snapshot] Create failed:', msg);
      res.status(500).json({ error: 'Failed to create snapshot' });
   }
});

router.get('/:id/snapshots', requireWorkspaceRole('viewer'), async (req: WorkspaceAuthRequest, res: Response) => {
   try {
      const snapshots = await listSnapshots(req.params.id as string);
      res.json(snapshots);
   } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
   }
});

router.get('/:id/snapshots/:snapshotId/files', requireWorkspaceRole('viewer'), async (req: WorkspaceAuthRequest, res: Response) => {
   const { id: workspaceId, snapshotId } = req.params as { id: string; snapshotId: string };
   try {
      const files = await getSnapshotFilesWithDiff(workspaceId, snapshotId);
      res.json(files);
   } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isNotFound = msg === 'Snapshot not found';
      res.status(isNotFound ? 404 : 500).json({ error: msg });
   }
});

router.post('/:id/snapshots/:snapshotId/restore', requireWorkspaceRole('admin'), async (req: WorkspaceAuthRequest, res: Response) => {
   const { id: workspaceId, snapshotId } = req.params as { id: string; snapshotId: string };
   try {
      const result = await restoreSnapshot(workspaceId, snapshotId);
      res.json(result);
   } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Snapshot] Restore failed:', msg);
      const isNotFound = msg === 'Snapshot not found';
      res.status(isNotFound ? 404 : 500).json({ error: 'Failed to restore snapshot' });
   }
});

router.get('/:id/collaborators', requireWorkspaceRole('viewer'), async (req: WorkspaceAuthRequest, res: Response) => {
   try {
      const collaborators = await workspaceRepository.getCollaborators(req.params.id as string);
      res.json(collaborators);
   } catch (err: unknown) { 
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg }); 
   }
});

router.post('/:id/collaborators', requireWorkspaceRole('admin'), async (req: WorkspaceAuthRequest, res: Response) => {
   try {
      const { usernameOrEmail, role } = req.body as { usernameOrEmail?: string; role?: string };
      if (!role || !['viewer', 'editor', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
      
      const user = await userRepository.findByUsernameOrEmail(usernameOrEmail || '', usernameOrEmail || '');
      if (!user) return res.status(404).json({ error: 'User not found' });
      
      const targetUserId = user.id;
      const ws = await workspaceRepository.findWorkspaceOwner(req.params.id as string);
      if (ws?.owner_id === targetUserId) return res.status(400).json({ error: 'Creator is implicitly admin' });

      const collaborator = await workspaceRepository.upsertCollaborator(req.params.id as string, targetUserId, role);
      res.json(collaborator);
   } catch (err: unknown) { 
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg }); 
   }
});

router.put('/:id/collaborators/:userId', requireWorkspaceRole('admin'), async (req: WorkspaceAuthRequest, res: Response) => {
   try {
      const role = req.body.role as string;
      if (!role || !['viewer', 'editor', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
      const updated = await workspaceRepository.updateCollaboratorRole(req.params.id as string, req.params.userId as string, role);
      updated ? res.json(updated) : res.status(404).json({ error: 'Not found' });
   } catch (err: unknown) { 
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg }); 
   }
});

router.delete('/:id/collaborators/:userId', requireWorkspaceRole('admin'), async (req: WorkspaceAuthRequest, res: Response) => {
   try {
      const success = await workspaceRepository.deleteCollaborator(req.params.id as string, req.params.userId as string);
      success ? res.json({ success: true }) : res.status(404).json({ error: 'Not found' });
   } catch (err: unknown) { 
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg }); 
   }
});

router.get('/:id/files', requireWorkspaceRole('viewer'), async (req: WorkspaceAuthRequest, res: Response) => {
   try {
      const files = await getWorkspaceFiles(req.params.id as string);
      res.json(files);
   } catch (err: unknown) { 
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg }); 
   }
});

router.post('/:id/files', requireWorkspaceRole('editor'), async (req: WorkspaceAuthRequest, res: Response) => {
   const workspaceId = req.params.id as string;
   try {
      const { name, type, parent_id, language } = req.body as { name?: string; type?: 'file' | 'directory'; parent_id?: string; language?: string };
      if (!name || !type || !['file', 'directory'].includes(type)) return res.status(400).json({ error: 'Invalid params' });

      const newFile = await createWorkspaceFile(workspaceId, name, type, parent_id || null, language);
      res.status(201).json(newFile);
   } catch (err: unknown) { 
      const pgErr = err as { code?: string; message?: string };
      res.status(pgErr.code === '23505' ? 400 : 500).json({ error: pgErr.code === '23505' ? 'Duplicate file name' : pgErr.message }); 
   }
});

router.get('/:id/files/:fileId/content', requireWorkspaceRole('viewer'), async (req: WorkspaceAuthRequest, res: Response) => {
   try {
      const content = await getFileContent(req.params.id as string, req.params.fileId as string);
      res.json({ content });
   } catch (err: unknown) { 
      const msg = err instanceof Error ? err.message : String(err);
      res.status(msg === 'File not found' ? 404 : 500).json({ error: msg }); 
   }
});

router.get('/:id/files/:fileId/history', requireWorkspaceRole('viewer'), async (req: WorkspaceAuthRequest, res: Response) => {
   try {
      const history = await getFileHistory(req.params.id as string, req.params.fileId as string);
      res.json(history);
   } catch (err: unknown) { 
      const msg = err instanceof Error ? err.message : String(err);
      const isNotFound = msg === 'File not found' || msg === 'No history found for this file';
      res.status(isNotFound ? 404 : 500).json({ error: msg }); 
   }
});

router.put('/:id/files/:fileId', requireWorkspaceRole('editor'), async (req: WorkspaceAuthRequest, res: Response) => {
   const workspaceId = req.params.id as string;
   const fileId = req.params.fileId as string;
   const { content } = req.body as { content?: string };
   try {
      await updateFileContent(workspaceId, fileId, content ?? '');
      res.json({ success: true });
   } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
   }
});

router.delete('/:id/files/:fileId', requireWorkspaceRole('editor'), async (req: WorkspaceAuthRequest, res: Response) => {
   const workspaceId = req.params.id as string;
   const fileId = req.params.fileId as string;
   try {
      await deleteWorkspaceFile(workspaceId, fileId);
      res.json({ success: true });
   } catch (err: unknown) { 
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg }); 
   }
});

router.get('/:id/files/:fileId/conflicts', requireWorkspaceRole('viewer'), async (req: WorkspaceAuthRequest, res: Response) => {
   try {
      const conflicts = await getFileConflicts(req.params.id as string, req.params.fileId as string);
      res.json(conflicts);
   } catch (err: unknown) { 
      const msg = err instanceof Error ? err.message : String(err);
      res.status(msg === 'File not found' ? 404 : 500).json({ error: msg }); 
   }
});

router.post('/:id/files/:fileId/conflicts/resolve', requireWorkspaceRole('editor'), async (req: WorkspaceAuthRequest, res: Response) => {
   const { id: workspaceId, fileId } = req.params as { id: string; fileId: string };
   const { resolvedContent } = req.body as { resolvedContent?: string };
   
   if (resolvedContent === undefined) return res.status(400).json({ error: 'Missing resolvedContent' });

   try {
      await resolveFileConflict(workspaceId, fileId, resolvedContent, req.user?.id);
      res.json({ success: true });
   } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(msg === 'File not found' ? 404 : 500).json({ error: msg });
   }
});

router.post('/:id/heartbeat', requireWorkspaceRole('viewer'), async (req: WorkspaceAuthRequest, res: Response) => {
   if (req.user) touchWorkspaceActivity(req.user.id, req.params.id as string);
   res.json({ success: true });
});

router.use('/:id/preview', requireWorkspaceRole('viewer'), (req, res, next) => {
   const url = new URL(req.originalUrl, `http://${req.headers.host || 'localhost'}`);
   const hasIdePrefix = url.pathname.startsWith('/ide');
   const prefix = hasIdePrefix ? '' : ((req.headers['x-forwarded-prefix'] as string) || (req.baseUrl?.startsWith('/ide') || req.headers.referer?.includes('/ide/') ? '/ide' : ''));
   if (req.query.token) { 
      res.cookie('preview_token', req.query.token, { path: '/', httpOnly: true, sameSite: 'lax' }); 
      url.searchParams.delete('token'); 
      return res.redirect(`${prefix}${url.pathname}${url.search}`); 
   }
   if (url.pathname.endsWith('/preview')) {
      return res.redirect(`${prefix}${url.pathname}/${url.search}`);
   }
   next();
}, createProxyMiddleware({
   target: 'http://localhost', changeOrigin: true, ws: false,
   router: (req: unknown) => {
      const anyReq = req as any;
      const reqUrl = anyReq.originalUrl || anyReq.url || '';
      const wsId = reqUrl.match(/\/api\/workspace\/([^\/]+)\/preview/)?.[1] || anyReq.params?.id;
      const userId = anyReq.user?.id;
      const ref = (userId && wsId ? getRunningContainerRef(userId, wsId) : null) || (wsId ? getRunningContainerRefByWorkspaceId(wsId) : null);
      const port = ref?.hostPort;
      return port ? `http://localhost:${port}` : 'http://localhost:1'; 
   },
   pathRewrite: (_p: string, req: unknown) => {
      const anyReq = req as any;
      const reqUrl = anyReq.originalUrl || anyReq.url || _p || '';
      const wsId = reqUrl.match(/\/api\/workspace\/([^\/]+)\/preview/)?.[1] || anyReq.params?.id;
      if (!wsId) return _p;
      const rewritten = _p.replace(new RegExp(`^.*\\/api\\/workspace\\/${wsId}\\/preview`), '');
      return rewritten === '' ? '/' : rewritten;
   },
   on: {
      error: (_err: unknown, _req: unknown, res: unknown) => {
         const httpRes = res as Response | undefined;
         if (httpRes && !httpRes.headersSent) {
            httpRes.writeHead(502, { 'Content-Type': 'text/html' });
            httpRes.end(PREVIEW_FALLBACK_HTML);
         }
      }
   }
}));

export default router;
