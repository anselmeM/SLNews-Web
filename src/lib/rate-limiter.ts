import { db } from "@/lib/db";

const memoryBuckets = new Map<string, { count: number; resetAt: number }>();

export const LOGIN_MAX_ATTEMPTS = 5;

interface RateLimiterOptions {
  maxRequests: number;
  windowMs: number;
}

export function checkRateLimit(
  key: string,
  { maxRequests, windowMs }: RateLimiterOptions
): { allowed: boolean; remaining: number; retryAfter: number } {
  const now = Date.now();
  const bucket = memoryBuckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    memoryBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, retryAfter: 0 };
  }

  bucket.count++;

  if (bucket.count > maxRequests) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    return { allowed: false, remaining: 0, retryAfter };
  }

  return {
    allowed: true,
    remaining: maxRequests - bucket.count,
    retryAfter: 0,
  };
}

export async function checkDbRateLimit(
  key: string,
  { maxRequests, windowMs }: RateLimiterOptions
): Promise<{ allowed: boolean; remaining: number; retryAfter: number }> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + windowMs);

  try {
    const existing = await db.rateLimit.findUnique({ where: { key } });

    if (!existing || now > existing.expiresAt) {
      await db.rateLimit.upsert({
        where: { key },
        update: { count: 1, expiresAt },
        create: { key, count: 1, expiresAt },
      });
      return { allowed: true, remaining: maxRequests - 1, retryAfter: 0 };
    }

    if (existing.count >= maxRequests) {
      const retryAfter = Math.ceil(
        (existing.expiresAt.getTime() - now.getTime()) / 1000
      );
      return { allowed: false, remaining: 0, retryAfter };
    }

    await db.rateLimit.update({
      where: { key },
      data: { count: { increment: 1 } },
    });

    return {
      allowed: true,
      remaining: maxRequests - existing.count - 1,
      retryAfter: 0,
    };
  } catch {
    return checkRateLimit(key, { maxRequests, windowMs });
  }
}

/**
 * Client IP for per-IP buckets.
 *
 * Vercel overwrites `x-forwarded-for` at its edge; `x-vercel-forwarded-for` is
 * the platform's own single-value header and is preferred when present. Direct
 * connections outside Vercel can still spoof these headers, so IP buckets are
 * abuse friction, not an authentication boundary.
 */
export function getClientIp(request: Request): string {
  return (
    request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "127.0.0.1"
  );
}

export function loginRateKey(email: string, ip: string): string {
  return `login:${ip}:${email.trim().toLowerCase()}`;
}

export async function resetRateLimit(key: string): Promise<void> {
  memoryBuckets.delete(key);
  try {
    await db.rateLimit.deleteMany({ where: { key } });
  } catch {
    // ignore — memory bucket already cleared
  }
}

export async function getRateLimitStatus(
  key: string,
  maxRequests: number
): Promise<{ blocked: boolean; retryAfter: number }> {
  const now = Date.now();
  try {
    const existing = await db.rateLimit.findUnique({ where: { key } });
    if (existing && now < existing.expiresAt.getTime()) {
      return {
        blocked: existing.count >= maxRequests,
        retryAfter: Math.ceil((existing.expiresAt.getTime() - now) / 1000),
      };
    }
  } catch {
    const bucket = memoryBuckets.get(key);
    if (bucket && now < bucket.resetAt) {
      return {
        blocked: bucket.count >= maxRequests,
        retryAfter: Math.ceil((bucket.resetAt - now) / 1000),
      };
    }
  }
  return { blocked: false, retryAfter: 0 };
}
