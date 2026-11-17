/**
 * FCM topic names for follow-scoped alerts.
 *
 * The Flutter app subscribes one topic per followed entity
 * (`slnews_topic_politics`, `slnews_team_lal`, `slnews_publisher_awoko`) plus
 * the breaking broadcast, in `lib/core/push/push_segments.dart`. These two
 * functions are the server half of that contract: **changing the format here
 * without changing the app silently stops alert delivery**, so the shape is
 * pinned by tests on both sides.
 */

/** Broadcast topic every reader who enabled breaking news subscribes to. */
export const BREAKING_TOPIC = "slnews_breaking";

/**
 * Topic name for a follow id (`publisher:awoko` -> `slnews_publisher_awoko`).
 *
 * FCM topics accept only `[a-zA-Z0-9-_.~%]`, so `:` and anything else outside
 * that set become `_` — the same normalisation the app applies before
 * subscribing.
 */
export function topicForTarget(target: string): string {
  const cleaned = target
    .trim()
    .replace(/:/g, "_")
    .replace(/[^A-Za-z0-9_.~%-]/g, "_");
  return `slnews_${cleaned}`;
}

/**
 * Publisher id for a story's canonical URL, matching the app's outlet registry
 * (`SLNews-App` `lib/core/data/seed/outlet_registry.dart`).
 *
 * The web `Article` row has no publisher column, so the outlet is inferred from
 * the scraped URL's host. Unknown hosts get no publisher target: guessing an id
 * would publish to a topic nobody subscribes to.
 */
const PUBLISHER_BY_HOST: Record<string, string> = {
  "thesierraleonetelegraph.com": "sltelegraph",
  "sierraloaded.sl": "sierraloaded",
  "bbc.co.uk": "bbcafrica",
  "bbc.com": "bbcafrica",
  "awoko.org": "awoko",
  "concordtimes.net": "concordtimes",
  "politicosl.com": "politicosl",
  "standardtimespress.net": "standardtimes",
  "kallonsnewswire.com": "kallon",
  "reuters.com": "reuters",
  "apnews.com": "ap",
  "footballsierraleone.com": "footballsierraleone",
};

export function publisherTargetForUrl(
  sourceUrl: string | null | undefined
): string | null {  if (!sourceUrl) return null;
  let host: string;
  try {
    host = new URL(sourceUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  const bare = host.replace(/^www\./, "");
  // Longest suffix wins so `sport.bbc.co.uk` resolves through `bbc.co.uk` and a
  // future `news.awoko.org` still finds `awoko.org`.
  let match: string | null = null;
  for (const candidate of Object.keys(PUBLISHER_BY_HOST)) {
    if (bare === candidate || bare.endsWith(`.${candidate}`)) {
      if (!match || candidate.length > match.length) match = candidate;
    }
  }
  return match ? `publisher:${PUBLISHER_BY_HOST[match]}` : null;
}

/** `Politics` -> `topic:politics` (the app's category follow id). */
export function categoryTargetForName(name: string): string | null {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `topic:${slug}` : null;
}

/**
 * Display name for a publisher id, used in the digest copy ("New from
 * Awoko Newspaper"). Mirrors the app's outlet registry.
 */
const PUBLISHER_NAMES: Record<string, string> = {
  sltelegraph: "The Sierra Leone Telegraph",
  sierraloaded: "Sierraloaded",
  bbcafrica: "BBC News Africa",
  awoko: "Awoko Newspaper",
  concordtimes: "Concord Times",
  politicosl: "Politico SL",
  standardtimes: "Standard Times",
  kallon: "Kallon's Newswire",
  reuters: "Reuters Africa",
  ap: "AP Africa",
  footballsierraleone: "Football Sierra Leone",
};

export function publisherNameForId(id: string): string | null {
  return PUBLISHER_NAMES[id] ?? null;
}
