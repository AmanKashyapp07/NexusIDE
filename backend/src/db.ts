import { Pool } from 'pg';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Optimize connection pool for better performance
      max: 20,                    // Maximum connections (default: 10)
      idleTimeoutMillis: 30000,   // Close idle connections after 30s
      connectionTimeoutMillis: 5000, // Timeout if can't get connection
      // Enable keep-alive to prevent connection drops
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    });
    
    // Log pool errors
    pool.on('error', (err) => {
      console.error('[DB Pool] Unexpected error:', err);
    });
    
    // Log pool connection events (only in dev)
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

// this file manages the PostgreSQL connection pool and provides a helper function to get the pool instance. It ensures that only one pool is created and reused across the application, which is important for performance and resource management, pool allows us to efficiently manage multiple database connections and reuse them across requests, rather than creating a new connection for each request which can be expensive and lead to resource exhaustion.