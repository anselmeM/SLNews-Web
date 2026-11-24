import { describe, expect, it } from "vitest";
import { PROHIBITED_AD_CATEGORIES } from "./sponsorship-policy";
import {
  SPONSORSHIP_PLACEMENTS,
  SPONSORSHIP_SLOT_CAPACITY,
  isPlacement,
  parseSponsorshipInput,
} from "./sponsorship-validation";

const valid = {
  placement: "news_stream",
  adCategory: "telecom",
  advertiser: "Orange SL",
  headline: "SCAN AND SAVE",
  body: "Every top-up this month",
  ctaLabel: "View more",
  ctaUrl: "https://example.com/offer",
};

describe("sponsorship placements and slots", () => {
  it("keeps feed for For You and adds news_stream without removing legacy slots", () => {
    expect(SPONSORSHIP_PLACEMENTS).toEqual([
      "feed",
      "news_stream",
      "sports_stream",
      "article_end",
    ]);
    expect(isPlacement("feed")).toBe(true);
    expect(isPlacement("news_stream")).toBe(true);
    expect(isPlacement("sports_stream")).toBe(true);
    expect(isPlacement("article_end")).toBe(true);
    expect(isPlacement("sidebar")).toBe(false);
  });

  it("declares the server-selected slot capacity", () => {
    expect(SPONSORSHIP_SLOT_CAPACITY).toEqual({
      feed: 2,
      news_stream: 1,
      sports_stream: 1,
      article_end: 1,
    });
  });

  it("accepts a news_stream campaign with an allowed category", () => {
    const parsed = parseSponsorshipInput(valid);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.placement).toBe("news_stream");
      expect(parsed.value.adCategory).toBe("telecom");
    }
  });

  it("accepts the legacy feed placement", () => {
    const parsed = parseSponsorshipInput({ ...valid, placement: "feed" });
    expect(parsed.ok).toBe(true);
  });

  it("requires an ad category for every new campaign", () => {
    const withoutCategory: Record<string, unknown> = { ...valid };
    delete withoutCategory.adCategory;
    const parsed = parseSponsorshipInput(withoutCategory);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors.join(" ")).toMatch(/ad category is required/i);
    }
  });

  it("rejects prohibited categories with a clear policy error", () => {
    for (const adCategory of PROHIBITED_AD_CATEGORIES) {
      const parsed = parseSponsorshipInput({ ...valid, adCategory });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        const message = parsed.errors.join(" ");
        expect(message).toMatch(/prohibited ad category/i);
        expect(message).toContain(adCategory);
      }
    }
  });

  it("rejects an unknown category", () => {
    const parsed = parseSponsorshipInput({ ...valid, adCategory: "sidebar" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors.join(" ")).toMatch(/valid ad category/i);
    }
  });

  it("still validates the rest of the payload", () => {
    const parsed = parseSponsorshipInput({
      ...valid,
      ctaUrl: "/relative",
      headline: "x".repeat(41),
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.length).toBeGreaterThanOrEqual(2);
  });
});
