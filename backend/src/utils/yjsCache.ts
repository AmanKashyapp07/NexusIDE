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
         console.error('[YjsCache] Redis error:', err.message);
      });
   }
   return redis;
}

export async function getYjsStateFromCache(fileId: string): Promise<CachedYjsState | null> {
   try {
      const client = getRedis();
      
      const [yjsStateBuffer, authorMapJson] = await Promise.all([
         client.getBuffer(`yjs:state:${fileId}`),
         client.get(`yjs:author:${fileId}`)
      ]);

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
         try {
            const testDoc = new Y.Doc();
            Y.applyUpdate(testDoc, yjsStateBuffer);
            testDoc.destroy();
         } catch (err) {
            console.error('[YjsCache] Corrupt Yjs state in cache, ignoring:', err);
            await deleteYjsStateFromCache(fileId).catch(() => {});
            return null;
         }
      }

      return {
         yjsState: yjsStateBuffer,
         authorMap
      };
   } catch (err) {
      console.error('[YjsCache] Cache read error:', err);
      return null;
   }
}

export async function setYjsStateToCache(
   fileId: string,
   yjsState: Buffer,
   authorMap: Map<number, AuthorInfo>
): Promise<boolean> {
   try {
      const client = getRedis();
      const TTL = 10 * 60;

      const authorMapJson = JSON.stringify(
         Object.fromEntries(
            Array.from(authorMap.entries()).map(([k, v]) => [String(k), v])
         )
      );

      await Promise.all([
         client.setex(`yjs:state:${fileId}`, TTL, yjsState),
         client.setex(`yjs:author:${fileId}`, TTL, authorMapJson)
      ]);

      return true;
   } catch (err) {
      console.error('[YjsCache] Cache write error:', err);
      return false;
   }
}

export async function deleteYjsStateFromCache(fileId: string): Promise<boolean> {
   try {
      const client = getRedis();
      
      await Promise.all([
         client.del(`yjs:state:${fileId}`),
         client.del(`yjs:author:${fileId}`)
      ]);

      return true;
   } catch (err) {
      console.error('[YjsCache] Cache delete error:', err);
      return false;
   }
}

export async function isYjsCacheAvailable(): Promise<boolean> {
   try {
      const client = getRedis();
      await client.ping();
      return true;
   } catch {
      return false;
   }
}

export async function getYjsCacheStats(): Promise<YjsCacheStats> {
   try {
      const client = getRedis();
      const keys = await client.keys('yjs:*');
      
      return {
         totalKeys: keys.length,
         stateKeys: keys.filter(k => k.includes(':state:')).length,
         authorKeys: keys.filter(k => k.includes(':author:')).length,
         available: true
      };
   } catch (err) {
      return {
         totalKeys: 0,
         stateKeys: 0,
         authorKeys: 0,
         available: false,
         error: err instanceof Error ? err.message : 'Unknown error'
      };
   }
}

export async function clearYjsCache(): Promise<number> {
   try {
      const client = getRedis();
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
