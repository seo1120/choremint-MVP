// Simple cache utility using localStorage (same pattern as child_session)
interface CacheItem<T> {
  data: T;
  timestamp: number;
  expiresAt: number; // timestamp when cache expires
}

export const cache = {
  /**
   * Set data in cache with TTL (Time To Live)
   * @param key Cache key
   * @param data Data to cache
   * @param ttlMs Time to live in milliseconds (default: 5 minutes)
   */
  set<T>(key: string, data: T, ttlMs: number = 5 * 60 * 1000): void {
    const item: CacheItem<T> = {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + ttlMs,
    };
    try {
      localStorage.setItem(`cache_${key}`, JSON.stringify(item));
    } catch (e) {
      console.error('Error setting cache:', e);
    }
  },

  /**
   * Get data from cache if not expired
   * @param key Cache key
   * @returns Cached data or null if expired/not found
   */
  get<T>(key: string): T | null {
    const itemStr = localStorage.getItem(`cache_${key}`);
    if (!itemStr) return null;

    try {
      const item: CacheItem<T> = JSON.parse(itemStr);
      const now = Date.now();

      // Check if expired
      if (now > item.expiresAt) {
        localStorage.removeItem(`cache_${key}`);
        return null;
      }

      return item.data;
    } catch (e) {
      localStorage.removeItem(`cache_${key}`);
      return null;
    }
  },

  /**
   * Remove specific cache item
   */
  invalidate(key: string): void {
    localStorage.removeItem(`cache_${key}`);
  },

  /**
   * Clear all cache items
   */
  clear(): void {
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('cache_')) {
        localStorage.removeItem(key);
      }
    });
  },
};

