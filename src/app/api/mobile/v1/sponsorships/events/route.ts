/**
 * `/api/mobile/v1/sponsorships/events` — impression and tap counters.
 *
 * The app posts `{ id, type, eventId, token }` when a sold unit is viewed or
 * opened. The token is short-lived and signed by the ad read endpoint, so a
 * caller cannot blindly increment an arbitrary campaign id. The event id is a
 * client-generated dedupe key: retries and replays never double-count.
 *
 * Public and unauthenticated by design: no user data is attached. Rate limited
 * per IP. Unknown/expired/stopped campaigns answer 200 with counted:false so
 * the app never surfaces a measurement error in the reader.
 */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { reportError } from "@/lib/error-reporting";
import { checkDbRateLimit, getClientIp } from "@/lib/rate-limiter";
import { verifyEventToken } from "@/lib/sponsorship-events";

const RATE_LIMIT = { maxRequests: 120, windowMs: 60_000 };
const EVENT_ID = /^[A-Za-z0-9_-]{8,80}$/;
/**
 * Token-less events are a rollout bridge, not a permanent public API. Keep them
 * until the updated app has replaced old installs, then set
 * SPONSORSHIP_ALLOW_LEGACY_EVENTS=false. If the operator does neither, the
 * built-in cutoff closes the bridge on 2027-01-31.
 */
const LEGACY_EVENTS_CUTOFF = Date.UTC(2027, 0, 31);

function legacyEventsAllowed(now: number = Date.now()): boolean {
  if (process.env.SPONSORSHIP_ALLOW_LEGACY_EVENTS === "false") return false;
  if (process.env.SPONSORSHIP_ALLOW_LEGACY_EVENTS === "true") return true;
  const configured = process.env.SPONSORSHIP_LEGACY_EVENTS_UNTIL;
  const cutoff = configured ? Date.parse(configured) : LEGACY_EVENTS_CUTOFF;
  return Number.isFinite(cutoff) ? now < cutoff : false;
}

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function utcDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
}

type Campaign = {
  id: string;
  active: boolean;
  archivedAt: Date | null;
  startsAt: Date;
  endsAt: Date | null;
  maxImpressions: number | null;
  impressions: number;
  dailyImpressionCap: number | null;
};

const CAMPAIGN_SELECT = {
  id: true,
  active: true,
  archivedAt: true,
  startsAt: true,
  endsAt: true,
  maxImpressions: true,
  impressions: true,
  dailyImpressionCap: true,
} as const;

function isLive(campaign: Campaign | null, now: Date): campaign is Campaign {
  return (
    campaign !== null &&
    campaign.active &&
    campaign.archivedAt === null &&
    campaign.startsAt <= now &&
    (campaign.endsAt === null || campaign.endsAt >= now)
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const limit = await checkDbRateLimit(
    `sponsorship-events:${getClientIp(request)}`,
    RATE_LIMIT
  );
  if (!limit.allowed) return json({ ok: true, counted: false });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Expected a JSON body." }, 400);
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const type = typeof body.type === "string" ? body.type.trim() : "";
  let eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
  if (!id || (type !== "impression" && type !== "tap")) {
    return json({ error: "Expected id and type impression|tap." }, 400);
  }

  const hasToken =
    typeof body.token === "string" && body.token.trim().length > 0;
  if (hasToken) {
    if (!EVENT_ID.test(eventId)) {
      return json({ error: "Expected a valid eventId." }, 400);
    }
    if (!verifyEventToken(body.token, id)) {
      return json({ error: "Invalid or expired event token." }, 401);
    }
  } else {
    if (!legacyEventsAllowed()) {
      return json({ error: "Invalid or expired event token." }, 401);
    }
    eventId = `legacy_${randomUUID()}`;
  }

  const now = new Date();
  const campaign = (await db.sponsorship.findUnique({
    where: { id },
    select: CAMPAIGN_SELECT,
  })) as Campaign | null;
  // Cheap early rejection; the authoritative state is re-read under the lock.
  if (!isLive(campaign, now)) return json({ ok: true, counted: false });

  const day = utcDay(now);
  try {
    const counted = await db.$transaction(async (tx) => {
      // Event writes for one campaign serialize here. This makes the lifetime
      // and daily cap checks safe under concurrent requests; without it two
      // callers can both observe room under a cap and both increment.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${id})::bigint)`;

      const locked = (await tx.sponsorship.findUnique({
        where: { id },
        select: CAMPAIGN_SELECT,
      })) as Campaign | null;
      if (!isLive(locked, new Date())) return false;

      if (type === "impression") {
        if (
          locked.maxImpressions !== null &&
          locked.impressions >= locked.maxImpressions
        ) {
          return false;
        }
        if (locked.dailyImpressionCap !== null) {
          if (locked.dailyImpressionCap <= 0) return false;
          const metric = await tx.sponsorshipDailyMetric.findUnique({
            where: { sponsorshipId_day: { sponsorshipId: id, day } },
            select: { impressions: true },
          });
          if (
            metric !== null &&
            metric.impressions >= locked.dailyImpressionCap
          ) {
            return false;
          }
        }
      }

      const existing = await tx.sponsorshipEvent.findUnique({
        where: { id: eventId },
        select: { id: true },
      });
      if (existing) return false;

      await tx.sponsorshipEvent.create({
        data: { id: eventId, sponsorshipId: id, type },
      });
      await tx.sponsorship.update({
        where: { id },
        data:
          type === "impression"
            ? { impressions: { increment: 1 } }
            : { taps: { increment: 1 } },
      });
      await tx.sponsorshipDailyMetric.upsert({
        where: { sponsorshipId_day: { sponsorshipId: id, day } },
        create: {
          sponsorshipId: id,
          day,
          impressions: type === "impression" ? 1 : 0,
          taps: type === "tap" ? 1 : 0,
        },
        update:
          type === "impression"
            ? { impressions: { increment: 1 } }
            : { taps: { increment: 1 } },
      });
      return true;
    });
    return json({ ok: true, counted });
  } catch (error) {
    // Duplicate event id (race), unknown campaign or storage failure: the
    // measurement layer must never break the reader, but operators need to know
    // when delivery accounting is failing.
    reportError(error, { where: "api/mobile/v1/sponsorships/events" });
    return json({ ok: true, counted: false });
  }
}
