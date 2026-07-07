/**
 * ===========================================================================
 * REDIS CACHE (Free, Self-Hosted on Oracle VM)
 * ===========================================================================
 * 
 * This replaces simpleCache.ts with Redis for:
 * - Persistent cache (survives server restarts)
 * - Shared cache (if you add more backend servers later)
 * - Better memory management
 * 
 * Cost: $0 (uses ~50MB RAM on your Oracle VM)
 */

import Redis from 'ioredis';

// Redis connection
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

// Log connection status
redis.on('connect', () => {
  console.log('[Redis] Connected successfully');
});

redis.on('error', (err) => {
  console.error('[Redis] Connection error:', err.message);
});

redis.on('ready', () => {
  console.log('[Redis] Ready to accept commands');
});

// ===========================================================================
// CACHE INTERFACE (same as simpleCache.ts for easy migration)
// ===========================================================================

export class RedisCache<T = any> {
  private hits = 0;
  private misses = 0;
  
  constructor(
    private prefix: string,
    private defaultTTL: number = 5 * 60 // 5 minutes in seconds
  ) {}

  /**
   * Store a value in Redis
   */
  async set(key: string, value: T, ttl: number = this.defaultTTL): Promise<void> {
    try {
      const fullKey = `${this.prefix}:${key}`;
      const serialized = JSON.stringify(value);
      
      if (ttl > 0) {
        await redis.setex(fullKey, ttl, serialized);
      } else {
        await redis.set(fullKey, serialized);
      }
    } catch (err) {
      console.error(`[Redis] Failed to set ${key}:`, err);
    }
  }

  /**
   * Get a value from Redis
   */
  async get(key: string): Promise<T | null> {
    try {
      const fullKey = `${this.prefix}:${key}`;
      const value = await redis.get(fullKey);
      
      if (value === null) {
        this.misses++;
        return null;
      }
      
      this.hits++;
      return JSON.parse(value);
    } catch (err) {
      console.error(`[Redis] Failed to get ${key}:`, err);
      this.misses++;
      return null;
    }
  }

  /**
   * Delete a value from Redis
   */
  async delete(key: string): Promise<boolean> {
    try {
      const fullKey = `${this.prefix}:${key}`;
      const result = await redis.del(fullKey);
      return result > 0;
    } catch (err) {
      console.error(`[Redis] Failed to delete ${key}:`, err);
      return false;
    }
  }

  /**
   * Delete multiple keys matching a pattern
   */
  async deletePattern(pattern: string): Promise<number> {
    try {
      const fullPattern = `${this.prefix}:${pattern}`;
      const keys = await redis.keys(fullPattern);
      
      if (keys.length === 0) return 0;
      
      const result = await redis.del(...keys);
      return result;
    } catch (err) {
      console.error(`[Redis] Failed to delete pattern ${pattern}:`, err);
      return 0;
    }
  }

  /**
   * Clear all keys with this prefix
   */
  async clear(): Promise<void> {
    try {
      const keys = await redis.keys(`${this.prefix}:*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (err) {
      console.error(`[Redis] Failed to clear cache:`, err);
    }
  }

  /**
   * Get cache statistics
   */
  stats(): { hits: number; misses: number; hitRate: number } {
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits / (this.hits + this.misses) || 0
    };
  }

  /**
   * Wrapper with automatic fetch on cache miss
   */
  async getOrFetch<K>(
    key: string,
    fetchFn: () => Promise<K>,
    ttl?: number
  ): Promise<K> {
    const cached = await this.get(key);
    
    if (cached !== null) {
      return cached as unknown as K;
    }

    const value = await fetchFn();
    await this.set(key, value as unknown as T, ttl);
    return value;
  }
}

// ===========================================================================
// SINGLETON INSTANCES (use these across your app)
// ===========================================================================

// Cache for file content (short TTL, frequently accessed)
export const fileContentCache = new RedisCache<string>(
  'file:content',
  5 * 60 // 5 minutes
);

// Cache for Yjs states (longer TTL, larger size)
export const yjsStateCache = new RedisCache<Buffer>(
  'file:yjs',
  10 * 60 // 10 minutes
);

// Cache for metadata (very long TTL, small size)
export const metadataCache = new RedisCache<any>(
  'metadata',
  30 * 60 // 30 minutes
);

// Cache for workspace data
export const workspaceCache = new RedisCache<any>(
  'workspace',
  15 * 60 // 15 minutes
);

// ===========================================================================
// UTILITY FUNCTIONS
// ===========================================================================

/**
 * Check if Redis is connected
 */
export async function isRedisConnected(): Promise<boolean> {
  try {
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get Redis info
 */
export async function getRedisInfo() {
  try {
    const info = await redis.info('memory');
    const lines = info.split('\r\n');
    const memory: any = {};
    
    lines.forEach(line => {
      const [key, value] = line.split(':');
      if (key && value) {
        memory[key] = value;
      }
    });
    
    return {
      connected: true,
      usedMemory: memory.used_memory_human,
      peakMemory: memory.used_memory_peak_human,
      keys: await redis.dbsize()
    };
  } catch (err) {
    return { connected: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Graceful shutdown
 */
export async function closeRedis(): Promise<void> {
  try {
    await redis.quit();
    console.log('[Redis] Connection closed gracefully');
  } catch (err) {
    console.error('[Redis] Error closing connection:', err);
  }
}

// Log cache stats every 5 minutes
if (process.env.NODE_ENV !== 'test') {
  setInterval(async () => {
    console.log('[Cache Stats]', {
      fileContent: fileContentCache.stats(),
      yjsState: yjsStateCache.stats(),
      metadata: metadataCache.stats(),
      workspace: workspaceCache.stats(),
      redis: await getRedisInfo()
    });
  }, 5 * 60 * 1000);
}

// Export Redis client for advanced use cases
export { redis };
