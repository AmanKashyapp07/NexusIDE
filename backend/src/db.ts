import { Pool } from 'pg';

let pool: Pool | null = null;

export function getPool(): Pool {
   if (!pool) {
      pool = new Pool({
         connectionString: process.env.DATABASE_URL,
         max: 20,
         idleTimeoutMillis: 30000,
         connectionTimeoutMillis: 5000,
         keepAlive: true,
         keepAliveInitialDelayMillis: 10000,
      });

      pool.on('error', (err: Error) => {
         console.error('[DB Pool] Unexpected error:', err);
      });

      if (process.env.NODE_ENV !== 'production') {
         pool.on('connect', () => {
            console.log('[DB Pool] New client connected');
         });
         pool.on('remove', () => {
            console.log('[DB Pool] Client removed');
         });
      }
   }
   return pool;
}