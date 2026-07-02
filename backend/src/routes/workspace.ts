import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { requireWorkspaceRole, WorkspaceAuthRequest } from '../middleware/workspaceAuth';
import { ZipArchive } from 'archiver';
import { executeCode } from '../sandbox/docker';
import { getPool } from '../db';
import { syncDeleteToTerminal, syncFolderToTerminal, syncFileToTerminal } from '../terminal/terminalHandler';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { getRunningContainerRef } from '../sandbox/workspaceContainer';
import { GoogleGenAI } from '@google/genai';

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
    let ws = await getPool().query('SELECT * FROM workspaces WHERE owner_id = $1 LIMIT 1', [req.user.id]);
    if (!ws.rows.length) ws = await getPool().query('INSERT INTO workspaces (owner_id, title) VALUES ($1, $2) RETURNING *', [req.user.id, 'My First Sandbox']);
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
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const ws = await getPool().query('SELECT owner_id FROM workspaces WHERE id = $1', [req.params.id]);
    if (!ws.rows.length) return res.status(404).json({ error: 'Not found' });
    if (ws.rows[0].owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    await getPool().query('DELETE FROM workspaces WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
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

    const newFile = await getPool().query('INSERT INTO files (workspace_id, name, type, parent_id, language) VALUES ($1, $2, $3, $4, $5) RETURNING id, parent_id, name, type, language', [id, name, type, parent_id || null, type === 'file' ? (language || 'javascript') : null]);
    
    // [ARCHITECTURE] Fire-and-Forget PTY Synchronization
    // Background sync to the active Docker container to keep the bash terminal perfectly mirrored 
    // without blocking the HTTP response latency for the editor UI.
    getPool().query(`
      WITH RECURSIVE cte AS (SELECT id, name::text as path FROM files WHERE workspace_id = $1 AND parent_id IS NULL UNION ALL SELECT f.id, (cte.path || '/' || f.name)::text FROM files f JOIN cte ON f.parent_id = cte.id WHERE f.workspace_id = $1)
      SELECT path FROM cte WHERE id = $2;`, [id, newFile.rows[0].id]
    ).then(res => {
      if (res.rows.length) type === 'directory' ? syncFolderToTerminal(id, res.rows[0].path).catch(()=>{}) : syncFileToTerminal(id, newFile.rows[0].id, '').catch(()=>{});
    }).catch(()=>{});

    res.status(201).json(newFile.rows[0]);
  } catch (err: any) { res.status(err.code === '23505' ? 400 : 500).json({ error: err.code === '23505' ? 'Duplicate file name' : err.message }); }
});

