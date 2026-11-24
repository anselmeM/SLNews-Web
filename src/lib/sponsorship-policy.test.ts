import { describe, expect, it } from "vitest";
import {
  AD_CATEGORIES,
  AD_CATEGORY_LABELS,
  AD_CATEGORY_OPTIONS,
  PROHIBITED_AD_CATEGORIES,
  isAllowedAdCategory,
  isProhibitedAdCategory,
  normalizeAdCategory,
  validateAdCategory,
} from "./sponsorship-policy";

describe("sponsorship ad policy", () => {
  it("allows the normal local advertiser categories", () => {
    for (const category of [
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
    ]) {
      expect(isAllowedAdCategory(category)).toBe(true);
    }
    expect(AD_CATEGORIES).toHaveLength(14);
  });

  it("prohibits every restricted category explicitly", () => {
    for (const category of [
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
    ]) {
      expect(PROHIBITED_AD_CATEGORIES).toContain(category);
      expect(isProhibitedAdCategory(category)).toBe(true);
      expect(isAllowedAdCategory(category)).toBe(false);
    }
  });

  it("never lists the same category as allowed and prohibited", () => {
    for (const category of PROHIBITED_AD_CATEGORIES) {
      expect(AD_CATEGORIES as readonly string[]).not.toContain(category);
    }
  });

  it("normalizes casing, spaces and hyphens", () => {
    expect(normalizeAdCategory("  Health Services ")).toBe("health_services");
    expect(normalizeAdCategory("health-services")).toBe("health_services");
    expect(normalizeAdCategory("TELECOM")).toBe("telecom");
    expect(normalizeAdCategory(undefined)).toBe("");
  });

  it("returns the canonical category for an allowed value", () => {
    expect(validateAdCategory(" Telecom ")).toEqual({
      ok: true,
      value: "telecom",
    });
  });

  it("explains a prohibited category instead of a generic invalid value", () => {
    const result = validateAdCategory("gambling");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/prohibited/i);
      expect(result.error).toMatch(/gambling/i);
    }
  });

  it("requires a category and rejects unknown values", () => {
    const missing = validateAdCategory("");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toMatch(/required/i);

    const unknown = validateAdCategory("sidebar");
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error).toMatch(/valid ad category/i);
  });

  it("gives every allowed category a form label and option", () => {
    expect(AD_CATEGORY_OPTIONS).toHaveLength(AD_CATEGORIES.length);
    for (const category of AD_CATEGORIES) {
      expect(AD_CATEGORY_LABELS[category]).toBeTruthy();
      expect(AD_CATEGORY_OPTIONS.map((option) => option.value)).toContain(
        category
      );
    }
  });
});
