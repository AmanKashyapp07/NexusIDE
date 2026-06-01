import { Router } from 'express';
import { executeCode } from '../sandbox/docker';
import { getPool } from '../db';

const router = Router();

// Create or get workspace
router.post('/', async (req, res) => {
  try {
    const { id, title, language } = req.body;
    
    // For this minimal setup, we return a dummy workspace if Postgres is not running.
    // Try to connect and insert/update
    try {
      let result;
      if (id) {
        // Upsert by ID (ON CONFLICT not simple for uuid if it's generated, but assuming UUID is PK)
        result = await getPool().query(
          `INSERT INTO workspaces (id, title, language) 
           VALUES ($1, $2, $3)
           ON CONFLICT (id) DO UPDATE 
           SET title = EXCLUDED.title, language = EXCLUDED.language
           RETURNING *`,
          [id, title || 'Untitled Project', language || 'javascript']
        );
      } else {
        result = await getPool().query(
          `INSERT INTO workspaces (title, language) 
           VALUES ($1, $2)
           RETURNING *`,
          [title || 'Untitled Project', language || 'javascript']
        );
      }
      
      res.json(result.rows[0]);
    } catch (dbError) {
      console.warn("Database connection failed, falling back to dummy workspace response:", dbError);
      res.json({ id: id || 'test-uuid', title: 'Fallback Project', language: 'javascript' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Execute code route
router.post('/execute', async (req, res) => {
  try {
    const { code, language } = req.body;
    if (!code || !language) {
      return res.status(400).json({ error: 'Code and language are required' });
    }

    const output = await executeCode(code, language);
    res.json({ output });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Execution failed' });
  }
});

export default router;
