import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET, maxDuration } from "../route";
import { sendPushNotifications } from "@/app/actions/push-actions";
import { syncWorldNews } from "@/app/actions/sync-news-api";
import { syncFromScraper } from "@/app/actions/sync-scraper";
import { sendMorningBriefing } from "@/lib/briefing-service";
import { syncMarketPrices } from "@/lib/market-sync-service";
import { processPriceAlerts } from "@/lib/price-alert-service";
import { syncScraperVideos } from "@/lib/video-sync";

vi.mock("@/app/actions/push-actions", () => ({
  sendPushNotifications: vi.fn(),
}));
vi.mock("@/app/actions/sync-news-api", () => ({ syncWorldNews: vi.fn() }));
vi.mock("@/app/actions/sync-scraper", () => ({ syncFromScraper: vi.fn() }));
vi.mock("@/lib/briefing-service", () => ({ sendMorningBriefing: vi.fn() }));
vi.mock("@/lib/market-sync-service", () => ({ syncMarketPrices: vi.fn() }));
vi.mock("@/lib/price-alert-service", () => ({ processPriceAlerts: vi.fn() }));
vi.mock("@/lib/video-sync", () => ({
  syncScraperVideos: vi.fn(),
  VIDEO_SYNC_MAX_DURATION_S: 60,
}));

const videos = vi.mocked(syncScraperVideos);
const push = vi.mocked(sendPushNotifications);

function get(secret?: string): Request {
  return new Request("http://localhost/api/cron/sync", {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-secret";
  vi.mocked(syncFromScraper).mockResolvedValue({
    success: true,
    count: 2,
  } as never);
  vi.mocked(syncWorldNews).mockResolvedValue({
    success: true,
    count: 0,
  } as never);
  vi.mocked(syncMarketPrices).mockResolvedValue({ success: true } as never);
  vi.mocked(processPriceAlerts).mockResolvedValue({
    notified: 0,
    hits: 0,
  } as never);
  vi.mocked(sendMorningBriefing).mockResolvedValue({ sent: 0 } as never);
  vi.mocked(push).mockResolvedValue({ sent: 0 } as never);
  videos.mockResolvedValue({
    triggered: true,
    trigger: { status: "success" },
    triggerError: null,
    count: 7,
    readMs: 120,
    readError: null,
    sample: [],
  });
});

describe("GET /api/cron/sync", () => {
  it("keeps the documented budget and the segment config in step", async () => {
    // Next reads `maxDuration` statically, so the route has to carry the literal.
    // The real module is imported here rather than the mock below, or the
    // comparison would be against a number this file made up.
    const actual = (await vi.importActual("@/lib/video-sync")) as {
      VIDEO_SYNC_MAX_DURATION_S: number;
    };

    expect(maxDuration).toBe(actual.VIDEO_SYNC_MAX_DURATION_S);
  });

  it("rejects a request without the cron secret, without syncing anything", async () => {
    const response = await GET(get());

    expect(response.status).toBe(401);
    expect(videos).not.toHaveBeenCalled();
    expect(vi.mocked(syncFromScraper)).not.toHaveBeenCalled();
  });

  it("runs the video ingestion as part of the scheduled sync", async () => {
    // Videos had no scheduled ingestion: the scraper's own sync was only
    // reachable from the dashboard, so the reels feed could sit empty forever.
    await GET(get("test-secret"));

    expect(videos).toHaveBeenCalledWith({ trigger: true });
  });

  it("reports the video count without letting it inflate the news push", async () => {
    const body = await (await GET(get("test-secret"))).json();

    expect(body.videos).toMatchObject({
      count: 7,
      triggerError: null,
      readError: null,
    });
    // Two articles synced, seven videos read: the push is about the articles.
    expect(body.count).toBe(2);
    expect(push).toHaveBeenCalledWith(
      "Breaking News",
      "2 new articles on SLNews. Tap to read.",
      "/",
      { category: "breaking" }
    );
  });

  it("keeps the sync green when the video step rejects", async () => {
    videos.mockRejectedValue(new Error("boom"));

    const response = await GET(get("test-secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.videos).toMatchObject({ count: 0, readError: "rejected" });
  });
});
