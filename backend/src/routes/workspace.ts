import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { requireWorkspaceRole, WorkspaceAuthRequest } from '../middleware/workspaceAuth';
import { ZipArchive } from 'archiver';
import { getPool } from '../db';
import { syncDeleteToTerminal, syncFolderToTerminal, syncFileToTerminal } from '../terminal/terminalHandler';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { getRunningContainerRef, touchWorkspaceActivity } from '../sandbox/workspaceContainer';
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
// AI ASSISTANT & PREVIEW PROXY
// =============================================================================

// [AFK MANAGEMENT] Idle Ping Tracker
// Called every 2 minutes by the frontend to keep the terminal container alive.
router.post('/:id/heartbeat', requireWorkspaceRole('viewer'), async (req: WorkspaceAuthRequest, res: Response) => {
  if (req.user) touchWorkspaceActivity(req.user.id, req.params.id as string);
  res.json({ success: true });
});

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