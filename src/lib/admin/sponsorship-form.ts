/** Validation shared by the console form and its tests. */

export type CampaignInput = {
  placement: string;
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
  startsAt?: Date;
  endsAt?: Date;
};

export const PLACEMENTS = ["feed", "sports_stream", "article_end"] as const;

export type ParseResult =
  { ok: true; value: CampaignInput } | { ok: false; errors: string[] };

function str(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function dateOrUndefined(raw: string): Date | undefined {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
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
  const imageUrl = str(data, "imageUrl");

  if (!PLACEMENTS.includes(placement as (typeof PLACEMENTS)[number])) {
    errors.push("Choose a valid placement.");
  }
  if (!advertiser) errors.push("Advertiser is required.");
  if (!headline || headline.length > 40)
    errors.push("Headline is required (max 40 chars).");
  if (!body || body.length > 80)
    errors.push("Body is required (max 80 chars).");
  if (!ctaLabel || ctaLabel.length > 18)
    errors.push("CTA label is required (max 18 chars).");
  if (!/^https?:\/\//i.test(ctaUrl))
    errors.push("CTA URL must start with http(s)://.");
  if (startsAt && endsAt && endsAt <= startsAt)
    errors.push("End must be after start.");
  if (imageUrl && !/^https:\/\//i.test(imageUrl))
    errors.push("Image URL must start with https://.");

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      placement,
      advertiser,
      headline,
      body,
      ctaLabel,
      ctaUrl,
      brandHex: str(data, "brandHex") || "#0B6FD1",
      brandAccentHex: str(data, "brandAccentHex") || "#2E9BF5",
      assetLabel: str(data, "assetLabel") || undefined,
      disclosure: str(data, "disclosure") || undefined,
      imageUrl: imageUrl || undefined,
      startsAt,
      endsAt,
    },
  };
}
