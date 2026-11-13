/**
 * `/api/mobile/v1/devices` — native push token registration.
 *
 * The Flutter app obtains an FCM token after sign-in and registers it here so
 * alerts raised by the web (breaking news, briefing, price alerts) can reach the
 * phone. Authentication is the same bearer session token the sync API uses: the
 * token belongs to a reader, and a token cannot be registered on someone else's
 * behalf.
 *
 * Contract (kept in the PR body, since this repository does not track markdown):
 * POST `{ "token": string, "platform": "android" | "ios" }` → 200 `{ ok: true }`;
 * DELETE the same body → 200 `{ ok: true, removed: n }`. 400 for a malformed
 * token/platform, 401 without a session token, 429 above 30 registrations a
 * minute per reader+IP.
 */
import { NextResponse } from "next/server";
import { noStoreJson as json } from "@/lib/api/responses";
import { db } from "@/lib/db";
import { reportError } from "@/lib/error-reporting";
import { resolveMobileUser } from "@/lib/mobile-sync/resolve-mobile-user";
import { checkDbRateLimit, getClientIp } from "@/lib/rate-limiter";

const WHERE = "api/mobile/v1/devices";

/** FCM tokens are long opaque strings; these bounds only reject nonsense. */
const MIN_TOKEN_LENGTH = 20;
const MAX_TOKEN_LENGTH = 4096;
const TOKEN_PATTERN = /^[A-Za-z0-9_:.\-]+$/;
const PLATFORMS = new Set(["android", "ios"]);

const RATE_LIMIT = { maxRequests: 30, windowMs: 60_000 };

interface Resolution {
  response?: NextResponse;
  userId?: string;
}

async function resolveCaller(request: Request): Promise<Resolution> {
  let user;
  try {
    user = await resolveMobileUser(request.headers);
  } catch (error) {
    // "We could not establish who this is" is a 401, not a 500.
    reportError(error, { where: `${WHERE} (auth)` });
    return { response: unauthorized() };
  }
  if (!user) return { response: unauthorized() };

  const limit = await checkDbRateLimit(
    `mobile-devices:${user.id}:${getClientIp(request)}`,
    RATE_LIMIT
  );
  if (!limit.allowed) {
    const retryAfter = Math.max(1, Math.round(limit.retryAfter));
    return {
      response: json({ error: "Too many requests" }, 429, {
        "Retry-After": String(retryAfter),
      }),
    };
  }

  return { userId: user.id };
}

/** Registry responses are per-user state: never cacheable. */

function unauthorized(): NextResponse {
  return json({ error: "Unauthorized" }, 401);
}

function badRequest(message: string): NextResponse {
  return json({ error: message }, 400);
}

/** `{ token, platform? }`; platform defaults to android for older clients. */
async function readRegistration(
  request: Request
): Promise<{ token: string; platform: string } | NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("A JSON body is required");
  }
  if (typeof body !== "object" || body === null)
    return badRequest("A JSON body is required");

  const raw = body as { token?: unknown; platform?: unknown };
  const token = typeof raw.token === "string" ? raw.token.trim() : "";
  if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) {
    return badRequest(
      `token must be ${MIN_TOKEN_LENGTH}-${MAX_TOKEN_LENGTH} characters`
    );
  }
  if (!TOKEN_PATTERN.test(token))
    return badRequest("token has an unexpected character");

  const platform =
    typeof raw.platform === "string"
      ? raw.platform.trim().toLowerCase()
      : "android";
  if (!PLATFORMS.has(platform))
    return badRequest('platform must be "android" or "ios"');

  return { token, platform };
}

/** Register or refresh this device's token. Idempotent: safe to call on launch. */
export async function POST(request: Request) {
  try {
    const { response, userId } = await resolveCaller(request);
    if (response || !userId) return response ?? unauthorized();

    const registration = await readRegistration(request);
    if (registration instanceof NextResponse) return registration;

    await db.mobileDevice.upsert({
      where: { token: registration.token },
      // Re-registration refreshes ownership and liveness: FCM can hand the same
      // token to a different reader after a device transfer.
      update: {
        userId,
        platform: registration.platform,
        lastSeenAt: new Date(),
      },
      create: {
        userId,
        token: registration.token,
        platform: registration.platform,
      },
    });

    return json({ ok: true }, 200);
  } catch (error) {
    reportError(error, { where: WHERE });
    return json({ error: "Registration failed" }, 500);
  }
}

/**
 * Unregister this device. Scoped to the caller's own tokens, so a leaked token
 * cannot be used to silence someone else's alerts.
 */
export async function DELETE(request: Request) {
  try {
    const { response, userId } = await resolveCaller(request);
    if (response || !userId) return response ?? unauthorized();

    const registration = await readRegistration(request);
    if (registration instanceof NextResponse) return registration;

    const deleted = await db.mobileDevice.deleteMany({
      where: { token: registration.token, userId },
    });

    return json({ ok: true, removed: deleted.count }, 200);
  } catch (error) {
    reportError(error, { where: WHERE });
    return json({ error: "Unregistration failed" }, 500);
  }
}
