import os from 'os';
import { execSync } from 'child_process';
import Docker from 'dockerode';
import Redis from 'ioredis';
import pg from 'pg';

export async function detectEnvironment() {
  const env = {
    timestamp: new Date().toISOString(),
    os: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpus: os.cpus().length,
      cpuModel: os.cpus()[0]?.model || 'Unknown',
      totalMemoryGb: Number((os.totalmem() / (1024 ** 3)).toFixed(2)),
      freeMemoryGb: Number((os.freemem() / (1024 ** 3)).toFixed(2))
    },
    runtime: {
      node: process.version,
      v8: process.versions.v8,
      uv: process.versions.uv
    },
    services: {
      docker: { available: false, version: null, socket: null },
      redis: { available: false, version: null, host: '127.0.0.1', port: 6379 },
      postgres: { available: false, version: null, database: 'sandbox' }
    }
  };

  // Test Docker
  const possibleSockets = [
    `${process.env.HOME}/.docker/run/docker.sock`,
    '/var/run/docker.sock'
  ];
  for (const sock of possibleSockets) {
    try {
      const docker = new Docker({ socketPath: sock });
      const ping = await docker.ping();
      if (ping) {
        const info = await docker.info();
        env.services.docker = {
          available: true,
          version: info.ServerVersion,
          socket: sock,
          containers: info.Containers,
          images: info.Images
        };
        break;
      }
    } catch {}
  }

  // Test Redis
  try {
    const redis = new Redis({ host: '127.0.0.1', port: 6379, connectTimeout: 1500, maxRetriesPerRequest: 1 });
    const pong = await redis.ping();
    if (pong === 'PONG') {
      const serverInfo = await redis.info('server');
      const versionMatch = serverInfo.match(/redis_version:([^\r\n]+)/);
      env.services.redis = {
        available: true,
        version: versionMatch ? versionMatch[1] : '8.x',
        host: '127.0.0.1',
        port: 6379
      };
    }
    await redis.quit();
  } catch (err) {
    env.services.redis.error = err.message;
  }

  // Test PostgreSQL
  try {
    const pool = new pg.Pool({ connectionString: 'postgresql://amankashyap@localhost:5432/sandbox', connectionTimeoutMillis: 2000 });
    const res = await pool.query('SELECT version()');
    if (res.rows && res.rows[0]) {
      env.services.postgres = {
        available: true,
        version: res.rows[0].version,
        database: 'sandbox'
      };
    }
    await pool.end();
  } catch (err) {
    env.services.postgres.error = err.message;
  }

  return env;
}
