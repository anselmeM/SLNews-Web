// Typed client for the Sierra Leone news scraper API (Render).
//
// The app is "customer #1" and consumes the LEGACY full-text endpoint
// `GET /api/news`. It must NOT move to the versioned `GET /v1/news` business
// contract: that payload is metadata-only — no `link`, no `paragraphs` — so the
// sync would silently skip every article.
//
// Error mapping (kept stable for the sync action):
//   - SCRAPER_API_KEY missing        -> Error("SCRAPER_API_KEY is not set")
//   - network failure                -> ScraperUnreachableError
//   - no answer within the timeout   -> ScraperUnreachableError (logged)
//   - non-OK response (incl. 401)    -> Error("Scraper responded <status>")
//   - unexpected body shape          -> Error("Unexpected scraper payload")

import { logger } from "@/lib/logger";

export type ScraperArticle = {
  id?: number | string;
  title?: string;
  link?: string;
  author?: string;
  description?: string;
  category?: string[];
  imageUrl?: string;
  paragraphs?: string[];
  pubDate?: string;
  source?: string;
  /** Follow ids the scraper derived for the story (`team:lal`, `league:spl`). */
  teams?: string[];
  createdAt?: string;
};

export type ScraperVideo = {
  id: number;
  videoId: string;
  title: string;
  url: string;
  description: string | null;
  thumbnailUrl: string | null;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  category: string[];
};

/**
 * Request timeouts.
 *
 * The scraper runs on Render, where an idle instance spins down — so the first
 * request after a quiet spell waits for the boot. Without a timeout that wait
 * happens *inside a page render*: `/reels` was measured at 54.8s end-to-end
 * against 0.8s when the instance was warm, and the `try/catch` around the call
 * only ever handled a *failed* request, never a slow one.
 *
 * The first attempt cut the video feed at 4s, and production logs then showed
 * every `/reels` request timing out — a cold Render boot measured at 5.5s, so the
 * cut fired every time and the scraped feed rendered nothing at all while the
 * curated clips quietly covered for it. 10s clears a measured boot with room to
 * spare; a pathological boot still falls back, and this call is slated to leave
 * the request path entirely once videos are synced ahead of the reader.
 *
 * The defaults differ on purpose:
 * - the video feed is on the interactive path, so it gives up and falls back;
 * - the news sync is a bulk cron job with no reader waiting, and its payload is
 *   legitimately slower;
 * - the sync trigger waits on the scraper's own ingestion run.
 */
export const VIDEO_REQUEST_TIMEOUT_MS = 10_000;
export const NEWS_REQUEST_TIMEOUT_MS = 20_000;
export const SYNC_REQUEST_TIMEOUT_MS = 60_000;

/** Raised when the scraper host cannot be reached at the network level. */
export class ScraperUnreachableError extends Error {
  constructor() {
    super("Scraper unreachable");
    this.name = "ScraperUnreachableError";
  }
}

/**
 * A timeout and a refused connection are the same thing to a caller — the host
 * did not answer in useful time — but only one of them is worth a log line: a
 * timeout means the instance was probably asleep, which is what an operator
 * needs to see to know the feed is running on fallback content.
 */
function unreachable(
  url: string,
  timeoutMs: number,
  cause: unknown
): ScraperUnreachableError {
  if ((cause as { name?: string } | null)?.name === "TimeoutError") {
    logger.warn("scraper request timed out", { url, timeoutMs });
  }
  return new ScraperUnreachableError();
}

const DEFAULT_BASE_URL = "https://slnewsapiscapper.onrender.com";

function baseUrl(): string {
  return (process.env.SCRAPER_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function apiKey(): string {
  const key = process.env.SCRAPER_API_KEY;
  if (!key) throw new Error("SCRAPER_API_KEY is not set");
  return key;
}

function normalizePayload(json: unknown): ScraperArticle[] {
  if (Array.isArray(json)) return json as ScraperArticle[];
  if (
    json &&
    typeof json === "object" &&
    Array.isArray((json as { data?: unknown }).data)
  ) {
    return (json as { data: ScraperArticle[] }).data;
  }
  throw new Error("Unexpected scraper payload");
}

function normalizeVideoPayload(json: unknown): ScraperVideo[] {
  if (Array.isArray(json)) return json as ScraperVideo[];
  if (
    json &&
    typeof json === "object" &&
    Array.isArray((json as { data?: unknown }).data)
  ) {
    return (json as { data: ScraperVideo[] }).data;
  }
  throw new Error("Unexpected scraper payload");
}

/**
 * Fetch the latest scraped articles from the legacy full-text endpoint.
 *
 * Pinned to `/api/news` on purpose (see the file header): the app needs `link`
 * and `paragraphs`, which `/v1/news` does not provide. Every non-OK status
 * (401, 404, …) is therefore a real error, not a signal to try another route.
 */
export async function fetchScraperNews(
  timeoutMs: number = NEWS_REQUEST_TIMEOUT_MS
): Promise<ScraperArticle[]> {
  const key = apiKey();
  const url = `${baseUrl()}/api/news`;

  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw unreachable(url, timeoutMs, err);
  }

  if (!res.ok) {
    throw new Error(`Scraper responded ${res.status}`);
  }

  return normalizePayload(await res.json());
}

/**
 * Fetch scraped YouTube news videos and Shorts from the scraper API.
 */
export async function fetchScraperVideos(
  limit = 20,
  page = 1,
  timeoutMs: number = VIDEO_REQUEST_TIMEOUT_MS
): Promise<ScraperVideo[]> {
  const key = apiKey();
  const base = baseUrl();
  const url = `${base}/api/videos?limit=${limit}&page=${page}`;
  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw unreachable(url, timeoutMs, err);
  }

  if (!res.ok) {
    throw new Error(`Scraper responded ${res.status}`);
  }

  const videos = normalizeVideoPayload(await res.json());
  // Without this the only latency signal is a timeout, which cannot distinguish
  // "slow but working" from "not working" — the question this call kept raising.
  logger.info("scraper videos fetched", {
    ms: Date.now() - startedAt,
    count: videos.length,
    limit,
    page,
  });
  return videos;
}

/**
 * Trigger an immediate ingestion cycle of all YouTube channel feeds.
 */
export async function triggerScraperVideoSync(
  timeoutMs: number = SYNC_REQUEST_TIMEOUT_MS
): Promise<{ status: string; result?: unknown }> {
  const key = apiKey();
  const base = baseUrl();
  const url = `${base}/api/videos/sync`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw unreachable(url, timeoutMs, err);
  }

  if (!res.ok) {
    throw new Error(`Scraper responded ${res.status}`);
  }

  return (await res.json()) as { status: string; result?: unknown };
}
