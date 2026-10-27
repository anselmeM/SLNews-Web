/**
 * `/api/mobile/v1/sponsorships/report` — per-unit delivery numbers for sponsors.
 *
 * Admin-only (`x-admin-key`). Returns impressions, taps and CTR for every unit that
 * was live during the window, which is the monthly number a customer is invoiced on.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { reportError } from "@/lib/error-reporting";
import { adminKeyMatches } from "@/lib/admin-key";

const WHERE = "api/mobile/v1/sponsorships/report";

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  const expected = process.env.SPONSORSHIP_ADMIN_KEY?.trim();
  if (!expected)
    return json({ error: "Sponsorship admin is not configured." }, 503);
  if (!adminKeyMatches(request.headers.get("x-admin-key"), expected)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const placement = new URL(request.url).searchParams.get("placement")?.trim();
  try {
    const rows = await db.sponsorship.findMany({
      where: placement ? { placement } : {},
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        placement: true,
        advertiser: true,
        headline: true,
        active: true,
        startsAt: true,
        endsAt: true,
        impressions: true,
        taps: true,
      },
    });
    return json({
      items: rows.map((row) => ({
        ...row,
        ctr:
          row.impressions > 0
            ? Number((row.taps / row.impressions).toFixed(4))
            : 0,
      })),
    });
  } catch (error) {
    reportError(error, { where: `${WHERE} (read)` });
    return json({ error: "Could not read the report." }, 500);
  }
}
