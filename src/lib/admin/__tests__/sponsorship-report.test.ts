import { describe, expect, it, vi } from "vitest";
import { loadSponsorshipReport, reportToCsv } from "../sponsorship-report";
import { db } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  db: { sponsorship: { findMany: vi.fn() } },
}));

describe("sponsorship report", () => {
  it("totals daily metrics and exports CSV", async () => {
    vi.mocked(db.sponsorship.findMany).mockResolvedValue([
      {
        id: "sp_1",
        placement: "feed",
        advertiser: "Orange",
        headline: "SCAN",
        active: true,
        startsAt: new Date("2026-11-01T00:00:00Z"),
        endsAt: new Date("2026-11-30T00:00:00Z"),
        dailyMetrics: [
          { day: new Date("2026-11-01T00:00:00Z"), impressions: 100, taps: 2 },
          { day: new Date("2026-11-02T00:00:00Z"), impressions: 50, taps: 1 },
        ],
      },
    ] as never);
    const from = new Date("2026-11-01T00:00:00Z");
    const to = new Date("2026-11-02T00:00:00Z");

    const items = await loadSponsorshipReport(from, to);
    const item = items[0]!;
    expect(item.impressions).toBe(150);
    expect(item.taps).toBe(3);
    expect(item.ctr).toBeCloseTo(0.02, 4);
    expect(item.daily).toHaveLength(2);

    const csv = reportToCsv(items, from, to);
    expect(csv).toContain("campaign_id,advertiser,placement");
    expect(csv).toContain("sp_1,Orange,feed,SCAN,150,3,2.00");
    expect(csv).toContain("from,2026-11-01");
    expect(csv).toContain("to,2026-11-02");
  });
});
