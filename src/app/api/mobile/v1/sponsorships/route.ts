/**
 * `/api/mobile/v1/sponsorships` — directly sold sponsorship units.
 *
 * The app renders house ads from its seed; this endpoint lets a sold creative be
 * inserted per placement without shipping a release. Reads are public and cached
 * briefly under the `sponsorships` tag; writes need `x-admin-key` matching
 * SPONSORSHIP_ADMIN_KEY.
 *
 * GET ?placement=feed -> { items: AdUnit-shaped[] } (only active, in window)
 * POST {placement, advertiser, headline, body, ctaLabel, ctaUrl, ...} -> 201
 */
import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { adminKeyMatches } from "@/lib/admin-key";
import { db } from "@/lib/db";
import { reportError } from "@/lib/error-reporting";
import { toAdUnit, type SponsorshipRow } from "@/lib/sponsorship-ad-unit";
import {
  revalidateSponsorships,
  SPONSORSHIPS_TAG,
} from "@/lib/sponsorship-cache";
import { createEventToken } from "@/lib/sponsorship-events";
import { rotateSponsorships } from "@/lib/sponsorship-rotation";
import {
  asDatabasePlacement,
  isPlacement,
  parseSponsorshipInput,
} from "@/lib/sponsorship-validation";

const WHERE = "api/mobile/v1/sponsorships";
const MAX_ITEMS = 6;

function noStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function loadRowsUncached(
  placement: string | null
): Promise<SponsorshipRow[]> {
  const now = new Date();
  const rows = (await db.sponsorship.findMany({
    where: {
      active: true,
      archivedAt: null,
      ...(placement ? { placement: placement } : {}),
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gte: now } }],
    },
    orderBy: [{ priority: "desc" }, { startsAt: "desc" }],
    take: 50,
  })) as SponsorshipRow[];

  const withinLifetimeCap = rows.filter(
    (row) =>
      row.maxImpressions === null ||
      row.maxImpressions === undefined ||
      row.impressions < row.maxImpressions
  );
  const dailyCapped = withinLifetimeCap.filter(
    (row) => (row.dailyImpressionCap ?? 0) > 0
  );
  if (dailyCapped.length === 0) return withinLifetimeCap;

  const day = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const metrics = await db.sponsorshipDailyMetric.findMany({
    where: {
      day,
      sponsorshipId: { in: dailyCapped.map((row) => row.id) },
    },
    select: { sponsorshipId: true, impressions: true },
  });
  const seen = new Map(
    metrics.map((metric) => [metric.sponsorshipId, metric.impressions])
  );
  return withinLifetimeCap.filter((row) => {
    const cap = row.dailyImpressionCap;
    if (cap === null || cap === undefined || cap <= 0) return true;
    return (seen.get(row.id) ?? 0) < cap;
  });
}

const loadRowsCached = unstable_cache(loadRowsUncached, [WHERE, "placement"], {
  tags: [SPONSORSHIPS_TAG],
  revalidate: 60,
});

/** Tests get an uncached read so each mocked DB case is independent. */
function loadRows(placement: string | null): Promise<SponsorshipRow[]> {
  return process.env.NODE_ENV === "test"
    ? loadRowsUncached(placement)
    : loadRowsCached(placement);
}

export async function GET(request: Request): Promise<NextResponse> {
  const placement =
    new URL(request.url).searchParams.get("placement")?.trim() || null;
  if (placement !== null && !isPlacement(placement)) {
    return noStore({ items: [], error: "Unknown placement." }, 400);
  }

  try {
    const rows = rotateSponsorships(await loadRows(placement), MAX_ITEMS);
    return NextResponse.json(
      {
        items: rows.map((row) => toAdUnit(row, createEventToken(row.id))),
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  } catch (error) {
    reportError(error, { where: `${WHERE} (read)` });
    return noStore({ items: [] });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const expected = process.env.SPONSORSHIP_ADMIN_KEY?.trim();
  if (!expected) {
    return noStore({ error: "Sponsorship admin is not configured." }, 503);
  }
  if (!adminKeyMatches(request.headers.get("x-admin-key"), expected)) {
    return noStore({ error: "Unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return noStore({ error: "Expected a JSON body." }, 400);
  }

  const parsed = parseSponsorshipInput(body);
  if (!parsed.ok) {
    return noStore({ error: parsed.errors.join(" ") }, 400);
  }

  try {
    const created = (await db.sponsorship.create({
      data: {
        ...parsed.value,
        placement: asDatabasePlacement(parsed.value.placement),
        disclosure:
          parsed.value.disclosure ?? `Sponsored by ${parsed.value.advertiser}`,
      },
    })) as SponsorshipRow;
    revalidateSponsorships();
    return noStore(toAdUnit(created, createEventToken(created.id)), 201);
  } catch (error) {
    reportError(error, { where: `${WHERE} (write)` });
    return noStore({ error: "Could not save the sponsorship." }, 500);
  }
}
