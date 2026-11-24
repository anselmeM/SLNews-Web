/**
 * Ad policy for directly sold sponsorship inventory.
 *
 * This module is the single server-side source of truth for which advertiser
 * categories SLNews accepts. Both the mobile/admin API (`parseSponsorshipInput`)
 * and the admin console form (`parseCampaignForm`) validate against it, so a
 * campaign cannot bypass the policy by using one entry point over the other.
 *
 * The list is an allow-list by design: a category that is not named here is
 * rejected even if it sounds harmless. Human review of the creative and the
 * landing page is still required — a category allow-list cannot detect a
 * misleading claim or a prohibited product promoted under "retail". See
 * `docs/AD-POLICY.md` for the operator-facing policy, review steps and legal
 * caveat.
 */

/** Categories accepted for sold campaigns, in admin-select order. */
export const AD_CATEGORIES = [
  "retail",
  "telecom",
  "banking",
  "insurance",
  "education",
  "health_services",
  "ngo",
  "events",
  "travel",
  "food",
  "automotive",
  "technology",
  "real_estate",
  "other",
] as const;

export type AdCategoryValue = (typeof AD_CATEGORIES)[number];

/**
 * Categories that must never be sold, independent of review. Keeping the list
 * explicit (rather than "anything not allowed") lets validation return a clear
 * policy error to an operator instead of a generic invalid-value message.
 */
export const PROHIBITED_AD_CATEGORIES = [
  "gambling",
  "betting",
  "lottery",
  "alcohol",
  "tobacco",
  "vaping",
  "adult",
  "weapons",
  "political",
  "predatory_lending",
  "payday_loans",
  "crypto",
  "mlm",
] as const;

export type ProhibitedAdCategoryValue =
  (typeof PROHIBITED_AD_CATEGORIES)[number];

export const AD_CATEGORY_LABELS: Record<AdCategoryValue, string> = {
  retail: "Retail / shop",
  telecom: "Telecom / mobile money",
  banking: "Banking / financial institution",
  insurance: "Insurance",
  education: "Education / training",
  health_services: "Health services / pharmacy",
  ngo: "NGO / development partner",
  events: "Community events",
  travel: "Travel / transport",
  food: "Food / restaurant",
  automotive: "Automotive",
  technology: "Technology / devices",
  real_estate: "Real estate",
  other: "Other (reviewed)",
};

export const AD_CATEGORY_OPTIONS: ReadonlyArray<{
  value: AdCategoryValue;
  label: string;
}> = AD_CATEGORIES.map((value) => ({
  value,
  label: AD_CATEGORY_LABELS[value],
}));

const PROHIBITED_LABELS: Record<ProhibitedAdCategoryValue, string> = {
  gambling: "gambling",
  betting: "sports betting",
  lottery: "lottery / sweepstakes",
  alcohol: "alcohol",
  tobacco: "tobacco",
  vaping: "vaping / e-cigarettes",
  adult: "adult content",
  weapons: "weapons / ammunition",
  political: "political campaigning or advocacy",
  predatory_lending: "predatory lending",
  payday_loans: "payday loans",
  crypto: "cryptocurrency promotions",
  mlm: "multi-level marketing / pyramid schemes",
};

/** Short note shown in the admin form next to the category select. */
export const AD_POLICY_NOTE =
  "Only reviewed local advertiser categories are accepted. Gambling, betting, lottery, alcohol, tobacco/vaping, adult, weapons, political, predatory/payday lending, crypto and MLM are prohibited.";

/**
 * Documentation link from the admin form. The policy text lives in the repo so
 * it is versioned and reviewable with the code that enforces it.
 */
export const AD_POLICY_DOC_URL = "/admin/sponsorships/policy";

/**
 * Normalizes a submitted category: trim, lowercase and turn spaces/hyphens into
 * underscores so "Health Services" and "health-services" reach the same value
 * as "health_services".
 */
export function normalizeAdCategory(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function isAllowedAdCategory(
  value: unknown
): value is AdCategoryValue {
  return (
    typeof value === "string" &&
    (AD_CATEGORIES as readonly string[]).includes(value)
  );
}

export function isProhibitedAdCategory(
  value: unknown
): value is ProhibitedAdCategoryValue {
  return (
    typeof value === "string" &&
    (PROHIBITED_AD_CATEGORIES as readonly string[]).includes(value)
  );
}

export type AdCategoryValidation =
  | { ok: true; value: AdCategoryValue }
  | { ok: false; error: string };

/**
 * Validates one submitted category and returns the canonical value or a
 * human-readable policy error. Prohibited categories get a specific message so
 * operators learn the rule instead of guessing at a typo.
 */
export function validateAdCategory(raw: unknown): AdCategoryValidation {
  const value = normalizeAdCategory(raw);
  if (!value) {
    return {
      ok: false,
      error: "Ad category is required. See the ad policy for the accepted categories.",
    };
  }
  if (isProhibitedAdCategory(value)) {
    return {
      ok: false,
      error: `Prohibited ad category: ${PROHIBITED_LABELS[value]} (${
        value
      }). This inventory does not accept that advertising.`,
    };
  }
  if (!isAllowedAdCategory(value)) {
    return {
      ok: false,
      error:
        "Choose a valid ad category (see docs/AD-POLICY.md for the accepted list).",
    };
  }
  return { ok: true, value };
}
