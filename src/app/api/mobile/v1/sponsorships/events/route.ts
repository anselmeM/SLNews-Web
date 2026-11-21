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
import { checkDbRateLimit, getClientIp } from "@/lib/rate-limiter";
import { verifyEventToken } from "@/lib/sponsorship-events";

const RATE_LIMIT = { maxRequests: 120, windowMs: 60_000 };
const EVENT_ID = /^[A-Za-z0-9_-]{8,80}$/;

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
    // Transitional: app builds before the signed-token release still send only
    // {id,type}. Keep counting them until those installs age out, unless the
    // operator explicitly disables legacy events.
    if (process.env.SPONSORSHIP_ALLOW_LEGACY_EVENTS === "false") {
      return json({ error: "Invalid or expired event token." }, 401);
    }
    eventId = `legacy_${randomUUID()}`;
  }

  const now = new Date();
  const campaign = (await db.sponsorship.findUnique({
    where: { id },
    select: {
      id: true,
      active: true,
      archivedAt: true,
      startsAt: true,
      endsAt: true,
      maxImpressions: true,
      impressions: true,
      dailyImpressionCap: true,
    },
  })) as Campaign | null;

  const isLive =
    campaign !== null &&
    campaign.active &&
    campaign.archivedAt === null &&
    campaign.startsAt <= now &&
    (campaign.endsAt === null || campaign.endsAt >= now);
  if (!campaign || !isLive) return json({ ok: true, counted: false });

  const day = utcDay(now);
  if (
    type === "impression" &&
    campaign.maxImpressions !== null &&
    campaign.impressions >= campaign.maxImpressions
  ) {
    return json({ ok: true, counted: false });
  }

  try {
    const counted = await db.$transaction(async (tx) => {
      const existing = await tx.sponsorshipEvent.findUnique({
        where: { id: eventId },
        select: { id: true },
      });
      if (existing) return false;

      if (type === "impression" && campaign.dailyImpressionCap !== null) {
        if (campaign.dailyImpressionCap <= 0) return false;
        const metric = await tx.sponsorshipDailyMetric.findUnique({
          where: {
            sponsorshipId_day: { sponsorshipId: id, day },
          },
          select: { impressions: true },
        });
        if (
          metric !== null &&
          metric.impressions >= campaign.dailyImpressionCap
        ) {
          return false;
        }
      }

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
  } catch {
    // Duplicate event id (race), unknown campaign or storage failure: the
    // measurement layer must never break the reader.
    return json({ ok: true, counted: false });
  }
}
