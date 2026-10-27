import { describe, expect, it } from "vitest";
import { parseCampaignForm } from "./sponsorship-form";

function form(overrides: Record<string, string> = {}): FormData {
  const data = new FormData();
  const values: Record<string, string> = {
    placement: "feed",
    advertiser: "Orange SL",
    headline: "SCAN AND SAVE",
    body: "Every top-up this month",
    ctaLabel: "View more",
    ctaUrl: "https://example.com/offer",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("parseCampaignForm", () => {
  it("accepts a valid campaign", () => {
    const parsed = parseCampaignForm(form());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.placement).toBe("feed");
      expect(parsed.value.brandHex).toBe("#0B6FD1");
    }
  });

  it("rejects bad placements, long copy and relative URLs", () => {
    const bad = parseCampaignForm(
      form({
        placement: "sidebar",
        headline: "x".repeat(41),
        ctaUrl: "/relative",
      })
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects an end before the start", () => {
    const data = form();
    data.set("startsAt", "2026-11-02T00:00");
    data.set("endsAt", "2026-11-01T00:00");
    expect(parseCampaignForm(data).ok).toBe(false);
  });

  it("normalizes a scheme-less or http image URL to https", () => {
    const schemeless = form();
    schemeless.set("imageUrl", "cdn.example.com/creative.jpg");
    const first = parseCampaignForm(schemeless);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.imageUrl).toBe("https://cdn.example.com/creative.jpg");
    }

    const http = form();
    http.set("imageUrl", "http://cdn.example.com/creative.jpg");
    const second = parseCampaignForm(http);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.imageUrl).toBe(
        "https://cdn.example.com/creative.jpg"
      );
    }
  });

  it("treats a blank image URL as optional", () => {
    const data = new FormData();
    data.set("placement", "feed");
    data.set("advertiser", "Orange SL");
    data.set("headline", "SCAN AND SAVE");
    data.set("body", "Every top-up this month");
    data.set("ctaLabel", "View more");
    data.set("ctaUrl", "https://example.com/offer");
    data.set("imageUrl", "");
    const result = parseCampaignForm(data);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.imageUrl).toBeUndefined();
  });
});
