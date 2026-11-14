import Redis from 'ioredis';
import Docker from 'dockerode';
import pg from 'pg';

export class CleanupManager {
  /**
   * Remove any Redis keys matching a prefix pattern
   */
  static async cleanupRedis(pattern = 'bench:*') {
    try {
      const redis = new Redis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: 1 });
      const stream = redis.scanStream({ match: pattern, count: 100 });
      let deletedCount = 0;
      for await (const keys of stream) {
        if (keys.length > 0) {
          await redis.del(...keys);
          deletedCount += keys.length;
        }
      }
      await redis.quit();
      return deletedCount;
    } catch {
      return 0;
    }
  }

  /**
   * Force remove any containers prefixed with 'bench-' or tracked by id
   */
  static async cleanupContainers(containerIds = []) {
    const sockets = [`${process.env.HOME}/.docker/run/docker.sock`, '/var/run/docker.sock'];
    let docker = null;
    for (const sock of sockets) {
      try {
        const d = new Docker({ socketPath: sock });
        await d.ping();
        docker = d;
        break;
      } catch {}
    }
    if (!docker) return 0;

    let removed = 0;
    // Remove specifically passed container IDs
    for (const id of containerIds) {
      try {
        const c = docker.getContainer(id);
        await c.remove({ force: true });
        removed++;
      } catch {}
    }

    // Also scan for any lingering bench-* containers
    try {
      const list = await docker.listContainers({ all: true });
      for (const item of list) {
        const isBench = item.Names && item.Names.some(n => n.includes('bench-'));
        if (isBench) {
          try {
            const c = docker.getContainer(item.Id);
            await c.remove({ force: true });
            removed++;
          } catch {}
        }
      }
    } catch {}

    return removed;
  }

  /**
   * Cleanup Postgres benchmark rows
   */
  static async cleanupPostgres(tableName = 'bench_file_updates') {
    try {
      const pool = new pg.Pool({ connectionString: 'postgresql://amankashyap@localhost:5432/sandbox' });
      await pool.query(`DROP TABLE IF EXISTS ${tableName}`);
      await pool.end();
    } catch {}
  }
}
