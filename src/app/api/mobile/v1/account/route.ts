/**
 * `/api/mobile/v1/account` — delete the signed-in reader's account and data.
 *
 * Play requires a working deletion path once an app lets people create accounts, and
 * the published policy promises the same thing. The Flutter app calls this from
 * Settings → SLNews account → Delete account.
 *
 * Contract (kept in the PR body, since this repository does not track markdown):
 * `DELETE` with the same bearer session token the sync API uses →
 *   200 `{ ok: true, deleted: true }`
 *   401 without a session token
 *   429 above 5 deletions a minute per reader+IP
 *   502 when Clerk refused to delete the sign-in (our rows are already gone; retry)
 *   503 when the server has no Clerk secret (deletion cannot be honoured here)
 *
 * Order matters: our rows go first so a Clerk failure leaves a usable account the
 * reader can retry from, rather than an identity that can never be deleted again.
 */
import type { NextResponse } from "next/server";
import { noStoreJson as json } from "@/lib/api/responses";
import { deleteClerkUser } from "@/lib/clerk-backend";
import { db } from "@/lib/db";
import { reportError } from "@/lib/error-reporting";
import { resolveMobileUser } from "@/lib/mobile-sync/resolve-mobile-user";
import { checkDbRateLimit, getClientIp } from "@/lib/rate-limiter";

const WHERE = "api/mobile/v1/account";

const RATE_LIMIT = { maxRequests: 5, windowMs: 60_000 };

/** Per-user state operations are never cacheable. */

export async function DELETE(request: Request): Promise<NextResponse> {
  let userId: string;
  try {
    const user = await resolveMobileUser(request.headers);
    if (!user) return json({ error: "Unauthorized" }, 401);
    userId = user.id;
  } catch (error) {
    // "We cannot establish who this is" is a 401, not a 500.
    reportError(error, { where: `${WHERE} (auth)` });
    return json({ error: "Unauthorized" }, 401);
  }

  const limit = await checkDbRateLimit(
    `mobile-account-delete:${userId}:${getClientIp(request)}`,
    RATE_LIMIT
  );
  if (!limit.allowed) {
    const retryAfter = Math.max(1, Math.round(limit.retryAfter));
    return json({ error: "Too many requests" }, 429, {
      "Retry-After": String(retryAfter),
    });
  }

  try {
    // Explicit child deletes keep this independent of cascade behaviour, and make the
    // intent reviewable: these are exactly the rows the policy says are deleted.
    await db.$transaction([
      db.mobileBookmark.deleteMany({ where: { userId } }),
      db.mobileReaction.deleteMany({ where: { userId } }),
      db.mobileFollow.deleteMany({ where: { userId } }),
      db.mobileDevice.deleteMany({ where: { userId } }),
      db.user.deleteMany({ where: { id: userId } }),
    ]);
  } catch (error) {
    reportError(error, { where: `${WHERE} (rows)` });
    return json(
      {
        error:
          "Could not delete your data right now. Please try again or contact support.",
      },
      500
    );
  }

  const clerk = await deleteClerkUser(userId);
  if (clerk === "unconfigured") {
    reportError(new Error("CLERK_SECRET_KEY is not configured"), {
      where: `${WHERE} (clerk unconfigured)`,
    });
    return json(
      {
        error:
          "Your SLNews data was deleted, but sign-in removal is unavailable. Contact privacy@slnews.sl.",
      },
      503
    );
  }
  if (clerk === "failed") {
    reportError(new Error("Clerk user deletion failed"), {
      where: `${WHERE} (clerk)`,
    });
    return json(
      {
        error:
          "Your SLNews data was deleted, but the sign-in could not be removed. Please retry or contact privacy@slnews.sl.",
      },
      502
    );
  }

  return json({ ok: true, deleted: true }, 200);
}
