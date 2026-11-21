/** Renderable placements. Keep aligned with the Flutter AdPlacement enum. */
export const SPONSORSHIP_PLACEMENTS = [
  "feed",
  "sports_stream",
  "article_end",
] as const;

export type SponsorshipPlacementValue = (typeof SPONSORSHIP_PLACEMENTS)[number];

export const SPONSORSHIP_LIMITS = {
  advertiser: 80,
  headline: 40,
  body: 80,
  ctaLabel: 18,
  ctaUrl: 500,
  imageUrl: 500,
  assetLabel: 20,
  disclosure: 120,
  altText: 120,
  maxPriority: 1000,
  maxWeight: 100,
  maxImpressionCap: 10_000_000,
} as const;

export type SponsorshipInput = {
  placement: SponsorshipPlacementValue;
  advertiser: string;
  headline: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  brandHex: string;
  brandAccentHex: string;
  assetLabel?: string;
  disclosure?: string;
  imageUrl?: string;
  altText?: string;
  startsAt?: Date;
  endsAt?: Date;
  priority: number;
  weight: number;
  maxImpressions?: number;
  dailyImpressionCap?: number;
};

export type SponsorshipParseResult =
  | { ok: true; value: SponsorshipInput }
  | { ok: false; errors: string[] };

const HEX = /^#[0-9a-fA-F]{6}$/;

export function isPlacement(value: unknown): value is SponsorshipPlacementValue {
  return (
    typeof value === "string" &&
    (SPONSORSHIP_PLACEMENTS as readonly string[]).includes(value)
  );
}

function str(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value.trim() : "";
}

function optionalStr(
  body: Record<string, unknown>,
  key: string
): string | undefined {
  const value = str(body, key);
  return value.length > 0 ? value : undefined;
}

function dateValue(
  body: Record<string, unknown>,
  key: string
): Date | undefined | null {
  const raw = str(body, key);
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function intValue(
  body: Record<string, unknown>,
  key: string
): number | undefined | null {
  const raw = body[key];
  if (raw === undefined || raw === null || raw === "") return undefined;
  const parsed =
    typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

/**
 * Accepts Vercel Blob URLs and our own private-store proxy only. Allowing any
 * HTTPS host would turn a sold ad into a third-party tracking pixel with the
 * reader's IP and user agent.
 */
export function isApprovedCreativeUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    if (url.hostname.endsWith(".public.blob.vercel-storage.com")) return true;
    if (
      url.pathname === "/api/mobile/v1/creative" &&
      (url.searchParams.get("path") ?? "").startsWith("sponsorships/")
    ) {
      return true;
    }
    const configured = (process.env.CREATIVE_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
    return configured.includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function validHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.length > 0 &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

/**
 * Validates a sponsorship payload for the mobile/admin APIs.
 *
 * The admin form has its own FormData parser, but both paths must enforce the
 * same limits; this function is the server-side source of truth.
 */
export function parseSponsorshipInput(
  body: Record<string, unknown>
): SponsorshipParseResult {
  const errors: string[] = [];
  const placement = str(body, "placement");
  const advertiser = str(body, "advertiser");
  const headline = str(body, "headline");
  const bodyCopy = str(body, "body");
  const ctaLabel = str(body, "ctaLabel");
  const ctaUrl = str(body, "ctaUrl");
  const brandHex = str(body, "brandHex") || "#0B6FD1";
  const brandAccentHex = str(body, "brandAccentHex") || "#2E9BF5";
  const imageUrl = optionalStr(body, "imageUrl");

  if (!isPlacement(placement)) {
    errors.push("Choose a valid placement.");
  }
  if (!advertiser || advertiser.length > SPONSORSHIP_LIMITS.advertiser) {
    errors.push(
      `Advertiser is required (max ${SPONSORSHIP_LIMITS.advertiser} chars).`
    );
  }
  if (!headline || headline.length > SPONSORSHIP_LIMITS.headline) {
    errors.push(
      `Headline is required (max ${SPONSORSHIP_LIMITS.headline} chars).`
    );
  }
  if (!bodyCopy || bodyCopy.length > SPONSORSHIP_LIMITS.body) {
    errors.push(`Body is required (max ${SPONSORSHIP_LIMITS.body} chars).`);
  }
  if (!ctaLabel || ctaLabel.length > SPONSORSHIP_LIMITS.ctaLabel) {
    errors.push(
      `CTA label is required (max ${SPONSORSHIP_LIMITS.ctaLabel} chars).`
    );
  }
  if (
    !ctaUrl ||
    ctaUrl.length > SPONSORSHIP_LIMITS.ctaUrl ||
    !validHttpUrl(ctaUrl)
  ) {
    errors.push("CTA URL must be an absolute http(s) URL without credentials.");
  }
  if (imageUrl) {
    if (imageUrl.length > SPONSORSHIP_LIMITS.imageUrl) {
      errors.push("Image URL is too long.");
    } else if (!isApprovedCreativeUrl(imageUrl)) {
      errors.push(
        "Image URL must be an approved Vercel Blob or creative-proxy https URL."
      );
    }
    if (!optionalStr(body, "altText")) {
      errors.push("Alt text is required when a creative image is supplied.");
    }
  }
  if (!HEX.test(brandHex) || !HEX.test(brandAccentHex)) {
    errors.push("Brand colours must be #RRGGBB hex values.");
  }

  const startsAt = dateValue(body, "startsAt");
  const endsAt = dateValue(body, "endsAt");
  if (startsAt === null) errors.push("Starts must be a valid date.");
  if (endsAt === null) errors.push("Ends must be a valid date.");
  if (startsAt instanceof Date && endsAt instanceof Date && endsAt <= startsAt) {
    errors.push("End must be after start.");
  }

  const priority = intValue(body, "priority") ?? 0;
  const weight = intValue(body, "weight") ?? 1;
  const maxImpressions = intValue(body, "maxImpressions");
  const dailyImpressionCap = intValue(body, "dailyImpressionCap");
  if (
    priority < 0 ||
    priority > SPONSORSHIP_LIMITS.maxPriority ||
    weight < 1 ||
    weight > SPONSORSHIP_LIMITS.maxWeight
  ) {
    errors.push("Priority/weight are out of range.");
  }
  for (const cap of [maxImpressions, dailyImpressionCap]) {
    if (cap !== undefined && (cap === null || cap < 0)) {
      errors.push("Delivery caps must be positive integers.");
    }
    if (cap !== undefined && cap !== null && cap > SPONSORSHIP_LIMITS.maxImpressionCap) {
      errors.push("Delivery cap is too large.");
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      placement: placement as SponsorshipPlacementValue,
      advertiser,
      headline,
      body: bodyCopy,
      ctaLabel,
      ctaUrl,
      brandHex,
      brandAccentHex,
      assetLabel: optionalStr(body, "assetLabel"),
      disclosure: optionalStr(body, "disclosure"),
      imageUrl,
      altText: optionalStr(body, "altText"),
      startsAt: startsAt instanceof Date ? startsAt : undefined,
      endsAt: endsAt instanceof Date ? endsAt : undefined,
      priority,
      weight,
      maxImpressions: maxImpressions ?? undefined,
      dailyImpressionCap: dailyImpressionCap ?? undefined,
    },
  };
}

export function asDatabasePlacement(
  placement: SponsorshipPlacementValue
): string {
  return placement;
}
