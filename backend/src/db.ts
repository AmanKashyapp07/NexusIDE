import { Pool } from 'pg';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
  }
  return pool;
}

// this file manages the PostgreSQL connection pool and provides a helper function to get the pool instance. It ensures that only one pool is created and reused across the application, which is important for performance and resource management, pool allows us to efficiently manage multiple database connections and reuse them across requests, rather than creating a new connection for each request which can be expensive and lead to resource exhaustion.