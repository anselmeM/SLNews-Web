import { NextResponse } from "next/server";
import { syncScraperVideos } from "@/lib/video-sync";

/**
 * On-demand video ingestion diagnostics.
 *
 * `/reels` renders six curated clips and no scraped video, and the cause was
 * invisible: the feed logs `scraper returned no videos` both when the endpoint
 * has nothing and when the ingestion is broken. The scraper's own ingestion was
 * only reachable by an admin pressing a button, so nobody could tell whether it
 * had ever run.
 *
 * `?trigger=0` reads without ingesting, which is how the result of a previous run
 * is observed: the scraper may ingest asynchronously, so reading in the same
 * breath as the trigger can legitimately return the older list.
 *
 * The scheduled half of this runs from `/api/cron/sync`, which already holds the
 * cron slot — see `src/lib/video-sync.ts` and the `Video` table note in
 * docs/TODO.md.
 */
// A literal on purpose: Next reads segment config statically, and an imported
// identifier fails the build ("Unknown identifier ... at maxDuration"). The
// documented budget lives in `VIDEO_SYNC_MAX_DURATION_S`, and a test asserts the
// two agree.
export const maxDuration = 60;

export async function GET(request: Request) {
  // Bearer only: a ?secret= would leak into logs, referrers and caches.
  const authHeader = request.headers.get("authorization");
  const isValid =
    Boolean(process.env.CRON_SECRET) &&
    authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isValid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const report = await syncScraperVideos({
    trigger: searchParams.get("trigger") !== "0",
    // A diagnostic, not a bulk export.
    limit: Math.min(Number(searchParams.get("limit")) || 20, 50),
  });

  return NextResponse.json({
    // An empty list is an answer, not a failure; only a failed read is one.
    success: report.readError === null,
    ...report,
  });
}
