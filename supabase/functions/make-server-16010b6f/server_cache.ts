const serverCache = new Map<string, { data: unknown; timestamp: number }>();

export function getCached(key: string, maxAge = 10000): unknown | null {
  const cached = serverCache.get(key);
  if (cached && Date.now() - cached.timestamp < maxAge) {
    console.log(`✅ Server cache HIT: ${key}`);
    return cached.data;
  }
  return null;
}

export function setCache(key: string, data: unknown): void {
  serverCache.set(key, { data, timestamp: Date.now() });
  if (serverCache.size > 50) {
    const oldestKey = serverCache.keys().next().value;
    if (oldestKey) serverCache.delete(oldestKey);
  }
}

export function clearCache(key: string): void {
  serverCache.delete(key);
  console.log(`🗑️ Cache cleared: ${key}`);
}
