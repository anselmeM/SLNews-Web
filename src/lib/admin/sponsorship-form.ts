/** Validation shared by the console form and its tests. */

import {
  SPONSORSHIP_LIMITS,
  SPONSORSHIP_PLACEMENTS,
  isApprovedCreativeUrl,
  type SponsorshipPlacementValue,
} from "@/lib/sponsorship-validation";

export const PLACEMENTS = SPONSORSHIP_PLACEMENTS;

export type CampaignInput = {
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

export type ParseResult =
  { ok: true; value: CampaignInput } | { ok: false; errors: string[] };

function str(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optionalStr(data: FormData, key: string): string | undefined {
  const value = str(data, key);
  return value.length > 0 ? value : undefined;
}

function dateOrUndefined(raw: string): Date | undefined | null {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function intOrUndefined(
  data: FormData,
  key: string
): number | undefined | null {
  const raw = str(data, key);
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
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

/** Parses and bounds a submitted campaign, mirroring the public API rules. */
export function parseCampaignForm(data: FormData): ParseResult {
  const errors: string[] = [];
  const placement = str(data, "placement");
  const advertiser = str(data, "advertiser");
  const headline = str(data, "headline");
  const body = str(data, "body");
  const ctaLabel = str(data, "ctaLabel");
  const ctaUrl = str(data, "ctaUrl");
  const startsAt = dateOrUndefined(str(data, "startsAt"));
  const endsAt = dateOrUndefined(str(data, "endsAt"));
  const rawImageUrl = str(data, "imageUrl");
  const imageUrl = rawImageUrl
    ? rawImageUrl.includes("://")
      ? rawImageUrl.replace(/^http:\/\//i, "https://")
      : `https://${rawImageUrl}`
    : "";
  const altText = optionalStr(data, "altText");
  const priority = intOrUndefined(data, "priority") ?? 0;
  const weight = intOrUndefined(data, "weight") ?? 1;
  const maxImpressions = intOrUndefined(data, "maxImpressions");
  const dailyImpressionCap = intOrUndefined(data, "dailyImpressionCap");

  if (!(PLACEMENTS as readonly string[]).includes(placement)) {
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
  if (!body || body.length > SPONSORSHIP_LIMITS.body) {
    errors.push(`Body is required (max ${SPONSORSHIP_LIMITS.body} chars).`);
  }
  if (!ctaLabel || ctaLabel.length > SPONSORSHIP_LIMITS.ctaLabel) {
    errors.push(
      `CTA label is required (max ${SPONSORSHIP_LIMITS.ctaLabel} chars).`
    );
  }
  if (!validHttpUrl(ctaUrl) || ctaUrl.length > SPONSORSHIP_LIMITS.ctaUrl) {
    errors.push("CTA URL must be an absolute http(s) URL without credentials.");
  }
  if (startsAt === null) errors.push("Starts must be a valid date.");
  if (endsAt === null) errors.push("Ends must be a valid date.");
  if (
    startsAt instanceof Date &&
    endsAt instanceof Date &&
    endsAt <= startsAt
  ) {
    errors.push("End must be after start.");
  }
  if (imageUrl) {
    if (imageUrl.length > SPONSORSHIP_LIMITS.imageUrl) {
      errors.push("Image URL is too long.");
    } else if (!isApprovedCreativeUrl(imageUrl)) {
      errors.push(
        "Image URL must be an approved Vercel Blob or creative-proxy https URL."
      );
    }
    if (!altText) {
      errors.push("Alt text is required when a creative image is supplied.");
    }
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(str(data, "brandHex") || "#0B6FD1")) {
    errors.push("Brand colour must be a #RRGGBB value.");
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(str(data, "brandAccentHex") || "#2E9BF5")) {
    errors.push("Accent colour must be a #RRGGBB value.");
  }
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
    if (
      cap !== undefined &&
      cap !== null &&
      cap > SPONSORSHIP_LIMITS.maxImpressionCap
    ) {
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
      body,
      ctaLabel,
      ctaUrl,
      brandHex: str(data, "brandHex") || "#0B6FD1",
      brandAccentHex: str(data, "brandAccentHex") || "#2E9BF5",
      assetLabel: optionalStr(data, "assetLabel"),
      disclosure: optionalStr(data, "disclosure"),
      imageUrl: imageUrl || undefined,
      altText,
      startsAt: startsAt instanceof Date ? startsAt : undefined,
      endsAt: endsAt instanceof Date ? endsAt : undefined,
      priority,
      weight,
      maxImpressions: maxImpressions ?? undefined,
      dailyImpressionCap: dailyImpressionCap ?? undefined,
    },
  };
}
