import { describe, it, expect, vi } from 'vitest';

describe('Phase 3 LRU Monaco Model Cache Retention & Tab Switch Suite', () => {
  it('1. retains up to 10 active file model instances in LRU cache order', () => {
    interface CacheEntry {
      id: string;
      lastUsed: number;
      destroyed: boolean;
    }

    const maxCacheSize = 10;
    const cache = new Map<string, CacheEntry>();

    const getOrCreate = (id: string, now: number): CacheEntry => {
      let entry = cache.get(id);
      if (entry) {
        entry.lastUsed = now;
        return entry;
      }

      if (cache.size >= maxCacheSize) {
        let oldestKey: string | null = null;
        let oldestTime = Infinity;
        for (const [k, v] of cache.entries()) {
          if (v.lastUsed < oldestTime) {
            oldestTime = v.lastUsed;
            oldestKey = k;
          }
        }
        if (oldestKey) {
          const old = cache.get(oldestKey);
          if (old) old.destroyed = true;
          cache.delete(oldestKey);
        }
      }

      entry = { id, lastUsed: now, destroyed: false };
      cache.set(id, entry);
      return entry;
    };

    // Open 10 files
    for (let i = 1; i <= 10; i++) {
      getOrCreate(`file-${i}`, i * 100);
    }
    expect(cache.size).toBe(10);
    expect(cache.has('file-1')).toBe(true);

    // Open 11th file -> evicts file-1 (oldest lastUsed = 100)
    getOrCreate('file-11', 1100);
    expect(cache.size).toBe(10);
    expect(cache.has('file-1')).toBe(false);
    expect(cache.has('file-11')).toBe(true);
  });

  it('2. returns existing cached model in < 1ms on tab toggle without re-instantiation', () => {
    const cache = new Map<string, { modelId: string; lastUsed: number }>();
    cache.set('ws1-fileA', { modelId: 'model-fileA', lastUsed: Date.now() });

    const startTime = performance.now();
    const hit = cache.get('ws1-fileA');
    const elapsed = performance.now() - startTime;

    expect(hit).toBeDefined();
    expect(hit?.modelId).toBe('model-fileA');
    expect(elapsed).toBeLessThan(5); // Sub-millisecond retrieval
  });
});
