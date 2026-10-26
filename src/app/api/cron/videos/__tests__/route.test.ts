import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET, maxDuration } from "../route";
import { logger } from "@/lib/logger";
import {
  fetchScraperVideos,
  triggerScraperVideoSync,
} from "@/lib/scraper-client";
import { VIDEO_SYNC_MAX_DURATION_S } from "@/lib/video-sync";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/scraper-client", () => ({
  fetchScraperVideos: vi.fn(),
  triggerScraperVideoSync: vi.fn(),
  VIDEO_REQUEST_TIMEOUT_MS: 10_000,
}));

const fetchVideos = vi.mocked(fetchScraperVideos);
const triggerSync = vi.mocked(triggerScraperVideoSync);

function get(query = "", secret?: string): Request {
  return new Request(`http://localhost/api/cron/videos${query}`, {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

const VIDEO = {
  id: 1,
  videoId: "abc123",
  title: "Freetown Port Commissioned",
  url: "https://www.youtube.com/watch?v=abc123",
  description: null,
  thumbnailUrl: null,
  channelId: "UC1",
  channelTitle: "AYV News Sierra Leone",
  publishedAt: "2026-09-01T10:00:00.000Z",
  category: ["National"],
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-secret";
  triggerSync.mockResolvedValue({ status: "success" });
  fetchVideos.mockResolvedValue([VIDEO]);
});

describe("GET /api/cron/videos", () => {
  it("keeps the documented budget and the segment config in step", () => {
    // Next reads `maxDuration` statically, so the route has to carry the literal.
    expect(maxDuration).toBe(VIDEO_SYNC_MAX_DURATION_S);
  });

  it("rejects a request without the cron secret", async () => {
    const response = await GET(get("?trigger=0"));

    expect(response.status).toBe(401);
    expect(triggerSync).not.toHaveBeenCalled();
    expect(fetchVideos).not.toHaveBeenCalled();
  });

  it("accepts the secret as a bearer header", async () => {
    const request = new Request("http://localhost/api/cron/videos?trigger=0", {
      headers: { authorization: "Bearer test-secret" },
    });

    expect((await GET(request)).status).toBe(200);
  });

  it("runs the scraper's ingestion and reports what came back", async () => {
    const response = await GET(get("", "test-secret"));
    const body = await response.json();

    expect(triggerSync).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({ success: true, triggered: true, count: 1 });
    expect(body.sample).toEqual([
      {
        videoId: "abc123",
        title: "Freetown Port Commissioned",
        channelTitle: "AYV News Sierra Leone",
        publishedAt: "2026-09-01T10:00:00.000Z",
        url: "https://www.youtube.com/watch?v=abc123",
      },
    ]);
  });

  it("reads only, so a previous ingestion can be observed", async () => {
    // The scraper may ingest asynchronously: reading in the same breath as the
    // trigger can legitimately return the older list.
    const response = await GET(get("?trigger=0", "test-secret"));
    const body = await response.json();

    expect(triggerSync).not.toHaveBeenCalled();
    expect(body).toMatchObject({ triggered: false, count: 1 });
  });

  it("reports an empty result without treating it as an error", async () => {
    // This is the measurement that decides whether a stored copy is worth
    // having: zero is an answer, not a failure.
    fetchVideos.mockResolvedValue([]);

    const response = await GET(get("?trigger=0", "test-secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, count: 0 });
    expect(logger.info).toHaveBeenCalledWith(
      "videos: scraped video count",
      expect.objectContaining({ count: 0 })
    );
  });

  it("still reads the list when the ingestion trigger fails", async () => {
    triggerSync.mockRejectedValue(new Error("Scraper unreachable"));

    const response = await GET(get("", "test-secret"));
    const body = await response.json();

    expect(body).toMatchObject({
      success: true,
      triggerError: "Scraper unreachable",
      count: 1,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "videos: scraper ingestion trigger failed",
      expect.objectContaining({ error: "Scraper unreachable" })
    );
  });

  it("reports a failed read", async () => {
    fetchVideos.mockRejectedValue(new Error("Scraper unreachable"));

    const response = await GET(get("?trigger=0", "test-secret"));
    const body = await response.json();

    expect(body).toMatchObject({
      success: false,
      count: 0,
      readError: "Scraper unreachable",
    });
  });

  it("caps the requested page size", async () => {
    await GET(get("?trigger=0&limit=500", "test-secret"));

    // 50 is the ceiling: the endpoint is a diagnostic, not a bulk export.
    expect(fetchVideos).toHaveBeenCalledWith(50, 1, expect.any(Number));
  });

  it("falls back to a sensible page size for a nonsense limit", async () => {
    await GET(get("?trigger=0&limit=abc", "test-secret"));

    expect(fetchVideos).toHaveBeenCalledWith(20, 1, expect.any(Number));
  });
});
