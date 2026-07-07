/**
 * ===========================================================================
 * SIMPLE IN-MEMORY CACHE (No Redis needed)
 * ===========================================================================
 * 
 * This is a lightweight LRU (Least Recently Used) cache that runs in your
 * Node.js process. It's free and requires zero setup.
 * 
 * Use cases:
 * - Cache frequently accessed file content
 * - Cache user/workspace metadata
 * - Cache Yjs states for faster reconnects
 * 
 * Limitations:
 * - Not shared across multiple server instances (use Redis for that)
 * - Cleared on server restart
 * - Uses server RAM (set maxSize appropriately)
 * 
 * Memory usage estimate:
 * - 100 cached files × 10KB each = 1MB
 * - 1000 cached files × 10KB each = 10MB
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  size: number; // Approximate size in bytes
}

export class SimpleCache<T = any> {
  private cache = new Map<string, CacheEntry<T>>();
  private accessOrder: string[] = []; // Track access order for LRU
  private currentSize = 0;
  
  constructor(
    private maxSize: number = 50 * 1024 * 1024, // 50MB default
    private defaultTTL: number = 5 * 60 * 1000   // 5 minutes default
  ) {}

  /**
   * Store a value in cache
   */
  set(key: string, value: T, ttl: number = this.defaultTTL): void {
    // Calculate approximate size (rough estimate)
    const size = this.estimateSize(value);
    
    // If single item exceeds max size, don't cache it
    if (size > this.maxSize) {
      console.warn(`[Cache] Item too large to cache: ${key} (${size} bytes)`);
      return;
    }

    // Evict old items if needed
    while (this.currentSize + size > this.maxSize && this.cache.size > 0) {
      this.evictLRU();
    }

    // Remove old entry if exists
    if (this.cache.has(key)) {
      const oldEntry = this.cache.get(key)!;
      this.currentSize -= oldEntry.size;
      this.accessOrder = this.accessOrder.filter(k => k !== key);
    }

    // Add new entry
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl,
      size
    });
    this.accessOrder.push(key);
    this.currentSize += size;
  }

  /**
   * Get a value from cache
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) return null;
    
    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      return null;
    }

    // Update access order (move to end = most recently used)
    this.accessOrder = this.accessOrder.filter(k => k !== key);
    this.accessOrder.push(key);

    return entry.value;
  }

  /**
   * Delete a value from cache
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    this.cache.delete(key);
    this.currentSize -= entry.size;
    this.accessOrder = this.accessOrder.filter(k => k !== key);
    return true;
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
    this.currentSize = 0;
  }

  /**
   * Get cache statistics
   */
  stats(): { size: number; items: number; hitRate: number } {
    return {
      size: this.currentSize,
      items: this.cache.size,
      hitRate: this.hits / (this.hits + this.misses) || 0
    };
  }

  /**
   * Evict least recently used item
   */
  private evictLRU(): void {
    if (this.accessOrder.length === 0) return;
    
    const lruKey = this.accessOrder[0];
    this.delete(lruKey);
  }

  /**
   * Estimate size of a value in bytes (rough approximation)
   */
  private estimateSize(value: any): number {
    if (typeof value === 'string') {
      return value.length * 2; // 2 bytes per character (UTF-16)
    }
    if (Buffer.isBuffer(value)) {
      return value.length;
    }
    if (value instanceof Uint8Array) {
      return value.length;
    }
    // For objects, rough estimate
    return JSON.stringify(value).length * 2;
  }

  // Track hit/miss for statistics
  private hits = 0;
  private misses = 0;

  /**
   * Wrapper with automatic hit/miss tracking
   */
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

// ===========================================================================
// SINGLETON INSTANCES (use these across your app)
// ===========================================================================

// Cache for file content (short TTL, frequently accessed)
export const fileContentCache = new SimpleCache<string>(
  30 * 1024 * 1024, // 30MB
  5 * 60 * 1000     // 5 minutes
);

// Cache for Yjs states (longer TTL, larger size)
export const yjsStateCache = new SimpleCache<Buffer>(
  50 * 1024 * 1024, // 50MB
  10 * 60 * 1000    // 10 minutes
);

// Cache for metadata (very long TTL, small size)
export const metadataCache = new SimpleCache<any>(
  10 * 1024 * 1024, // 10MB
  30 * 60 * 1000    // 30 minutes
);

// Log cache stats every 5 minutes
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    console.log('[Cache Stats]', {
      fileContent: fileContentCache.stats(),
      yjsState: yjsStateCache.stats(),
      metadata: metadataCache.stats()
    });
  }, 5 * 60 * 1000);
}
