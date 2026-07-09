import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { requireWorkspaceRole, WorkspaceAuthRequest } from '../middleware/workspaceAuth';
import { ZipArchive } from 'archiver';
import { getPool } from '../db';
import { getSnapshotFiles, createWorkspaceSnapshot } from '../utils/snapshotManager.js';
import * as Y from 'yjs';
import { syncDeleteToTerminal, syncFolderToTerminal, syncFileToTerminal } from '../terminal/terminalHandler';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { getRunningContainerRef, touchWorkspaceActivity } from '../sandbox/workspaceContainer';
import { WORKSPACE_DATA_DIR } from '../sandbox/pool';
import * as path from 'path';
import { rmSync, existsSync } from 'fs';
import { Mistral } from '@mistralai/mistralai';
import { getIO } from '../socket';
import { saveBlob } from '../utils/gitObjects.js';
import { evictWorkspaceDocs } from '../docsRegistry.js';

const router = Router();

// =============================================================================
// WORKSPACE LIFECYCLE
// =============================================================================

// [PERFORMANCE] SQL Engine Optimization (UNION vs OR)
// INTERVIEW KEY: Using `WHERE owner_id = $1 OR user_id = $1` with a JOIN often confuses the PostgreSQL query 
// optimizer into doing a slow Full Table Scan. Splitting it into a UNION allows the DB to use targeted 
// Index Scans on both columns independently and perform a lightning-fast in-memory merge.
router.get('/', async (req: AuthRequest, res: Response) => {
  if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const workspaces = await getPool().query(
      `SELECT w.id, w.title, w.created_at, w.updated_at, w.owner_id, 'owner' AS user_role FROM workspaces w WHERE w.owner_id = $1 
       UNION 
       SELECT w.id, w.title, w.created_at, w.updated_at, w.owner_id, wc.role::text AS user_role FROM workspaces w 
       INNER JOIN workspace_collaborators wc ON w.id = wc.workspace_id WHERE wc.user_id = $1 ORDER BY updated_at DESC`,
      [req.user.id]
    );
    res.json(workspaces.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// [SECURITY] IDOR Mitigation & Upsert Pattern
// Handles both Creation and Renaming. Before allowing a rename (ID present), we verify the user is 
// actually the owner or an admin of *that specific workspace record*.
router.post('/', async (req: AuthRequest, res: Response) => {
  const { id, title } = req.body;
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  
  try {
    if (id) {
      const checkRes = await getPool().query('SELECT w.owner_id, wc.role FROM workspaces w LEFT JOIN workspace_collaborators wc ON w.id = wc.workspace_id AND wc.user_id = $2 WHERE w.id = $1', [id, userId]);
      if (!checkRes.rows.length) return res.status(404).json({ error: 'Not found' });
      if (checkRes.rows[0].owner_id !== userId && checkRes.rows[0].role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
      
      const result = await getPool().query('UPDATE workspaces SET title = $1 WHERE id = $2 RETURNING *', [title || 'Untitled', id]);
      return res.json(result.rows[0]);
    }
    const result = await getPool().query('INSERT INTO workspaces (owner_id, title) VALUES ($1, $2) RETURNING *', [userId, title || 'Untitled Project']);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// [UX/DX] Zero-Friction Onboarding Fallback
router.get('/default', async (req: AuthRequest, res: Response) => {
  if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
  try {
    let ws = await getPool().query('SELECT id, title, owner_id, is_public FROM workspaces WHERE owner_id = $1 LIMIT 1', [req.user.id]);
    if (!ws.rows.length) ws = await getPool().query('INSERT INTO workspaces (owner_id, title) VALUES ($1, $2) RETURNING id, title, owner_id, is_public', [req.user.id, 'My First Sandbox']);
    res.json(ws.rows[0]);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// [ARCHITECTURE] Context Propagation
// Downstream RBAC middleware attaches `req.workspaceRole` which we pipe directly to the client UI.
router.get('/:id', requireWorkspaceRole('viewer'), async (req: WorkspaceAuthRequest, res: Response) => {
  try {
    const ws = await getPool().query('SELECT id, title, owner_id, is_public FROM workspaces WHERE id = $1', [req.params.id]);
    if (!ws.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ ...ws.rows[0], userRole: req.workspaceRole });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// [MEMORY MANAGEMENT] Streamed Archive Piping
// We do NOT write the zip to disk. We use a Recursive CTE to flatten the hierarchical file tree, 
// inject the buffers into `archiver`, and pipe it directly to the HTTP response socket.
router.get('/:id/export', requireWorkspaceRole('viewer'), async (req: WorkspaceAuthRequest, res: Response) => {
  try {
    const ws = await getPool().query('SELECT title FROM workspaces WHERE id = $1', [req.params.id]);
    if (!ws.rows.length) return res.status(404).json({ error: 'Not found' });
    
    const filesRes = await getPool().query(`
      WITH RECURSIVE file_path_cte AS (
        SELECT id, parent_id, name, type, content, name::text as path FROM files WHERE workspace_id = $1 AND parent_id IS NULL
        UNION ALL
        SELECT f.id, f.parent_id, f.name, f.type, f.content, (cte.path || '/' || f.name)::text as path FROM files f INNER JOIN file_path_cte cte ON f.parent_id = cte.id WHERE f.workspace_id = $1
      ) SELECT path, content FROM file_path_cte WHERE type = 'file';`, [req.params.id]);

    res.attachment(`${ws.rows[0].title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.zip`);
    // @ts-ignore
    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.pipe(res);
    filesRes.rows.forEach(f => archive.append(f.content || '', { name: f.path }));
    archive.finalize();
  } catch (err: any) { if (!res.headersSent) res.status(500).json({ error: err.message }); }
});

// [DATA INTEGRITY] Cascading Deletes
// By deleting the root workspace row, PostgreSQL's ON DELETE CASCADE constraint automatically 
// annihilates all orphaned rows in `files` and `workspace_collaborators` in a single atomic transaction.
// Additionally, we synchronously delete the workspace's physical host directory from workspace_data/
// to prevent disk bloat from orphaned bind-mount folders.
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
  const id = req.params.id as string;
  try {
    const ws = await getPool().query('SELECT owner_id FROM workspaces WHERE id = $1', [id]);
    if (!ws.rows.length) return res.status(404).json({ error: 'Not found' });
    if (ws.rows[0].owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    await getPool().query('DELETE FROM workspaces WHERE id = $1', [id]);

    // [STORAGE CLEANUP] Remove host-side bind mount directory
    // The SQL cascade handles DB rows. We must manually delete the physical workspace folder
    // on the host machine to prevent workspace_data/ from accumulating orphaned directories.
    const wsHostDir = path.join(WORKSPACE_DATA_DIR, id);
    if (existsSync(wsHostDir)) {
      rmSync(wsHostDir, { recursive: true, force: true });
    }

    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// =============================================================================
// WORKSPACE SNAPSHOTTING (Time-Travel, Read-only History)
// =============================================================================

// [ARCHITECTURE] Snapshot Design
// Rather than cloning the entire workspace into a new workspaces row (expensive,
// clutters the dashboard), snapshots are stored in the dedicated `workspace_snapshots`
// + `snapshot_files` tables. The files are captured as a flattened path→content map
// at the moment of snapshotting. The DB trigger `enforce_snapshot_limit` automatically
// evicts the oldest snapshot when the count exceeds 10, keeping storage bounded.
//
// RBAC:
//   - Create snapshot  → admin only
//   - List snapshots   → viewer+  (all roles can browse history)
//   - Preview files    → viewer+  (all roles can read snapshot files + diff)
//   - Restore snapshot → admin only

// POST /:id/snapshot — create a new snapshot (admin only)
router.post('/:id/snapshot', requireWorkspaceRole('admin'), async (req: WorkspaceAuthRequest, res: Response) => {
  const workspaceId = req.params.id as string;
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { label } = req.body;
  const snapshotLabel = (label as string)?.trim() || `Snapshot ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;

  try {
    const snapshot = await createWorkspaceSnapshot(workspaceId, userId, snapshotLabel);
    res.status(201).json(snapshot);
  } catch (err: any) {
    console.error('[Snapshot] Create failed:', err.message);
    res.status(500).json({ error: 'Failed to create snapshot' });
  }
});

// GET /:id/snapshots — list all snapshots for a workspace (viewer+)
router.get('/:id/snapshots', requireWorkspaceRole('viewer'), async (req: WorkspaceAuthRequest, res: Response) => {
  try {
    const result = await getPool().query(
      `SELECT c.hash as id, c.message as label, c.created_at, u.username AS created_by
       FROM git_commits c
       LEFT JOIN users u ON c.author_id = u.id
       WHERE c.workspace_id = $1
       ORDER BY c.created_at DESC
       LIMIT 10`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:id/snapshots/:snapshotId/files — get all files in a snapshot with diff vs current (viewer+)
router.get('/:id/snapshots/:snapshotId/files', requireWorkspaceRole('viewer'), async (req: WorkspaceAuthRequest, res: Response) => {
  const { id: workspaceId, snapshotId } = req.params as { id: string; snapshotId: string };
  try {
    const snapFiles = await getSnapshotFiles(workspaceId, snapshotId);
    if (!snapFiles) return res.status(404).json({ error: 'Snapshot not found' });

    // Fetch live files to compare
    const liveFilesRes = await getPool().query(`
      WITH RECURSIVE file_path_cte AS (
        SELECT id, parent_id, name, type, content, language, name::text AS path
        FROM files WHERE workspace_id = $1 AND parent_id IS NULL
        UNION ALL
        SELECT f.id, f.parent_id, f.name, f.type, f.content, f.language,
               (cte.path || '/' || f.name)::text AS path
        FROM files f
        INNER JOIN file_path_cte cte ON f.parent_id = cte.id
        WHERE f.workspace_id = $1
      )
      SELECT path, content, language FROM file_path_cte WHERE type = 'file';
    `, [workspaceId]);

    const liveMap = new Map<string, string>();
    const liveLangMap = new Map<string, string>();
    for (const row of liveFilesRes.rows) {
      liveMap.set(row.path, row.content || '');
      liveLangMap.set(row.path, row.language || '');
    }

    const diffs = [];
    const processedPaths = new Set<string>();

    for (const f of snapFiles) {
      processedPaths.add(f.path);
      diffs.push({
        path: f.path,
        language: f.language,
        snapshot_content: f.content ?? '',
        live_content: liveMap.get(f.path) ?? null,
      });
    }

    for (const [path, content] of liveMap.entries()) {
      if (!processedPaths.has(path)) {
        diffs.push({
          path,
          language: liveLangMap.get(path),
          snapshot_content: null, // null = didn't exist at snapshot
          live_content: content,
        });
      }
    }

    res.json(diffs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:id/snapshots/:snapshotId/restore — restore workspace files to snapshot state (admin only)
router.post('/:id/snapshots/:snapshotId/restore', requireWorkspaceRole('admin'), async (req: WorkspaceAuthRequest, res: Response) => {
  const { id: workspaceId, snapshotId } = req.params as { id: string; snapshotId: string };
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');

    const snapFiles = await getSnapshotFiles(workspaceId, snapshotId);
    if (!snapFiles) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Snapshot not found' });
    }

    // Build a path->id map for live files so we know which to update vs insert
    const liveFilesRes = await client.query(`
      WITH RECURSIVE file_path_cte AS (
        SELECT id, parent_id, name, type, name::text AS path
        FROM files WHERE workspace_id = $1 AND parent_id IS NULL
        UNION ALL
        SELECT f.id, f.parent_id, f.name, f.type, (cte.path || '/' || f.name)::text AS path
        FROM files f
        INNER JOIN file_path_cte cte ON f.parent_id = cte.id
        WHERE f.workspace_id = $1
      )
      SELECT id, path, type FROM file_path_cte;
    `, [workspaceId]);

    const liveFiles = new Map<string, string>(); // path -> id
    for (const row of liveFilesRes.rows) {
      liveFiles.set(row.path, row.id);
    }

    // Helper: Ensure parent directories exist
    async function ensureParentDirs(fullPath: string): Promise<string | null> {
      const parts = fullPath.split('/');
      parts.pop(); // remove file name
      if (parts.length === 0) return null; // root level
      
      let currentPath = '';
      let parentId: string | null = null;
      
      for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        if (liveFiles.has(currentPath)) {
          parentId = liveFiles.get(currentPath)!;
        } else {
          const dirResult = await client.query(
            'INSERT INTO files (workspace_id, parent_id, name, type) VALUES ($1, $2, $3, $4) RETURNING id',
            [workspaceId, parentId, part, 'directory']
          );
          parentId = dirResult.rows[0].id;
          liveFiles.set(currentPath, parentId);
        }
      }
      return parentId;
    }

    const restoredFilesForLiveDocs = [];

    // For each snapshot file, restore its content
    for (const snapFile of snapFiles) {
      const snapFileHash = await saveBlob(Buffer.from(snapFile.content ?? ''), snapFile.content ?? '');
      if (liveFiles.has(snapFile.path)) {
        // Update existing, setting yjs_state = NULL and updating blob_hash
        const fileId = liveFiles.get(snapFile.path)!;
        await client.query(
          'UPDATE files SET content = $1, yjs_state = NULL, blob_hash = $2 WHERE id = $3',
          [snapFile.content, snapFileHash, fileId]
        );
        restoredFilesForLiveDocs.push({ fileId, content: snapFile.content ?? '' });
      } else {
        // Insert new, setting yjs_state = NULL and updating blob_hash
        const parentId = await ensureParentDirs(snapFile.path);
        const fileName = snapFile.path.split('/').pop()!;
        const insResult = await client.query(
          'INSERT INTO files (workspace_id, parent_id, name, type, content, language, yjs_state, blob_hash) VALUES ($1, $2, $3, $4, $5, $6, NULL, $7) RETURNING id',
          [workspaceId, parentId, fileName, 'file', snapFile.content, snapFile.language, snapFileHash]
        );
        const newFileId = insResult.rows[0].id;
        liveFiles.set(snapFile.path, newFileId);
        restoredFilesForLiveDocs.push({ fileId: newFileId, content: snapFile.content ?? '' });
      }
    }

    await client.query('COMMIT');

    // Push the changes to any active live Yjs docs to keep them in sync
    try {
      const { applyRestoredContentToLiveDocs } = await import('../docsRegistry.js');
      await applyRestoredContentToLiveDocs(workspaceId, restoredFilesForLiveDocs);
    } catch (e) {
      console.warn("Could not apply to live docs", e);
    }

    // Invalidate caches
    try {
      const [redisCache, yjsCache] = await Promise.all([
        import('../utils/redisCache.js'),
        import('../utils/yjsCache.js')
      ]);
      await redisCache.workspaceCache.delete(workspaceId);
      for (const id of liveFiles.values()) {
        await yjsCache.deleteYjsStateFromCache(id);
        await redisCache.fileContentCache.delete(`${id}`);
      }
    } catch(e) {
      console.warn("Could not clear cache", e);
    }

    // Notify clients to reload
    const io = (await import('../socket.js')).getIO();
    if (io) {
      io.to(`presence-${workspaceId}`).emit('snapshot-restored', { snapshotId });
    }

    res.json({ success: true, message: 'Snapshot restored successfully', restored_files: snapFiles.length });
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[Snapshot] Restore failed:', err.message);
    res.status(500).json({ error: 'Failed to restore snapshot' });
  } finally {
    client.release();
  }
});

// =============================================================================
// COLLABORATORS
// =============================================================================

router.get('/:id/collaborators', requireWorkspaceRole('viewer'), async (req: WorkspaceAuthRequest, res: Response) => {
  try {
    const result = await getPool().query('SELECT u.id, u.username, u.email, wc.role, wc.joined_at FROM workspace_collaborators wc JOIN users u ON wc.user_id = u.id WHERE wc.workspace_id = $1 ORDER BY wc.joined_at ASC', [req.params.id]);
    res.json(result.rows);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// [DATA INTEGRITY] Database-level Atomic Upserts (ON CONFLICT)
// Eliminates Node.js "Read-Modify-Write" race conditions when users are rapidly granted/changed permissions.
router.post('/:id/collaborators', requireWorkspaceRole('admin'), async (req: WorkspaceAuthRequest, res: Response) => {
  try {
    const { usernameOrEmail, role } = req.body;
    if (!['viewer', 'editor', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    
    const userRes = await getPool().query('SELECT id FROM users WHERE username = $1 OR email = $1', [usernameOrEmail]);
    if (!userRes.rows.length) return res.status(404).json({ error: 'User not found' });
    
    const targetUserId = userRes.rows[0].id;
    const wsRes = await getPool().query('SELECT owner_id FROM workspaces WHERE id = $1', [req.params.id]);
    if (wsRes.rows[0].owner_id === targetUserId) return res.status(400).json({ error: 'Creator is implicitly admin' });

    const result = await getPool().query(`INSERT INTO workspace_collaborators (workspace_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role RETURNING *`, [req.params.id, targetUserId, role]);
    res.json(result.rows[0]);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put('/:id/collaborators/:userId', requireWorkspaceRole('admin'), async (req: WorkspaceAuthRequest, res: Response) => {
  try {
    if (!['viewer', 'editor', 'admin'].includes(req.body.role)) return res.status(400).json({ error: 'Invalid role' });
    const result = await getPool().query('UPDATE workspace_collaborators SET role = $1 WHERE workspace_id = $2 AND user_id = $3 RETURNING *', [req.body.role, req.params.id, req.params.userId]);
    result.rows.length ? res.json(result.rows[0]) : res.status(404).json({ error: 'Not found' });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id/collaborators/:userId', requireWorkspaceRole('admin'), async (req: WorkspaceAuthRequest, res: Response) => {
  try {
    const result = await getPool().query('DELETE FROM workspace_collaborators WHERE workspace_id = $1 AND user_id = $2 RETURNING *', [req.params.id, req.params.userId]);
    result.rows.length ? res.json({ success: true }) : res.status(404).json({ error: 'Not found' });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// =============================================================================
// FILE TREE
// =============================================================================

router.get('/:id/files', requireWorkspaceRole('viewer'), async (req: WorkspaceAuthRequest, res: Response) => {
  try {
    const files = await getPool().query('SELECT id, parent_id, name, type, language FROM files WHERE workspace_id = $1 ORDER BY type DESC, name ASC', [req.params.id]);
    res.json(files.rows);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// [ERROR HANDLING] Database Error Code Interception
// We intercept Postgres code 23505 (Unique Violation) to return a clean client error 
// rather than leaking a raw stack trace when a user creates a duplicate file.
router.post('/:id/files', requireWorkspaceRole('editor'), async (req: WorkspaceAuthRequest, res: Response) => {
  const id = req.params.id as string;
  try {
    const { name, type, parent_id, language } = req.body;
    if (!name || !['file', 'directory'].includes(type)) return res.status(400).json({ error: 'Invalid params' });

    // For new files, write an initial empty Yjs state to the DB immediately so that
    // bindState always finds a valid (empty) doc to load from — even if the first
    // keystroke hasn't debounced and saved yet. Without this, a collaborator who opens
    // the file in the window before the first save gets an uninitialized doc that may
    // not merge cleanly with the author's in-memory doc, causing stuck/empty editors.
    let initialYjsState: Buffer | null = null;
    let blobHash: string | null = null;
    if (type === 'file') {
      const emptyDoc = new Y.Doc();
      initialYjsState = Buffer.from(Y.encodeStateAsUpdate(emptyDoc));
      emptyDoc.destroy();
      blobHash = await saveBlob(Buffer.from(''), '');
    }

    const newFile = await getPool().query(
      'INSERT INTO files (workspace_id, name, type, parent_id, language, content, yjs_state, blob_hash) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, parent_id, name, type, language',
      [id, name, type, parent_id || null, type === 'file' ? (language || 'javascript') : null, '', initialYjsState, blobHash]
    );

    // Fire-and-forget PTY sync to keep the container file system mirrored
    getPool().query(`
      WITH RECURSIVE cte AS (SELECT id, name::text as path FROM files WHERE workspace_id = $1 AND parent_id IS NULL UNION ALL SELECT f.id, (cte.path || '/' || f.name)::text FROM files f JOIN cte ON f.parent_id = cte.id WHERE f.workspace_id = $1)
      SELECT path FROM cte WHERE id = $2;`, [id, newFile.rows[0].id]
    ).then(r => {
      if (r.rows.length) type === 'directory' ? syncFolderToTerminal(id, r.rows[0].path).catch(()=>{}) : syncFileToTerminal(id, newFile.rows[0].id, '').catch(()=>{});
    }).catch(()=>{});

    getIO()?.to(`presence-${id}`).emit('file-tree-update');
    res.status(201).json(newFile.rows[0]);
  } catch (err: any) { res.status(err.code === '23505' ? 400 : 500).json({ error: err.code === '23505' ? 'Duplicate file name' : err.message }); }
});

// GET file content — used as a fallback by CodeEditor when Yjs sync is slow or stuck.
// Returns the latest content from DB so the client can force-apply it to the local doc.
router.get('/:id/files/:fileId/content', requireWorkspaceRole('viewer'), async (req: WorkspaceAuthRequest, res: Response) => {
  try {
    const { fileContentCache } = await import('../utils/redisCache.js');
    
    const fetchFn = async () => {
      const result = await getPool().query('SELECT content FROM files WHERE id = $1 AND workspace_id = $2', [req.params.fileId, req.params.id]);
      if (!result.rows.length) throw new Error('File not found');
      return result.rows[0].content || '';
    };

    const content = process.env.NODE_ENV === 'test'
      ? await fetchFn()
      : await fileContentCache.getOrFetch(`${req.params.fileId}`, fetchFn, 5 * 60);
    
    res.json({ content });
  } catch (err: any) { 
    res.status(err.message === 'File not found' ? 404 : 500).json({ error: err.message }); 
  }
});

// GET file history — returns either the ordered Yjs update stream (full fidelity)
// or the final merged yjs_state (legacy/approximate), plus the author map.
// Response: { authorMap, updates?: base64[], yjsState?: base64 }
router.get('/:id/files/:fileId/history', requireWorkspaceRole('viewer'), async (req: WorkspaceAuthRequest, res: Response) => {
  try {
    const fileId = req.params.fileId;
    const workspaceId = req.params.id;
    const { yjsStateCache } = await import('../utils/redisCache.js');

    const fetchHistoryFn = async () => {
      const result = await getPool().query(
        'SELECT yjs_state, author_map FROM files WHERE id = $1 AND workspace_id = $2',
        [fileId, workspaceId]
      );
      if (!result.rows.length) throw new Error('File not found');
      return result.rows[0];
    };

    const cached = process.env.NODE_ENV === 'test'
      ? await fetchHistoryFn()
      : await yjsStateCache.getOrFetch(`${fileId}:history`, fetchHistoryFn, 10 * 60);
    
    if (!cached) return res.status(404).json({ error: 'File not found' });

    const yjsState: Buffer | null = cached.yjs_state;
    if (!yjsState) return res.status(404).json({ error: 'No history found for this file' });

    // Merge in any author data currently live in the in-memory doc
    const authorMap: Record<string, { userId: string; username: string; color: string }> =
      cached.author_map || {};

    try {
      const docName = `${workspaceId}-${fileId}`;
      const { getDocsMap } = await import('../docsRegistry.js');
      const docsMap = getDocsMap();
      if (docsMap.has(docName)) {
        const liveDoc = await docsMap.get(docName)!;
        for (const [clientId, info] of liveDoc.authorMap.entries()) {
          authorMap[String(clientId)] = info;
        }
      }
    } catch { /* best-effort */ }

    // Try to return the full ordered update stream for exact replay.
    // If file_updates has entries for this file, use them (full fidelity mode).
    // Otherwise fall back to the merged yjsState (legacy/approximate mode).
    try {
      const updatesResult = await getPool().query(
        'SELECT update FROM file_updates WHERE file_id = $1 ORDER BY seq ASC',
        [fileId]
      );

      if (updatesResult.rows.length > 0) {
        const updates = updatesResult.rows.map(
          (r: { update: Buffer }) => r.update.toString('base64')
        );
        return res.json({ authorMap, updates });
      }
    } catch { /* table might not exist yet on older deploys — fall through */ }

    // Fallback: return the merged state
    res.json({
      yjsState: yjsState.toString('base64'),
      authorMap,
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put('/:id/files/:fileId', requireWorkspaceRole('editor'), async (req: WorkspaceAuthRequest, res: Response) => {
  const workspaceId = req.params.id as string;
  const fileId = req.params.fileId as string;
  const { content } = req.body;
  try {
    const fileContent = content ?? '';
    const blobHash = await saveBlob(Buffer.from(fileContent), fileContent);
    await getPool().query('UPDATE files SET content = $1, blob_hash = $2, updated_at = NOW() WHERE id = $3 AND workspace_id = $4', [fileContent, blobHash, fileId, workspaceId]);
    
    // Push the changes to any active live Yjs docs to keep them in sync
    const { applyRestoredContentToLiveDocs } = await import('../docsRegistry.js');
    await applyRestoredContentToLiveDocs(workspaceId, [{ fileId, content: content ?? '' }]);
    
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/files/:fileId', requireWorkspaceRole('editor'), async (req: WorkspaceAuthRequest, res: Response) => {
  const id = req.params.id as string;
  try {
    const pathResult = await getPool().query(`WITH RECURSIVE cte AS (SELECT id, name::text as path FROM files WHERE workspace_id = $1 AND parent_id IS NULL UNION ALL SELECT f.id, (cte.path || '/' || f.name)::text FROM files f JOIN cte ON f.parent_id = cte.id WHERE f.workspace_id = $1) SELECT path FROM cte WHERE id = $2;`, [id, req.params.fileId]);
    await getPool().query('DELETE FROM files WHERE id = $1 AND workspace_id = $2', [req.params.fileId, id]);
    if (pathResult.rows.length) syncDeleteToTerminal(id, pathResult.rows[0].path).catch(()=>{});
    getIO()?.to(`presence-${id}`).emit('file-tree-update');
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// =============================================================================
// GIT MERGE CONFLICT RESOLVER
// =============================================================================

import { parseConflicts } from '../utils/conflictParser.js';

router.get('/:id/files/:fileId/conflicts', requireWorkspaceRole('viewer'), async (req: WorkspaceAuthRequest, res: Response) => {
  try {
    const result = await getPool().query('SELECT content FROM files WHERE id = $1 AND workspace_id = $2', [req.params.fileId, req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'File not found' });
    
    const content = result.rows[0].content || '';
    const conflicts = parseConflicts(content);
    
    const hasConflicts = conflicts.some(c => c.type === 'conflict');
    res.json({ hasConflicts, conflicts });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/files/:fileId/conflicts/resolve', requireWorkspaceRole('editor'), async (req: WorkspaceAuthRequest, res: Response) => {
  const { id: workspaceId, fileId } = req.params as { id: string; fileId: string };
  const { resolvedContent } = req.body;
  
  if (resolvedContent === undefined) return res.status(400).json({ error: 'Missing resolvedContent' });

  const client = await getPool().connect();
  try {
    const fileRes = await client.query('SELECT name FROM files WHERE id = $1 AND workspace_id = $2', [fileId, workspaceId]);
    if (!fileRes.rows.length) return res.status(404).json({ error: 'File not found' });

    await client.query('BEGIN');
    
    // 1. Update the raw content in the database directly
    await client.query(
      'UPDATE files SET content = $1, updated_at = NOW() WHERE id = $2',
      [resolvedContent, fileId]
    );

    await client.query('COMMIT');

    // 2. Mutate the live Yjs documents so the server CRDT overwrites the client CRDT.
    // Done after COMMIT so a failure here cannot roll back the DB write.
    // Wrapped so any WS send error on a just-closed client cannot crash the response.
    try {
      const { applyRestoredContentToLiveDocs } = await import('../docsRegistry.js');
      await applyRestoredContentToLiveDocs(workspaceId, [{ fileId, content: resolvedContent }]);
    } catch (yjsErr: any) {
      console.error('[ConflictResolver] Yjs broadcast error (non-fatal):', yjsErr.message);
    }

    // 3. Resolve file path for git add
    const pathResult = await client.query(`
      WITH RECURSIVE file_path_cte AS (
        SELECT id, parent_id, name, type, name::text AS path
        FROM files WHERE workspace_id = $1 AND parent_id IS NULL
        UNION ALL
        SELECT f.id, f.parent_id, f.name, f.type,
               (cte.path || '/' || f.name)::text AS path
        FROM files f
        INNER JOIN file_path_cte cte ON f.parent_id = cte.id
        WHERE f.workspace_id = $1
      )
      SELECT path FROM file_path_cte WHERE id = $2;
    `, [workspaceId, fileId]);

    if (pathResult.rows.length) {
      const filePath = pathResult.rows[0].path;
      // 4. Run `git add` in container
      const { getRunningContainer } = await import('../sandbox/workspaceContainer.js');
      const userId = req.user?.id;
      if (userId) {
         try {
           const container = getRunningContainer(userId, workspaceId);
           if (container) {
             const exec = await container.exec({
               Cmd: ['git', 'add', filePath],
               WorkingDir: `/workspaces/${workspaceId}`
             });
             await exec.start({ Detach: true });
             console.log(`[ConflictResolver] Git added ${filePath}`);
           }
         } catch(e) {
           console.error('[ConflictResolver] git add failed:', e);
         }
      }
    }
    
    // Broadcast resolve event to all clients in this workspace
    getIO()?.to(`presence-${workspaceId}`).emit('conflict-resolved', { 
      workspaceId,
      fileId
    });

    res.json({ success: true });
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// AI ASSISTANT & PREVIEW PROXY
// =============================================================================

// [AFK MANAGEMENT] Idle Ping Tracker
// Called every 2 minutes by the frontend to keep the terminal container alive.
router.post('/:id/heartbeat', requireWorkspaceRole('viewer'), async (req: WorkspaceAuthRequest, res: Response) => {
  if (req.user) touchWorkspaceActivity(req.user.id, req.params.id as string);
  res.json({ success: true });
});

router.get('/:id/autocomplete/health', requireWorkspaceRole('viewer'), async (_req: WorkspaceAuthRequest, res: Response) => {
  const model = process.env.MISTRAL_AUTOCOMPLETE_MODEL || 'codestral-latest';
  const mistralApiKeyLoaded = !!process.env.MISTRAL_API_KEY;

  if (!mistralApiKeyLoaded) {
    return res.status(503).json({ ok: false, error: 'MISTRAL API key missing', model });
  }

  res.json({ ok: true, mistralApiKeyLoaded, model });
});

router.post('/:id/autocomplete', requireWorkspaceRole('viewer'), async (req: WorkspaceAuthRequest, res: Response) => {
  try {
    const { prefix, suffix } = req.body;
    const mistralApiKey = process.env.MISTRAL_API_KEY;
    if (!mistralApiKey) return res.status(503).json({ error: 'MISTRAL API key missing' });

    const mistralClient = new Mistral({ apiKey: mistralApiKey });
    const completion = await mistralClient.fim.complete({
      model: process.env.MISTRAL_AUTOCOMPLETE_MODEL || 'codestral-latest',
      prompt: prefix,
      suffix: suffix || '',
      temperature: 0.2,
      maxTokens: 100,
    });

    const completionContent = completion.choices[0]?.message?.content;
    const completionText = Array.isArray(completionContent)
      ? completionContent.map(chunk => ('text' in chunk ? chunk.text : '')).join('')
      : (completionContent || '');

    res.json({ completion: completionText.replace(/^```[\w]*\n/, '').replace(/\n```$/, '').trimEnd() });
  } catch (err: any) { res.status(500).json({ error: 'Generation failed' }); }
});

// [ARCHITECTURE] Reverse Proxy Middleware
// Maps traffic dynamically from /api/workspace/:id/preview to the ephemeral `hostPort` of 
// the active Docker container holding the users session.
router.use('/:id/preview', requireWorkspaceRole('viewer'), (req, res, next) => {
  let url = new URL(req.originalUrl, `http://${req.headers.host}`);
  if (req.query.token) { res.cookie('preview_token', req.query.token, { path: '/', httpOnly: true, sameSite: 'lax' }); url.searchParams.delete('token'); return res.redirect(url.pathname + url.search); }
  if (url.pathname === `/api/workspace/${req.params.id}/preview`) return res.redirect(url.pathname + '/');
  next();
}, createProxyMiddleware({
  target: 'http://localhost', changeOrigin: true, ws: false,
  router: (req: any) => {
    const wsId = req.originalUrl.match(/^\/api\/workspace\/([^\/]+)\/preview/)?.[1];
    const port = wsId && req.user?.id ? getRunningContainerRef(req.user.id, wsId)?.hostPort : null;
    return port ? `http://localhost:${port}` : 'http://localhost:1'; 
  },
  pathRewrite: (p, req: any) => p.replace(new RegExp(`^/api/workspace/${req.originalUrl.match(/^\/api\/workspace\/([^\/]+)\/preview/)?.[1]}/preview`), ''),
  on: {
    error: (err: any, req: any, res: any) => {
      if (res && !res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/html' });
        res.end(PREVIEW_FALLBACK_HTML);
      }
    }
  }
}));

const PREVIEW_FALLBACK_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sandbox Server Not Started | NexusIDE</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&family=JetBrains+Mono:wght@400;700&display=swap');
    :root {
      --bg: #07060b;
      --card-bg: rgba(25, 22, 40, 0.4);
      --border: rgba(147, 51, 234, 0.15);
      --text: #e2e8f0;
      --text-muted: #94a3b8;
      --purple: #a855f7;
      --purple-hover: #c084fc;
    }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: 'Outfit', sans-serif;
      margin: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      overflow: hidden;
    }
    .container {
      background: var(--card-bg);
      border: 1px solid var(--border);
      backdrop-filter: blur(16px);
      border-radius: 20px;
      padding: 40px;
      max-width: 480px;
      width: 90%;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.05);
      text-align: center;
    }
    .icon {
      font-size: 48px;
      margin-bottom: 20px;
      display: inline-block;
      animation: pulse 2s infinite ease-in-out;
    }
    h1 {
      font-size: 24px;
      font-weight: 700;
      margin: 0 0 10px 0;
      background: linear-gradient(135deg, #fff 0%, var(--purple) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p {
      color: var(--text-muted);
      font-size: 15px;
      line-height: 1.6;
      margin: 0 0 24px 0;
    }
    .instructions {
      text-align: left;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .instructions h2 {
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin: 0 0 12px 0;
      color: var(--purple);
    }
    .instructions p {
      font-size: 13px;
      margin: 0 0 8px 0;
      color: var(--text);
    }
    code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      background: rgba(168, 85, 247, 0.1);
      color: var(--purple-hover);
      padding: 4px 8px;
      border-radius: 6px;
      display: block;
      word-break: break-all;
      margin-top: 6px;
      border: 1px solid rgba(168, 85, 247, 0.15);
    }
    .btn {
      display: inline-block;
      background: var(--purple);
      color: #fff;
      text-decoration: none;
      padding: 12px 24px;
      border-radius: 10px;
      font-weight: 600;
      font-size: 14px;
      transition: background 0.2s;
    }
    .btn:hover {
      background: var(--purple-hover);
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.05); opacity: 0.8; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">🔌</div>
    <h1>Preview Server Offline</h1>
    <p>We could not reach any active web server running on port 3000 inside your sandbox container.</p>
    
    <div class="instructions">
      <h2>How to start your app</h2>
      <p>1. Open the IDE terminal panel.</p>
      <p>2. Launch a web application on port 3000:</p>
      <code>npx http-server -p 3000</code>
      <code>npm run dev -- --port 3000</code>
    </div>
    
    <a href="#" onclick="window.location.reload()" class="btn">Refresh Preview</a>
  </div>
</body>
</html>`;

export default router;
