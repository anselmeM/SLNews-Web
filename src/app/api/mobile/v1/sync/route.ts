/**
 * `/api/mobile/v1/sync` — the mobile sync API.
 *
 * Contract: `SLNews-Mobile/docs/SYNC-API.md` (frozen for v1). The handlers here
 * only do transport: resolve the caller, rate limit, validate, delegate to
 * `src/lib/mobile-sync/`, and map the result onto the contract's status codes.
 */
import type { NextResponse } from "next/server";
import { noStoreJson as json } from "@/lib/api/responses";
import { db } from "@/lib/db";
import { reportError } from "@/lib/error-reporting";
import {
  applySync,
  pullChanges,
  type MobileSyncDb,
} from "@/lib/mobile-sync/engine";
import {
  resolveMobileUser,
  type MobileUser,
} from "@/lib/mobile-sync/resolve-mobile-user";
import { SYNC_LIMITS } from "@/lib/mobile-sync/types";
import {
  parsePullQuery,
  parsePushBody,
  type ValidationResult,
} from "@/lib/mobile-sync/validation";
import { checkDbRateLimit, getClientIp } from "@/lib/rate-limiter";

const WHERE = "api/mobile/v1/sync";

/**
 * `User.id` is the Clerk user id, so the rate-limit bucket follows the reader
 * across devices; the client IP is mixed in so that a broken client behind one
 * NAT address cannot exhaust the bucket for every other reader on it.
 */
function rateLimitKey(userId: string, request: Request): string {
  return `mobile-sync:${userId}:${getClientIp(request)}`;
}

interface Resolution {
  response?: NextResponse;
  user?: MobileUser;
}

/**
 * Resolves the caller and then spends one token from their rate-limit bucket.
 * Resolution happens first because the contract's bucket is per user, not per
 * IP: an unauthenticated flood cannot burn a reader's 60 requests.
 */
async function resolveCaller(request: Request): Promise<Resolution> {
  let user: MobileUser | null;
  try {
    user = await resolveMobileUser(request.headers);
  } catch (error) {
    // Resolution must not throw; if it ever does, it is a 401 and not a 500,
    // because "we could not establish who this is" is exactly 401.
    reportError(error, { where: `${WHERE} (auth)` });
    return { response: unauthorized() };
  }

  if (!user) return { response: unauthorized() };

  const limit = await checkDbRateLimit(rateLimitKey(user.id, request), {
    maxRequests: SYNC_LIMITS.maxRequestsPerWindow,
    windowMs: SYNC_LIMITS.rateLimitWindowMs,
  });
  if (!limit.allowed) return { response: tooManyRequests(limit.retryAfter) };

  return { user };
}

function unauthorized(): NextResponse {
  return json({ error: "Unauthorized" }, 401);
}

function tooManyRequests(retryAfterSeconds: number): NextResponse {
  const retryAfter = Math.max(1, Math.round(retryAfterSeconds));
  return json({ error: "Too many requests" }, 429, {
    "Retry-After": String(retryAfter),
  });
}

/** Sync responses are per-user state: never cacheable, by anyone. */

function invalidRequest<T>(
  result: Extract<ValidationResult<T>, { ok: false }>
): NextResponse {
  return json(
    {
      error: "Invalid sync payload",
      status: result.status,
      details: result.issues,
    },
    result.status
  );
}

/** Delta pull: `?since=<iso>&limit=<1..500>`, tombstones included. */
export async function GET(request: Request) {
  try {
    const { response, user } = await resolveCaller(request);
    if (response || !user) return response ?? unauthorized();

    const query = parsePullQuery(new URL(request.url).searchParams);
    if (!query.ok) return invalidRequest(query);

    const result = await pullChanges(
      db as unknown as MobileSyncDb,
      user.id,
      query.value
    );
    return json({ serverTime: new Date().toISOString(), ...result }, 200);
  } catch (error) {
    reportError(error, { where: WHERE });
    return json({ error: "Sync failed" }, 500);
  }
}

/** Batched push: last-write-wins per row, tombstones, per-row rejections. */
export async function POST(request: Request) {
  try {
    // Read the body first: the byte cap is answerable without touching the DB,
    // and a request that size would otherwise be parsed and thrown away.
    const rawBody = await request.text();
    const payload = parsePushBody(rawBody);
    if (!payload.ok) return invalidRequest(payload);

    const { response, user } = await resolveCaller(request);
    if (response || !user) return response ?? unauthorized();

    const result = await applySync(
      db as unknown as MobileSyncDb,
      user.id,
      payload.value
    );
    return json({ serverTime: new Date().toISOString(), ...result }, 200);
  } catch (error) {
    reportError(error, { where: WHERE });
    return json({ error: "Sync failed" }, 500);
  }
}
