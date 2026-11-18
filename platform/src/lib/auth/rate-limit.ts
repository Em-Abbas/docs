import "server-only";

/**
 * Fixed-window in-memory rate limiter. Good for a single server process.
 * For several app instances, swap this for Redis or a database table.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryInSec: number } {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 50_000) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }
    return { ok: true, retryInSec: 0 };
  }
  bucket.count++;
  return { ok: bucket.count <= limit, retryInSec: Math.ceil((bucket.resetAt - now) / 1000) };
}
