import Redis from 'ioredis';
import type { CacheStats, RedisMemoryStats } from '../types/cache.types.js';

const redis = new Redis({
   host: process.env.REDIS_HOST || 'localhost',
   port: parseInt(process.env.REDIS_PORT || '6379'),
   password: process.env.REDIS_PASSWORD || undefined,
   retryStrategy(times: number) {
      const delay = Math.min(times * 50, 2000);
      return delay;
   },
   maxRetriesPerRequest: 3,
   enableReadyCheck: true,
   lazyConnect: false,
});

redis.on('connect', () => {
   console.log('[Redis] Connected successfully');
});

redis.on('error', (err: Error) => {
   if (!process.env.CI) {
      console.error('[Redis] Connection error:', err.message);
   }
});

redis.on('ready', () => {
   console.log('[Redis] Ready to accept commands');
});

const inMemoryCache = new Map<string, { value: string; expiresAt: number }>();

export class RedisCache<T = unknown> {
   private hits = 0;
   private misses = 0;
   
   constructor(
      private prefix: string,
      private defaultTTL: number = 5 * 60
   ) {}

   async set(key: string, value: T, ttl: number = this.defaultTTL): Promise<void> {
      const fullKey = `${this.prefix}:${key}`;
      const serialized = JSON.stringify(value);
      if (redis.status !== 'ready') {
         inMemoryCache.set(fullKey, { value: serialized, expiresAt: ttl > 0 ? Date.now() + ttl * 1000 : Infinity });
         return;
      }
      try {
         if (ttl > 0) {
            await redis.setex(fullKey, ttl, serialized);
         } else {
            await redis.set(fullKey, serialized);
         }
      } catch (err) {
         inMemoryCache.set(fullKey, { value: serialized, expiresAt: ttl > 0 ? Date.now() + ttl * 1000 : Infinity });
      }
   }

   async get(key: string): Promise<T | null> {
      const fullKey = `${this.prefix}:${key}`;
      if (redis.status !== 'ready') {
         const entry = inMemoryCache.get(fullKey);
         if (!entry || (entry.expiresAt !== Infinity && Date.now() > entry.expiresAt)) {
            this.misses++;
            return null;
         }
         this.hits++;
         return JSON.parse(entry.value) as T;
      }
      try {
         const value = await redis.get(fullKey);
         
         if (value === null) {
            this.misses++;
            return null;
         }
         
         this.hits++;
         return JSON.parse(value) as T;
      } catch (err) {
         const entry = inMemoryCache.get(fullKey);
         if (!entry || (entry.expiresAt !== Infinity && Date.now() > entry.expiresAt)) {
            this.misses++;
            return null;
         }
         this.hits++;
         return JSON.parse(entry.value) as T;
      }
   }

   async delete(key: string): Promise<boolean> {
      const fullKey = `${this.prefix}:${key}`;
      inMemoryCache.delete(fullKey);
      if (redis.status !== 'ready') return true;
      try {
         const result = await redis.del(fullKey);
         return result > 0;
      } catch (err) {
         return false;
      }
   }

   async deletePattern(pattern: string): Promise<number> {
      const prefixPattern = `${this.prefix}:${pattern.replace('*', '')}`;
      for (const k of Array.from(inMemoryCache.keys())) {
         if (k.startsWith(prefixPattern)) {
            inMemoryCache.delete(k);
         }
      }
      if (redis.status !== 'ready') return 0;
      try {
         const fullPattern = `${this.prefix}:${pattern}`;
         const keys = await redis.keys(fullPattern);
         
         if (keys.length === 0) return 0;
         
         const result = await redis.del(...keys);
         return result;
      } catch (err) {
         return 0;
      }
   }

   async clear(): Promise<void> {
      const prefix = `${this.prefix}:`;
      for (const k of Array.from(inMemoryCache.keys())) {
         if (k.startsWith(prefix)) {
            inMemoryCache.delete(k);
         }
      }
      if (redis.status !== 'ready') return;
      try {
         const keys = await redis.keys(`${this.prefix}:*`);
         if (keys.length > 0) {
            await redis.del(...keys);
         }
      } catch (err) {
         console.error(`[Redis] Failed to clear cache:`, err);
      }
   }

   stats(): CacheStats {
      return {
         hits: this.hits,
         misses: this.misses,
         hitRate: this.hits / (this.hits + this.misses) || 0
      };
   }

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

export const fileContentCache = new RedisCache<string>(
   'file:content',
   5 * 60
);

export const yjsStateCache = new RedisCache<Buffer>(
   'file:yjs',
   10 * 60
);

export const metadataCache = new RedisCache<unknown>(
   'metadata',
   30 * 60
);

export const workspaceCache = new RedisCache<unknown>(
   'workspace',
   15 * 60
);

// =============================================================================
// L2 REDIS CACHE LAYERS (FILESYSTEM TREE, RBAC AUTHORIZATION, WORKSPACE AUTH)
// =============================================================================

export const workspaceTreeCache = new RedisCache<unknown[]>(
   'ws:tree',
   10 * 60 // 10 minutes TTL
);

export const rbacCache = new RedisCache<string | null>(
   'rbac:role',
   15 * 60 // 15 minutes TTL
);

export const workspaceAuthCache = new RedisCache<{ owner_id: string; is_public: boolean } | null>(
   'ws:auth',
   15 * 60 // 15 minutes TTL
);

export const userProfileCache = new RedisCache<unknown>(
   'user:profile',
   30 * 60 // 30 minutes TTL
);

export const sessionTokenCache = new RedisCache<unknown>(
   'session:token',
   30 * 60 // 30 minutes TTL
);

export async function invalidateWorkspaceTree(workspaceId: string): Promise<void> {
   await workspaceTreeCache.delete(workspaceId);
}

export async function invalidateUserRbac(workspaceId: string, userId?: string): Promise<void> {
   if (userId) {
      await rbacCache.delete(`${workspaceId}:${userId}`);
   } else {
      await rbacCache.deletePattern(`${workspaceId}:*`);
   }
}

export async function invalidateWorkspaceAuth(workspaceId: string): Promise<void> {
   await workspaceAuthCache.delete(workspaceId);
   await rbacCache.deletePattern(`${workspaceId}:*`);
}

export async function invalidateUserProfile(userId: string): Promise<void> {
   await userProfileCache.delete(userId);
   await userProfileCache.deletePattern(`username:*`);
}

export async function invalidateUserSession(tokenHash: string): Promise<void> {
   await sessionTokenCache.delete(tokenHash);
}

export async function isRedisConnected(): Promise<boolean> {
   try {
      await redis.ping();
      return true;
   } catch {
      return false;
   }
}

export async function getRedisInfo(): Promise<RedisMemoryStats> {
   try {
      const info = await redis.info('memory');
      const lines = info.split('\r\n');
      const memory: Record<string, string> = {};
      
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

export async function closeRedis(): Promise<void> {
   try {
      await redis.quit();
      console.log('[Redis] Connection closed gracefully');
   } catch (err) {
      console.error('[Redis] Error closing connection:', err);
   }
}

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

export { redis };
