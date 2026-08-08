import type { CacheEntry, CacheStats } from '../types/cache.types.js';

export class SimpleCache<T = unknown> {
   private cache = new Map<string, CacheEntry<T>>();
   private accessOrder: string[] = [];
   private currentSize = 0;
   private hits = 0;
   private misses = 0;
   
   constructor(
      private maxSize: number = 50 * 1024 * 1024,
      private defaultTTL: number = 5 * 60 * 1000
   ) {}

   set(key: string, value: T, ttl: number = this.defaultTTL): void {
      const size = this.estimateSize(value);
      
      if (size > this.maxSize) {
         console.warn(`[Cache] Item too large to cache: ${key} (${size} bytes)`);
         return;
      }

      while (this.currentSize + size > this.maxSize && this.cache.size > 0) {
         this.evictLRU();
      }

      if (this.cache.has(key)) {
         const oldEntry = this.cache.get(key)!;
         this.currentSize -= oldEntry.size;
         this.accessOrder = this.accessOrder.filter(k => k !== key);
      }

      this.cache.set(key, {
         value,
         expiresAt: Date.now() + ttl,
         size
      });
      this.accessOrder.push(key);
      this.currentSize += size;
   }

   get(key: string): T | null {
      const entry = this.cache.get(key);
      
      if (!entry) return null;
      
      if (Date.now() > entry.expiresAt) {
         this.delete(key);
         return null;
      }

      this.accessOrder = this.accessOrder.filter(k => k !== key);
      this.accessOrder.push(key);

      return entry.value;
   }

   delete(key: string): boolean {
      const entry = this.cache.get(key);
      if (!entry) return false;

      this.cache.delete(key);
      this.currentSize -= entry.size;
      this.accessOrder = this.accessOrder.filter(k => k !== key);
      return true;
   }

   clear(): void {
      this.cache.clear();
      this.accessOrder = [];
      this.currentSize = 0;
   }

   stats(): CacheStats {
      return {
         size: this.currentSize,
         items: this.cache.size,
         hitRate: this.hits / (this.hits + this.misses) || 0
      };
   }

   private evictLRU(): void {
      if (this.accessOrder.length === 0) return;
      
      const lruKey = this.accessOrder[0];
      if (lruKey) this.delete(lruKey);
   }

   private estimateSize(value: unknown): number {
      if (typeof value === 'string') {
         return value.length * 2;
      }
      if (Buffer.isBuffer(value)) {
         return value.length;
      }
      if (value instanceof Uint8Array) {
         return value.length;
      }
      return JSON.stringify(value).length * 2;
   }

   async getOrFetch<K>(
      key: string,
      fetchFn: () => Promise<K>,
      ttl?: number
   ): Promise<K> {
      const cached = this.get(key);
      
      if (cached !== null) {
         this.hits++;
         return cached as unknown as K;
      }

      this.misses++;
      const value = await fetchFn();
      this.set(key, value as unknown as T, ttl);
      return value;
   }
}

export const fileContentCache = new SimpleCache<string>(
   30 * 1024 * 1024,
   5 * 60 * 1000
);

export const yjsStateCache = new SimpleCache<Buffer>(
   50 * 1024 * 1024,
   10 * 60 * 1000
);

export const metadataCache = new SimpleCache<unknown>(
   10 * 1024 * 1024,
   30 * 60 * 1000
);

if (process.env.NODE_ENV !== 'test') {
   setInterval(() => {
      console.log('[Cache Stats]', {
         fileContent: fileContentCache.stats(),
         yjsState: yjsStateCache.stats(),
         metadata: metadataCache.stats()
      });
   }, 5 * 60 * 1000);
}
