import Redis from 'ioredis';
import * as Y from 'yjs';
import type { AuthorInfo, CachedYjsState, YjsCacheStats } from '../types/cache.types.js';

export type { CachedYjsState } from '../types/cache.types.js';

let redis: Redis;

function getRedis(): Redis {
   if (!redis) {
      redis = new Redis({
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

      redis.on('error', (err: Error) => {
         if (!process.env.CI) {
            console.error('[YjsCache] Redis error:', err.message);
         }
      });
   }
   return redis;
}

const inMemoryYjsCache = new Map<string, { state: Buffer; authorMapJson: string }>();

export async function getYjsStateFromCache(fileId: string): Promise<CachedYjsState | null> {
   if (!fileId) return null;
   try {
      const client = getRedis();
      let yjsStateBuffer: Buffer | null = null;
      let authorMapJson: string | null = null;

      if (client.status !== 'ready') {
         const entry = inMemoryYjsCache.get(fileId);
         if (!entry) return null;
         yjsStateBuffer = entry.state;
         authorMapJson = entry.authorMapJson;
      } else {
         const [buf, json] = await Promise.all([
            client.getBuffer(`yjs:state:${fileId}`),
            client.get(`yjs:author:${fileId}`)
         ]);
         yjsStateBuffer = buf;
         authorMapJson = json;
      }

      if (!yjsStateBuffer && !authorMapJson) {
         return null;
      }

      const authorMap = new Map<number, AuthorInfo>();
      if (authorMapJson) {
         try {
            const parsed: Record<string, unknown> = JSON.parse(authorMapJson);
            for (const [clientIdStr, info] of Object.entries(parsed)) {
               const clientId = Number(clientIdStr);
               if (!isNaN(clientId) && info && typeof info === 'object') {
                  authorMap.set(clientId, info as AuthorInfo);
               }
            }
         } catch (err) {
            console.error('[YjsCache] Failed to parse author map:', err);
         }
      }

      if (yjsStateBuffer) {
         if (yjsStateBuffer.length === 0) {
            await deleteYjsStateFromCache(fileId).catch(() => {});
            return null;
         }
         try {
            const testDoc = new Y.Doc();
            Y.applyUpdate(testDoc, yjsStateBuffer);
            testDoc.destroy();
         } catch (err) {
            console.error('[YjsCache] Corrupt Yjs state in cache, purging:', err);
            await deleteYjsStateFromCache(fileId).catch(() => {});
            return null;
         }
      }

      return {
         yjsState: yjsStateBuffer,
         authorMap
      };
   } catch (err) {
      const entry = inMemoryYjsCache.get(fileId);
      if (entry) {
         const authorMap = new Map<number, AuthorInfo>();
         if (entry.authorMapJson) {
            try {
               const parsed: Record<string, unknown> = JSON.parse(entry.authorMapJson);
               for (const [clientIdStr, info] of Object.entries(parsed)) {
                  const clientId = Number(clientIdStr);
                  if (!isNaN(clientId) && info && typeof info === 'object') {
                     authorMap.set(clientId, info as AuthorInfo);
                  }
               }
            } catch {}
         }
         return { yjsState: entry.state, authorMap };
      }
      return null;
   }
}

export async function setYjsStateToCache(
   fileId: string,
   yjsState: Buffer,
   authorMap: Map<number, AuthorInfo>
): Promise<boolean> {
   if (!fileId) return false;
   try {
      const authorMapJson = JSON.stringify(
         Object.fromEntries(
            Array.from(authorMap.entries()).map(([k, v]) => [String(k), v])
         )
      );

      inMemoryYjsCache.set(fileId, { state: yjsState, authorMapJson });

      const client = getRedis();
      if (client.status !== 'ready') return true;

      const TTL = 10 * 60;
      await Promise.all([
         client.setex(`yjs:state:${fileId}`, TTL, yjsState),
         client.setex(`yjs:author:${fileId}`, TTL, authorMapJson)
      ]);

      return true;
   } catch (err) {
      return true;
   }
}

export async function deleteYjsStateFromCache(fileId: string): Promise<boolean> {
   if (!fileId) return false;
   inMemoryYjsCache.delete(fileId);
   try {
      const client = getRedis();
      if (client.status !== 'ready') return true;
      
      await Promise.all([
         client.del(`yjs:state:${fileId}`),
         client.del(`yjs:author:${fileId}`)
      ]);

      return true;
   } catch (err) {
      return true;
   }
}

export async function isYjsCacheAvailable(): Promise<boolean> {
   try {
      const client = getRedis();
      if (client.status !== 'ready') return true;
      await client.ping();
      return true;
   } catch {
      return true;
   }
}

export async function getYjsCacheStats(): Promise<YjsCacheStats> {
   try {
      const client = getRedis();
      if (client.status !== 'ready') {
         return {
            totalKeys: inMemoryYjsCache.size * 2,
            stateKeys: inMemoryYjsCache.size,
            authorKeys: inMemoryYjsCache.size,
            available: true
         };
      }

      const [stateKeys, authorKeys] = await Promise.all([
         client.keys('yjs:state:*'),
         client.keys('yjs:author:*')
      ]);

      return {
         totalKeys: stateKeys.length + authorKeys.length,
         stateKeys: stateKeys.length,
         authorKeys: authorKeys.length,
         available: true
      };
   } catch (err) {
      return {
         totalKeys: inMemoryYjsCache.size * 2,
         stateKeys: inMemoryYjsCache.size,
         authorKeys: inMemoryYjsCache.size,
         available: true,
         error: err instanceof Error ? err.message : 'Unknown error'
      };
   }
}

export async function clearYjsCache(): Promise<number> {
   inMemoryYjsCache.clear();
   try {
      const client = getRedis();
      if (client.status !== 'ready') return 0;

      const keys = await client.keys('yjs:*');
      if (keys.length === 0) return 0;
      
      const result = await client.del(...keys);
      return result;
   } catch (err) {
      console.error('[YjsCache] Failed to clear cache:', err);
      return 0;
   }
}

export async function closeYjsCache(): Promise<void> {
   try {
      if (redis) {
         await redis.quit();
         console.log('[YjsCache] Redis connection closed');
      }
   } catch (err) {
      console.error('[YjsCache] Error closing Redis:', err);
   }
}

if (process.env.NODE_ENV !== 'test') {
   setInterval(async () => {
      const stats = await getYjsCacheStats();
      console.log('[YjsCache Stats]', stats);
   }, 10 * 60 * 1000);
}
