/**
 * `/api/mobile/v1/sponsorships` — directly sold sponsorship units.
 *
 * The app renders house ads from its seed; this endpoint lets a sold creative be
 * inserted per placement without shipping a release. Reads are public and cache
 * for a minute; writes need `x-admin-key` matching SPONSORSHIP_ADMIN_KEY.
 *
 * GET ?placement=feed -> { items: AdUnit-shaped[] } (only active, in window)
 * POST {placement, advertiser, headline, body, ctaLabel, ctaUrl, ...} -> 201
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { reportError } from "@/lib/error-reporting";
import { adminKeyMatches } from "@/lib/admin-key";

const WHERE = "api/mobile/v1/sponsorships";
const MAX_ITEMS = 6;
const REQUIRED = [
  "placement",
  "advertiser",
  "headline",
  "body",
  "ctaLabel",
  "ctaUrl",
] as const;

function noStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

type Row = {
  id: string;
  placement: string;
  advertiser: string;
  headline: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  brandHex: string;
  brandAccentHex: string;
  assetLabel: string | null;
  disclosure: string | null;
  imageUrl: string | null;
};

/** AdUnit-shaped payload the Flutter app already renders. */
function toAdUnit(row: Row) {
  return {
    id: row.id,
    placement: row.placement,
    headline: row.headline,
    body: row.body,
    ctaLabel: row.ctaLabel,
    advertiser: row.advertiser,
    brandHex: row.brandHex,
    brandAccentHex: row.brandAccentHex,
    assetLabel: row.assetLabel,
    disclosure: row.disclosure,
    imageUrl: row.imageUrl,
    targetUrl: row.ctaUrl,
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  const placement = new URL(request.url).searchParams.get("placement")?.trim();
  const now = new Date();
  try {
    const rows = (await db.sponsorship.findMany({
      where: {
        active: true,
        ...(placement ? { placement } : {}),
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gte: now } }],
      },
      orderBy: { startsAt: "desc" },
      take: MAX_ITEMS,
    })) as Row[];
    return NextResponse.json(
      { items: rows.map(toAdUnit) },
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
  const missing = REQUIRED.filter((key) => {
    const value = body[key];
    return typeof value !== "string" || value.trim().length === 0;
  });
  if (missing.length > 0) {
    return noStore({ error: `Missing fields: ${missing.join(", ")}` }, 400);
  }
  if (!/^https?:\/\//i.test(String(body.ctaUrl))) {
    return noStore({ error: "ctaUrl must be an absolute http(s) URL." }, 400);
  }
  if (
    typeof body.imageUrl === "string" &&
    body.imageUrl.trim() &&
    !/^https:\/\//i.test(body.imageUrl.trim())
  ) {
    return noStore({ error: "imageUrl must be an absolute https URL." }, 400);
  }

  try {
    const created = (await db.sponsorship.create({
      data: {
        placement: String(body.placement).trim(),
        advertiser: String(body.advertiser).trim(),
        headline: String(body.headline).trim(),
        body: String(body.body).trim(),
        ctaLabel: String(body.ctaLabel).trim(),
        ctaUrl: String(body.ctaUrl).trim(),
        brandHex: typeof body.brandHex === "string" ? body.brandHex : undefined,
        brandAccentHex:
          typeof body.brandAccentHex === "string"
            ? body.brandAccentHex
            : undefined,
        assetLabel:
          typeof body.assetLabel === "string" ? body.assetLabel : undefined,
        disclosure:
          typeof body.disclosure === "string" ? body.disclosure : undefined,
        imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : undefined,
        endsAt:
          typeof body.endsAt === "string" ? new Date(body.endsAt) : undefined,
      },
    })) as Row;
    return noStore(toAdUnit(created), 201);
  } catch (error) {
    reportError(error, { where: `${WHERE} (write)` });
    return noStore({ error: "Could not save the sponsorship." }, 500);
  }
}
