/**
 * `/api/mobile/v1/notification-preferences` — reader-controlled digest settings.
 *
 * The app persists these locally as well, but the digest is delivered by the
 * server, so it is the server copy that decides whether tonight's message is
 * sent. Authentication is the same bearer session token the sync API uses.
 *
 * GET → `{ digestCadence, quietHoursStart, quietHoursEnd, timezoneOffsetMinutes,
 * quietHoursStartLabel, quietHoursEndLabel }` (labels are `HH:MM` for display).
 * PUT `{ digestCadence?, quietHoursStart?, quietHoursEnd?, timezoneOffsetMinutes? }`
 * → the saved preferences. Both quiet bounds are null or both are 0–1439.
 * 400 for a malformed body, 401 without a session token, 429 above 60 changes a
 * minute per reader+IP.
 */
import { NextResponse } from "next/server";
import { noStoreJson as json } from "@/lib/api/responses";
import { db } from "@/lib/db";
import { reportError } from "@/lib/error-reporting";
import { resolveMobileUser } from "@/lib/mobile-sync/resolve-mobile-user";
import { formatClock } from "@/lib/push/quiet-hours";
import { checkDbRateLimit, getClientIp } from "@/lib/rate-limiter";

const WHERE = "api/mobile/v1/notification-preferences";

const RATE_LIMIT = { maxRequests: 60, windowMs: 60_000 };

const DIGEST_CADENCES = new Set(["daily", "off"]);

interface PreferenceRow {
  digestCadence: string;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  timezoneOffsetMinutes: number;
}

interface Preferences {
  digestCadence: "daily" | "off";
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  timezoneOffsetMinutes: number;
  quietHoursStartLabel: string | null;
  quietHoursEndLabel: string | null;
}

const SELECT = {
  digestCadence: true,
  quietHoursStart: true,
  quietHoursEnd: true,
  timezoneOffsetMinutes: true,
} as const;

function serialize(row: PreferenceRow): Preferences {
  const digestCadence: "daily" | "off" =
    row.digestCadence === "off" ? "off" : "daily";
  return {
    digestCadence,
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
    timezoneOffsetMinutes: row.timezoneOffsetMinutes,
    quietHoursStartLabel: formatClock(row.quietHoursStart),
    quietHoursEndLabel: formatClock(row.quietHoursEnd),
  };
}

function unauthorized(): NextResponse {
  return json({ error: "Unauthorized" }, 401);
}

function badRequest(message: string): NextResponse {
  return json({ error: message }, 400);
}

async function resolveCaller(
  request: Request
): Promise<{ userId: string } | { response: NextResponse }> {
  let user;
  try {
    user = await resolveMobileUser(request.headers);
  } catch (error) {
    reportError(error, { where: `${WHERE} (auth)` });
    return { response: unauthorized() };
  }
  if (!user) return { response: unauthorized() };

  const limit = await checkDbRateLimit(
    `mobile-notification-prefs:${user.id}:${getClientIp(request)}`,
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

/** Accepts `HH:MM` strings or minutes; returns null for an empty value. */
function readMinutes(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === "string") {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
    return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    return value >= 0 && value < 24 * 60 ? value : undefined;
  }
  return undefined;
}

type Update = Partial<
  Pick<
    PreferenceRow,
    "digestCadence" | "quietHoursStart" | "quietHoursEnd" | "timezoneOffsetMinutes"
  >
>;

function readBody(body: unknown): Update | NextResponse {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return badRequest("A JSON object body is required");
  }
  const raw = body as Record<string, unknown>;
  const update: Update = {};

  if ("digestCadence" in raw) {
    const value = raw.digestCadence;
    if (typeof value !== "string" || !DIGEST_CADENCES.has(value)) {
      return badRequest('digestCadence must be "daily" or "off"');
    }
    update.digestCadence = value;
  }

  const start = "quietHoursStart" in raw ? readMinutes(raw.quietHoursStart) : undefined;
  const end = "quietHoursEnd" in raw ? readMinutes(raw.quietHoursEnd) : undefined;
  if (start === undefined && "quietHoursStart" in raw) {
    return badRequest("quietHoursStart must be HH:MM, minutes or null");
  }
  if (end === undefined && "quietHoursEnd" in raw) {
    return badRequest("quietHoursEnd must be HH:MM, minutes or null");
  }
  if (start !== undefined || end !== undefined) {
    // Both bounds travel together so a half-open window can never be stored.
    if (start === undefined || end === undefined) {
      return badRequest("Send both quiet-hours bounds, or both as null");
    }
    if ((start === null) !== (end === null)) {
      return badRequest("Quiet hours must be cleared or set as a pair");
    }
    update.quietHoursStart = start;
    update.quietHoursEnd = end;
  }

  if ("timezoneOffsetMinutes" in raw) {
    const value = raw.timezoneOffsetMinutes;
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < -840 ||
      value > 840
    ) {
      return badRequest("timezoneOffsetMinutes must be an integer -840..840");
    }
    update.timezoneOffsetMinutes = value;
  }

  if (Object.keys(update).length === 0) {
    return badRequest("No preference fields to update");
  }
  return update;
}

export async function GET(request: Request): Promise<NextResponse> {
  const caller = await resolveCaller(request);
  if ("response" in caller) return caller.response;
  try {
    const row = await db.user.findUnique({
      where: { id: caller.userId },
      select: SELECT,
    });
    if (!row) return json({ error: "Not found" }, 404);
    return json(serialize(row), 200);
  } catch (error) {
    reportError(error, { where: `${WHERE} (read)` });
    return json({ error: "Could not load preferences" }, 500);
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
  const caller = await resolveCaller(request);
  if ("response" in caller) return caller.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("A JSON body is required");
  }
  const parsed = readBody(body);
  if (parsed instanceof NextResponse) return parsed;

  try {
    const row = await db.user.update({
      where: { id: caller.userId },
      data: parsed,
      select: SELECT,
    });
    return json(serialize(row), 200);
  } catch (error) {
    reportError(error, { where: `${WHERE} (write)` });
    return json({ error: "Could not save preferences" }, 500);
  }
}
