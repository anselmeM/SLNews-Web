import { eventTokenTtlMs } from "@/lib/sponsorship-events";

/** Row shape read from the Sponsorship table and served to the mobile app. */
export type SponsorshipRow = {
  id: string;
  placement: string;
  advertiser: string;
  headline: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  brandHex: string;
  brandAccentHex: string;
  assetLabel: string | null;
  disclosure: string | null;
  imageUrl: string | null;
  altText: string | null;
  priority: number;
  weight: number;
  maxImpressions: number | null;
  dailyImpressionCap: number | null;
  impressions: number;
};

/** AdUnit-shaped payload the Flutter app already renders. */
export function toAdUnit(row: SponsorshipRow, eventToken: string | null) {
  return {
    id: row.id,
    placement: row.placement,
    headline: row.headline,
    body: row.body,
    ctaLabel: row.ctaLabel,
    advertiser: row.advertiser,
    brandHex: row.brandHex,
    brandAccentHex: row.brandAccentHex,
    assetLabel: row.assetLabel,
    disclosure: row.disclosure,
    imageUrl: row.imageUrl,
    altText: row.altText,
    targetUrl: row.ctaUrl,
    eventToken,
    eventTokenExpiresAt: eventToken
      ? new Date(Date.now() + eventTokenTtlMs()).toISOString()
      : null,
  };
}
