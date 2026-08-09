import dotenv from 'dotenv';
dotenv.config();
import { Pool } from 'pg';

let pool: Pool | null = null;

export async function ensureDatabaseIndexes(targetPool: Pool): Promise<void> {
   try {
      await targetPool.query(`
         CREATE INDEX IF NOT EXISTS idx_files_tree ON files (workspace_id, parent_id, type DESC, name ASC);
         CREATE INDEX IF NOT EXISTS idx_files_id_workspace ON files (id, workspace_id);
         CREATE INDEX IF NOT EXISTS idx_file_updates_ordered ON file_updates (file_id, seq ASC);
         CREATE INDEX IF NOT EXISTS idx_collab_auth ON workspace_collaborators (workspace_id, user_id);
      `);
   } catch {
      // Indexes may already exist or table created concurrently
   }
}

export function getPool(): Pool {
   if (!pool) {
      pool = new Pool({
         connectionString: process.env.DATABASE_URL || 'postgresql://postgres:my_secure_db_password@localhost:5432/sandbox',
         max: 30,
         idleTimeoutMillis: 10000,
         connectionTimeoutMillis: 3000,
         statement_timeout: 5000, // 5s hard ceiling against runaway query stalls
         query_timeout: 5000,
         keepAlive: true,
         keepAliveInitialDelayMillis: 10000,
         application_name: 'NexusIDE-Cluster',
      });

      pool.on('error', (err: Error) => {
         console.error('[DB Pool] Unexpected error:', err);
      });

      if (process.env.NODE_ENV !== 'production') {
         pool.on('connect', () => {
            console.log('[DB Pool] Client connection established');
         });
         pool.on('remove', () => {
            console.log('[DB Pool] Client connection removed');
         });
      }

      ensureDatabaseIndexes(pool).catch(() => {});
   }
   return pool;
}