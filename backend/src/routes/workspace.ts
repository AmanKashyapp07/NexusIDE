import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { executeCode } from '../sandbox/docker';
import { getPool } from '../db';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

const execFilePromise = promisify(execFile);

const router = Router();

// Get all workspaces for the authenticated user
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    
    const workspaces = await getPool().query(
      'SELECT id, title, created_at, updated_at FROM workspaces WHERE owner_id = $1 ORDER BY updated_at DESC',
      [userId]
    );
    res.json(workspaces.rows);
  } catch (err: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Create or get workspace
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { id, title } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    
    try {
      let result;
      if (id) {
        // Upsert by ID
        result = await getPool().query(
          `INSERT INTO workspaces (id, owner_id, title) 
           VALUES ($1, $2, $3)
           ON CONFLICT (id) DO UPDATE 
           SET title = EXCLUDED.title
           RETURNING *`,
          [id, userId, title || 'Untitled Project']
        );
      } else {
        result = await getPool().query(
          `INSERT INTO workspaces (owner_id, title) 
           VALUES ($1, $2)
           RETURNING *`,
          [userId, title || 'Untitled Project']
        );
        
        // Auto-create a default index.js file for new workspaces
        if (result.rows.length > 0) {
          await getPool().query(
            `INSERT INTO files (workspace_id, name, type, language, content) VALUES ($1, $2, $3, $4, $5)`,
            [result.rows[0].id, 'index.js', 'file', 'javascript', '']
          );
        }
      }
      
      res.json(result.rows[0]);
    } catch (dbError) {
      console.warn("Database connection failed, falling back to dummy workspace response:", dbError);
      res.status(500).json({ error: 'Database error' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get workspace by ID
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const wsResult = await getPool().query('SELECT id, title, owner_id FROM workspaces WHERE id = $1', [id]);
    
    if (wsResult.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    
    res.json(wsResult.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete workspace
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    
    // Make sure the user owns the workspace before deleting
    const wsResult = await getPool().query('SELECT owner_id FROM workspaces WHERE id = $1', [id]);
    
    if (wsResult.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    
    if (wsResult.rows[0].owner_id !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    
    await getPool().query('DELETE FROM workspaces WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get or Create Default Workspace
router.get('/default', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    
    let wsResult = await getPool().query('SELECT * FROM workspaces WHERE owner_id = $1 LIMIT 1', [userId]);
    
    if (wsResult.rows.length === 0) {
      wsResult = await getPool().query(
        'INSERT INTO workspaces (owner_id, title) VALUES ($1, $2) RETURNING *',
        [userId, 'My First Sandbox']
      );
      // Create a default index.js file
      await getPool().query(
        `INSERT INTO files (workspace_id, name, type, language, content) VALUES ($1, $2, $3, $4, $5)`,
        [wsResult.rows[0].id, 'index.js', 'file', 'javascript', '']
      );
    }
    res.json(wsResult.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:id/files
router.get('/:id/files', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const files = await getPool().query('SELECT id, parent_id, name, type, language FROM files WHERE workspace_id = $1 ORDER BY type DESC, name ASC', [id]);
    res.json(files.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:id/files
router.post('/:id/files', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, type, parent_id, language } = req.body;

    if (!name || !type || !['file', 'directory'].includes(type)) {
      res.status(400).json({ error: 'Name and valid type are required' });
      return;
    }

    const resolvedLanguage = type === 'file' ? (language || 'javascript') : null;
    
    const newFile = await getPool().query(
      `INSERT INTO files (workspace_id, name, type, parent_id, language) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id, parent_id, name, type, language`,
      [id, name, type, parent_id || null, resolvedLanguage]
    );
    res.status(201).json(newFile.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') { 
      res.status(400).json({ error: 'A file with this name already exists in this folder' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// DELETE /:id/files/:fileId
router.delete('/:id/files/:fileId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { fileId } = req.params;
    await getPool().query('DELETE FROM files WHERE id = $1', [fileId]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Execute code route
router.post('/execute', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { code, language, input } = req.body;
    if (!code || !language) {
      res.status(400).json({ error: 'Code and language are required' });
      return;
    }

    const result = await executeCode(code, language, input || undefined);
    res.json({
      output: result.output,
      metrics: {
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        oomKilled: result.oomKilled
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Execution failed' });
  }
});

interface WalkItem {
  path: string;
  type: 'file' | 'directory';
  sizeBytes: number;
}

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '.npm',
  'dist',
  'build',
  'out',
  '.next',
  'target',
  'bin',
  'obj'
]);

const IGNORED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.pdf',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.exe', '.dll', '.so', '.dylib',
  '.mp3', '.mp4', '.wav', '.mov', '.avi', '.flac',
  '.woff', '.woff2', '.ttf', '.eot',
  '.db', '.sqlite', '.sqlite3',
  '.class', '.pyc', '.o', '.obj',
  '.lock', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'
]);

function detectLanguage(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.js':
    case '.jsx':
      return 'javascript';
    case '.ts':
    case '.tsx':
      return 'typescript';
    case '.py':
      return 'python';
    case '.java':
      return 'java';
    case '.cpp':
    case '.cc':
    case '.cxx':
    case '.h':
    case '.hpp':
      return 'cpp';
    case '.c':
      return 'c';
    case '.go':
      return 'go';
    case '.rs':
      return 'rust';
    case '.html':
      return 'html';
    case '.css':
      return 'css';
    case '.json':
      return 'json';
    case '.md':
      return 'markdown';
    case '.sh':
      return 'shell';
    case '.yaml':
    case '.yml':
      return 'yaml';
    default:
      return 'plaintext';
  }
}

async function walkDir(
  dirPath: string,
  basePath: string,
  items: WalkItem[] = [],
  state = { totalSize: 0, fileCount: 0 }
): Promise<WalkItem[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relPath = path.relative(basePath, fullPath);

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      items.push({
        path: relPath,
        type: 'directory',
        sizeBytes: 0
      });
      await walkDir(fullPath, basePath, items, state);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (IGNORED_EXTENSIONS.has(ext) || IGNORED_EXTENSIONS.has(entry.name)) {
        continue;
      }

      state.fileCount++;
      if (state.fileCount > 500) {
        throw new Error('Limit exceeded: Repository contains more than 500 files.');
      }

      const stat = await fs.stat(fullPath);
      if (stat.size > 1024 * 1024) {
        // Skip individual files > 1MB
        continue;
      }

      state.totalSize += stat.size;
      if (state.totalSize > 10 * 1024 * 1024) {
        throw new Error('Limit exceeded: Repository total file size exceeds 10MB.');
      }

      items.push({
        path: relPath,
        type: 'file',
        sizeBytes: stat.size
      });
    }
  }

  return items;
}

// POST /import-github - Import a public GitHub repository
router.post('/import-github', async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { githubUrl } = req.body;
  if (!githubUrl) {
    res.status(400).json({ error: 'GitHub URL is required' });
    return;
  }

  // Regex to match github urls and optional branch:
  // Examples:
  // https://github.com/owner/repo
  // https://github.com/owner/repo/tree/branch-name
  // https://github.com/owner/repo.git
  const gitRegex = /^https:\/\/github\.com\/([a-zA-Z0-9-._]+)\/([a-zA-Z0-9-._]+)(?:\/tree\/([a-zA-Z0-9-._/]+))?\/?$/;
  const match = githubUrl.trim().match(gitRegex);
  if (!match) {
    res.status(400).json({ error: 'Invalid GitHub URL. Must be a public https://github.com/owner/repo URL.' });
    return;
  }

  const owner = match[1];
  let repo = match[2];
  if (repo.endsWith('.git')) {
    repo = repo.slice(0, -4);
  }
  const branch = match[3] || null;

  // Generate a clean target URL (force HTTPS)
  const repoUrl = `https://github.com/${owner}/${repo}.git`;
  const workspaceTitle = `${owner}/${repo}${branch ? ` (${branch})` : ''}`;

  const tempId = crypto.randomUUID();
  const clonesDir = path.join(process.cwd(), 'temp_git_clones');
  const tempPath = path.join(clonesDir, tempId);

  let client: any;
  try {
    // 1. Ensure temp parent directory exists
    await fs.mkdir(clonesDir, { recursive: true });

    // 2. Setup clone arguments
    const cloneArgs = ['clone', '--depth', '1'];
    if (branch) {
      cloneArgs.push('-b', branch);
    }
    cloneArgs.push(repoUrl, tempPath);

    try {
      await execFilePromise('git', cloneArgs);
    } catch (cloneErr: any) {
      console.error('Git clone failed:', cloneErr.message || cloneErr);
      res.status(400).json({ error: 'Failed to clone repository. Ensure the repository is public, the URL is correct, and if a branch was specified, that the branch exists.' });
      return;
    }

    // 3. Scan the cloned repository
    const walkState = { totalSize: 0, fileCount: 0 };
    const items = await walkDir(tempPath, tempPath, [], walkState);

    // 4. Connect to database & start transaction
    client = await getPool().connect();
    await client.query('BEGIN');

    // Create the workspace
    const wsResult = await client.query(
      'INSERT INTO workspaces (owner_id, title) VALUES ($1, $2) RETURNING id',
      [userId, workspaceTitle]
    );
    const workspaceId = wsResult.rows[0].id;

    // Separate folders and files
    const directories = items.filter(item => item.type === 'directory');
    const files = items.filter(item => item.type === 'file');

    // Sort directories by depth so parents are inserted before children
    directories.sort((a, b) => a.path.split(path.sep).length - b.path.split(path.sep).length);

    // Map to keep track of inserted directory relative path -> generated UUID
    const pathToId = new Map<string, string>();

    // Insert directories sequentially
    for (const dir of directories) {
      const parentPath = path.dirname(dir.path);
      const parentId = parentPath === '.' ? null : pathToId.get(parentPath) || null;
      const dirName = path.basename(dir.path);

      const dirResult = await client.query(
        'INSERT INTO files (workspace_id, parent_id, name, type) VALUES ($1, $2, $3, $4) RETURNING id',
        [workspaceId, parentId, dirName, 'directory']
      );
      pathToId.set(dir.path, dirResult.rows[0].id);
    }

    // Insert files
    const filePromises = files.map(async (file) => {
      const parentPath = path.dirname(file.path);
      const parentId = parentPath === '.' ? null : pathToId.get(parentPath) || null;
      const fileName = path.basename(file.path);
      const filePath = path.join(tempPath, file.path);
      
      const fileContent = await fs.readFile(filePath, 'utf8');
      const language = detectLanguage(fileName);

      await client.query(
        `INSERT INTO files (workspace_id, parent_id, name, type, content, language, size_bytes) 
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [workspaceId, parentId, fileName, 'file', fileContent, language, file.sizeBytes]
      );
    });

    await Promise.all(filePromises);

    await client.query('COMMIT');
    res.json({ success: true, workspaceId });
  } catch (err: any) {
    if (client) {
      await client.query('ROLLBACK');
    }
    console.error('Import GitHub repo error:', err);
    res.status(500).json({ error: err.message || 'Failed to import repository.' });
  } finally {
    if (client) {
      client.release();
    }
    // Cleanup temporary files
    try {
      await fs.rm(tempPath, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.error(`Failed to clean up temp dir ${tempPath}:`, cleanupErr);
    }
  }
});

export default router;


// what each route does -
// GET /:id - Get workspace details of a specific workspace by ID
// PUT /:id - Update workspace details of a specific workspace by ID (e.g. rename)
// DELETE /:id - Delete workspace by ID (and all associated files)
// GET /default - Get all workspaces for the authenticated user, or create a default one if none exist
// GET /:id/files - Get all files in a workspace by workspace ID
// POST /:id/files - Create a new file in a workspace by workspace ID (expects name, type, parent_id, language in body)
// DELETE /:id/files/:fileId - Delete a file from a workspace by file ID
// POST /execute - Execute code and return output (expects code and language in body)