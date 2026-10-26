import { NextResponse } from "next/server";
import { sendPushNotifications } from "@/app/actions/push-actions";
import { syncWorldNews } from "@/app/actions/sync-news-api";
import { syncFromScraper } from "@/app/actions/sync-scraper";
import { sendMorningBriefing } from "@/lib/briefing-service";
import { syncMarketPrices } from "@/lib/market-sync-service";
import { processPriceAlerts } from "@/lib/price-alert-service";
import { syncScraperVideos } from "@/lib/video-sync";

// A literal on purpose: Next reads segment config statically, and an imported
// identifier fails the build ("Unknown identifier ... at maxDuration"). The
// documented budget lives in `VIDEO_SYNC_MAX_DURATION_S`, and a test asserts the
// two agree.
//
// The video step waits on the scraper's own ingestion run (up to 40s) before it
// reads the list, and it runs alongside the others rather than after them.
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

  const [sl, world, market, priceAlerts, briefing, videos] =
    await Promise.allSettled([
      syncFromScraper(),
      syncWorldNews(),
      syncMarketPrices(),
      processPriceAlerts(),
      sendMorningBriefing(),
      // Videos had no scheduled ingestion at all: the scraper's own sync was only
      // reachable from the dashboard, so the feed could sit empty indefinitely.
      syncScraperVideos({ trigger: true }),
    ]);

  const slResult =
    sl.status === "fulfilled"
      ? sl.value
      : { success: false, error: "rejected", count: 0 };
  const worldResult =
    world.status === "fulfilled"
      ? world.value
      : { success: false, error: "rejected", count: 0 };
  const marketResult =
    market.status === "fulfilled"
      ? market.value
      : { success: false, error: "rejected", count: 0 };
  const priceAlertResult =
    priceAlerts.status === "fulfilled"
      ? priceAlerts.value
      : { notified: 0, hits: 0, error: "rejected" };
  const briefingResult =
    briefing.status === "fulfilled"
      ? briefing.value
      : { sent: 0, error: "rejected" };
  const videosResult =
    videos.status === "fulfilled"
      ? videos.value
      : { count: 0, triggerError: "rejected", readError: "rejected" };

  // Videos are not news: they do not feed the breaking-news push, so they stay out
  // of `total`. Only the count is reported, so this stays observable in the cron's
  // response and in `videos: scraped video count`.
  const total = (slResult.count ?? 0) + (worldResult.count ?? 0);
  const ok = slResult.success || worldResult.success || marketResult.success;

  let pushResult = { sent: 0 };
  if (total > 0) {
    pushResult = await sendPushNotifications(
      "Breaking News",
      `${total} new article${total > 1 ? "s" : ""} on SLNews. Tap to read.`,
      "/",
      { category: "breaking" }
    );
  }

  return NextResponse.json({
    success: ok,
    sierraLeone: slResult,
    world: worldResult,
    marketPrices: marketResult,
    priceAlerts: priceAlertResult,
    briefing: briefingResult,
    videos: {
      count: videosResult.count,
      triggerError: videosResult.triggerError,
      readError: videosResult.readError,
    },
    count: total,
    push: pushResult,
  });
}
