import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { toAdUnit, type SponsorshipRow } from "@/lib/sponsorship-ad-unit";

type Json = Record<string, unknown>;

function readJson(relative: string): Json {
  return JSON.parse(
    readFileSync(path.join(process.cwd(), relative), "utf8")
  ) as Json;
}

const spec = readJson("contracts/openapi.json");
const adFixture = readJson("contracts/fixtures/ad-unit.json");
const eventFixture = readJson("contracts/fixtures/event-request.json");

function schema(name: string): Json {
  const components = spec.components as Json;
  const schemas = components.schemas as Json;
  return schemas[name] as Json;
}

describe("mobile sponsorship contract", () => {
  it("declares the sponsorship endpoints and version", () => {
    expect(spec.openapi).toMatch(/^3\./);
    const paths = spec.paths as Record<string, unknown>;
    expect(Object.keys(paths)).toEqual(
      expect.arrayContaining([
        "/api/mobile/v1/sponsorships",
        "/api/mobile/v1/sponsorships/events",
        "/api/mobile/v1/sponsorships/report",
      ])
    );
  });

  it("keeps the AdUnit fixture aligned with the contract schema", () => {
    const properties = schema("AdUnit").properties as Json;
    expect(Object.keys(adFixture).sort()).toEqual(
      Object.keys(properties).sort()
    );
    expect(schema("Placement").enum).toContain(adFixture.placement);
  });

  it("maps a database row to the canonical AdUnit shape", () => {
    const row: SponsorshipRow = {
      id: adFixture.id as string,
      placement: adFixture.placement as string,
      advertiser: adFixture.advertiser as string,
      headline: adFixture.headline as string,
      body: adFixture.body as string,
      ctaLabel: adFixture.ctaLabel as string,
      ctaUrl: adFixture.targetUrl as string,
      brandHex: adFixture.brandHex as string,
      brandAccentHex: adFixture.brandAccentHex as string,
      assetLabel: adFixture.assetLabel as string | null,
      disclosure: adFixture.disclosure as string | null,
      imageUrl: adFixture.imageUrl as string | null,
      altText: adFixture.altText as string | null,
      priority: 0,
      weight: 1,
      maxImpressions: null,
      dailyImpressionCap: null,
      impressions: 0,
    };

    const mapped = toAdUnit(row, adFixture.eventToken as string);

    expect(Object.keys(mapped).sort()).toEqual(Object.keys(adFixture).sort());
    expect(mapped).toMatchObject({
      ...adFixture,
      eventTokenExpiresAt: expect.any(String),
    });
  });

  it("keeps the event fixture aligned with EventRequest", () => {
    const properties = schema("EventRequest").properties as Json;
    expect(Object.keys(eventFixture).sort()).toEqual(
      Object.keys(properties).sort()
    );
    expect(eventFixture.type).toBe("impression");
  });
});
