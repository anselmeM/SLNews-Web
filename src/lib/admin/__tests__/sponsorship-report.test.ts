import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSponsorshipReport, reportToCsv } from "../sponsorship-report";
import { db } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  db: {
    sponsorship: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

const row = {
  id: "sp_1",
  placement: "feed",
  adCategory: "retail",
  advertiser: "Orange",
  headline: "SCAN",
  active: true,
  startsAt: new Date("2026-11-01T00:00:00Z"),
  endsAt: new Date("2026-11-30T00:00:00Z"),
  dailyMetrics: [
    { day: new Date("2026-11-01T00:00:00Z"), impressions: 100, taps: 2 },
    { day: new Date("2026-11-02T00:00:00Z"), impressions: 50, taps: 1 },
  ],
};

describe("sponsorship report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.sponsorship.findMany).mockResolvedValue([row] as never);
    vi.mocked(db.$queryRaw).mockResolvedValue([] as never);
  });

  it("totals daily metrics and derives reach/frequency", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([
      { sponsorshipId: "sp_1", reach: 60 },
    ] as never);
    const from = new Date("2026-11-01T00:00:00Z");
    const to = new Date("2026-11-02T00:00:00Z");

    const items = await loadSponsorshipReport(from, to);
    const item = items[0]!;
    expect(item.impressions).toBe(150);
    expect(item.taps).toBe(3);
    expect(item.ctr).toBeCloseTo(0.02, 4);
    expect(item.daily).toHaveLength(2);
    expect(item.adCategory).toBe("retail");
    expect(item.reach).toBe(60);
    expect(item.frequency).toBeCloseTo(2.5, 4);

    // The reach query must cover every day in the inclusive range.
    expect(db.$queryRaw).toHaveBeenCalled();
    const queryCall = vi.mocked(db.$queryRaw).mock.calls[0]!;
    const queryText = (queryCall[0] as TemplateStringsArray).join("?");
    expect(queryText).toContain('COUNT(DISTINCT "installIdHash")');
    const queryDates = (queryCall.slice(1) as unknown[])
      .filter((value): value is Date => value instanceof Date)
      .map((value) => value.toISOString());
    expect(queryDates).toContain("2026-11-01T00:00:00.000Z");
    expect(queryDates).toContain("2026-11-03T00:00:00.000Z");
  });

  it("reports null reach and frequency when nothing is identifiable", async () => {
    const items = await loadSponsorshipReport(
      new Date("2026-11-01T00:00:00Z"),
      new Date("2026-11-02T00:00:00Z")
    );
    expect(items[0]!.reach).toBeNull();
    expect(items[0]!.frequency).toBeNull();
  });

  it("exports CSV with category, reach and frequency columns", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([
      { sponsorshipId: "sp_1", reach: 60 },
    ] as never);
    const from = new Date("2026-11-01T00:00:00Z");
    const to = new Date("2026-11-02T00:00:00Z");

    const items = await loadSponsorshipReport(from, to);
    const csv = reportToCsv(items, from, to);
    expect(csv).toContain(
      "campaign_id,advertiser,placement,ad_category,headline,impressions,taps,ctr_percent,reach,frequency"
    );
    expect(csv).toContain("sp_1,Orange,feed,retail,SCAN,150,3,2.00,60,2.50");
    expect(csv).toContain("from,2026-11-01");
    expect(csv).toContain("to,2026-11-02");
  });

  it("leaves reach and frequency blank in CSV when unidentified", async () => {
    const from = new Date("2026-11-01T00:00:00Z");
    const to = new Date("2026-11-02T00:00:00Z");
    const items = await loadSponsorshipReport(from, to);
    const csv = reportToCsv(items, from, to);
    expect(csv).toContain("sp_1,Orange,feed,retail,SCAN,150,3,2.00,,");
  });
});