router.delete('/:id/files/:fileId', requireWorkspaceRole('editor'), async (req: WorkspaceAuthRequest, res: Response) => {
  const id = req.params.id as string;
  try {
    const pathResult = await getPool().query(`WITH RECURSIVE cte AS (SELECT id, name::text as path FROM files WHERE workspace_id = $1 AND parent_id IS NULL UNION ALL SELECT f.id, (cte.path || '/' || f.name)::text FROM files f JOIN cte ON f.parent_id = cte.id WHERE f.workspace_id = $1) SELECT path FROM cte WHERE id = $2;`, [id, req.params.fileId]);
    await getPool().query('DELETE FROM files WHERE id = $1 AND workspace_id = $2', [req.params.fileId, id]);
    if (pathResult.rows.length) syncDeleteToTerminal(id, pathResult.rows[0].path).catch(()=>{});
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// =============================================================================
// EXECUTION & SERVICES
// =============================================================================

// [SECURITY] Multi-Tenant Resource Guard
// Only Editors can trigger the execution engine. This guards against "Viewers" executing 
// infinite loops or memory bombs to disrupt the host server. 
router.post('/:id/execute', requireWorkspaceRole('editor'), async (req: WorkspaceAuthRequest, res: Response) => {
  const id = req.params.id as string;
  const { code, language, input, fileName, fileId } = req.body;
  if (!code || !language) return res.status(400).json({ error: 'Code and language required' });

  let workspaceFiles: any[] = [];
  let activeFilePath = fileName || 'index.js';

  try {
    const filesRes = await getPool().query(`WITH RECURSIVE cte AS (SELECT id, parent_id, name, type, content, name::text as path FROM files WHERE workspace_id = $1 AND parent_id IS NULL UNION ALL SELECT f.id, f.parent_id, f.name, f.type, f.content, (cte.path || '/' || f.name)::text FROM files f JOIN cte ON f.parent_id = cte.id WHERE f.workspace_id = $1) SELECT * FROM cte;`, [id]);
    workspaceFiles = filesRes.rows;
    if (fileId) {
      const idx = workspaceFiles.findIndex(f => f.id === fileId);
      if (idx !== -1) { workspaceFiles[idx].content = code; activeFilePath = workspaceFiles[idx].path; }
    }
  } catch (err) {} // Fail gracefully on hydration

  try {
    const r = await executeCode(code, language, input, { workspaceId: id, activeFilePath, workspaceFiles });
    const status = r.oomKilled ? 'failed' : r.exitCode === 137 ? 'timeout' : r.exitCode === 0 ? 'success' : 'failed';
    
    await getPool().query(`INSERT INTO execution_history (workspace_id, user_id, language, code_snapshot, output, status, duration_ms, memory_usage_bytes, cpu_usage_percent, file_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id, req.user?.id || null, language, code, r.output, status, Math.round(r.durationMs), r.memoryUsageBytes || 0, r.cpuUsagePercent || 0, fileName || null]).catch(()=>{});
    
    res.json({ output: r.output, metrics: { durationMs: r.durationMs, exitCode: r.exitCode, oomKilled: r.oomKilled, cpuUsagePercent: r.cpuUsagePercent, memoryUsageBytes: r.memoryUsageBytes }});
  } catch (e: any) {
    await getPool().query(`INSERT INTO execution_history (workspace_id, user_id, language, code_snapshot, output, status, duration_ms, memory_usage_bytes, cpu_usage_percent, file_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id, req.user?.id || null, language, code, e.message || String(e), 'error', 0, 0, 0, fileName || null]).catch(()=>{});
    res.status(500).json({ error: e.message || 'Execution failed' });
  }
});

router.get('/:id/execution-history', requireWorkspaceRole('viewer'), async (req: WorkspaceAuthRequest, res: Response) => {
  try {
    res.json((await getPool().query('SELECT eh.id, eh.user_id, u.username, eh.language, eh.status, eh.duration_ms, eh.memory_usage_bytes, eh.cpu_usage_percent, eh.file_name, eh.executed_at FROM execution_history eh LEFT JOIN users u ON eh.user_id = u.id WHERE eh.workspace_id = $1 ORDER BY eh.executed_at DESC LIMIT 10', [req.params.id])).rows);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});



// =============================================================================
// AI ASSISTANT & PREVIEW PROXY
// =============================================================================

router.post('/:id/autocomplete', requireWorkspaceRole('viewer'), async (req: WorkspaceAuthRequest, res: Response) => {
  try {
    const { prefix, suffix, language } = req.body;
    if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: 'API Key missing' });
    
    const response = await new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }).models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `<PREFIX>${prefix}<CURSOR><SUFFIX>${suffix || ''}</SUFFIX>`,
      config: { systemInstruction: `You are a strict code autocomplete engine...`, temperature: 0.1, stopSequences: ['\n\n\n', '<PREFIX>', '<SUFFIX>', '<CURSOR>'] }
    });
    
    // Cleanup AI artifacts
    let text = (response.text || '').replace(/<(THOUGHT|thought)>[\s\S]*?(<\/(THOUGHT|thought)>|$)/gi, '');
    res.json({ completion: text.replace(/^```[\w]*\n/, '').replace(/\n```$/, '').trimEnd() });
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
  on: { error: (err: any, req: any, res: any) => res?.writeHead?.(502, { 'Content-Type': 'text/plain' }).end('Web server inside sandbox is not running.') }
}));

export default router;