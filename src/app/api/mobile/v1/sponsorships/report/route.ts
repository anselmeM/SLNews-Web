/**
 * `/api/mobile/v1/sponsorships/report` — per-campaign delivery numbers.
 *
 * Admin-only (`x-admin-key`). Counters come from daily metric rows, so
 * `from`/`to` produce a real monthly view instead of lifetime totals.
 *
 * GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&format=json|csv
 */
import { NextResponse } from "next/server";
import {
  loadSponsorshipReport,
  reportRange,
  reportToCsv,
} from "@/lib/admin/sponsorship-report";
import { adminKeyMatches } from "@/lib/admin-key";
import { reportError } from "@/lib/error-reporting";

const WHERE = "api/mobile/v1/sponsorships/report";

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  const expected = process.env.SPONSORSHIP_ADMIN_KEY?.trim();
  if (!expected) {
    return json({ error: "Sponsorship admin is not configured." }, 503);
  }
  if (!adminKeyMatches(request.headers.get("x-admin-key"), expected)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const url = new URL(request.url);
  const range = reportRange(
    url.searchParams.get("from"),
    url.searchParams.get("to")
  );
  if (!range) return json({ error: "Invalid date range." }, 400);

  try {
    const items = await loadSponsorshipReport(range.from, range.to);
    if (url.searchParams.get("format") === "csv") {
      return new NextResponse(reportToCsv(items, range.from, range.to), {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="sponsorships-${range.from
            .toISOString()
            .slice(0, 10)}-to-${range.to.toISOString().slice(0, 10)}.csv"`,
        },
      });
    }
    return json({
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      items,
    });
  } catch (error) {
    reportError(error, { where: `${WHERE} (read)` });
    return json({ error: "Could not read the report." }, 500);
  }
}
