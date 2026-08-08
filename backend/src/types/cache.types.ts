export interface CacheEntry<T> {
   value: T;
   expiresAt: number;
   size: number;
}

export interface CacheStats {
   size?: number | undefined;
   items?: number | undefined;
   hits?: number | undefined;
   misses?: number | undefined;
   hitRate: number;
}

export interface AuthorInfo {
   userId: string;
   username: string;
   color: string;
}

export interface CachedYjsState {
   yjsState: Buffer | null;
   authorMap: Map<number, AuthorInfo>;
}

export interface RedisMemoryStats {
   connected: boolean;
   usedMemory?: string | undefined;
   peakMemory?: string | undefined;
   keys?: number | undefined;
   error?: string | undefined;
}

export interface YjsCacheStats {
   totalKeys: number;
   stateKeys: number;
   authorKeys: number;
   available: boolean;
   error?: string | undefined;
}
