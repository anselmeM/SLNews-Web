import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as remove, PATCH as patch } from "../[id]/route";
import { POST as events } from "../events/route";
import { GET as report } from "../report/route";
import { db } from "@/lib/db";
import { checkDbRateLimit } from "@/lib/rate-limiter";
import { createEventToken } from "@/lib/sponsorship-events";

const campaign = {
  id: "sp_1",
  active: true,
  archivedAt: null,
  startsAt: new Date(Date.now() - 60_000),
  endsAt: new Date(Date.now() + 60_000),
  maxImpressions: null,
  impressions: 10,
  dailyImpressionCap: null,
};

const tx = {
  sponsorshipEvent: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  sponsorship: { update: vi.fn() },
  sponsorshipDailyMetric: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({
  db: {
    sponsorship: {
      update: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    sponsorshipEvent: { create: vi.fn() },
    adminAuditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/error-reporting", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/rate-limiter", () => ({
  checkDbRateLimit: vi.fn(),
  getClientIp: vi.fn(() => "203.0.113.1"),
}));
vi.mock("@/lib/sponsorship-cache", () => ({
  SPONSORSHIPS_TAG: "sponsorships",
  revalidateSponsorships: vi.fn(),
}));

function post(body: unknown): Request {
  return new Request("http://localhost/api/mobile/v1/sponsorships/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function adminRequest(
  method: string,
  key?: string,
  url = "http://localhost/x"
): Request {
  return new Request(url, {
    method,
    headers: key ? { "x-admin-key": key } : {},
  });
}

describe("sponsorship measurement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SPONSORSHIP_ADMIN_KEY", "secret");
    vi.stubEnv("SPONSORSHIP_EVENT_SECRET", "event-secret");
    vi.stubEnv("SPONSORSHIP_ALLOW_LEGACY_EVENTS", "true");
    vi.mocked(checkDbRateLimit).mockResolvedValue({
      allowed: true,
      remaining: 1,
      retryAfter: 0,
    } as never);
    vi.mocked(db.sponsorship.findUnique).mockResolvedValue(campaign as never);
    vi.mocked(db.sponsorship.update).mockResolvedValue({ id: "sp_1" } as never);
    vi.mocked(db.sponsorship.findMany).mockResolvedValue([] as never);
    vi.mocked(tx.sponsorshipEvent.findUnique).mockResolvedValue(null);
    vi.mocked(tx.sponsorshipEvent.create).mockResolvedValue({} as never);
    vi.mocked(tx.sponsorship.update).mockResolvedValue({} as never);
    vi.mocked(tx.sponsorshipDailyMetric.findUnique).mockResolvedValue(null);
    vi.mocked(tx.sponsorshipDailyMetric.upsert).mockResolvedValue({} as never);
    vi.mocked(db.$transaction).mockImplementation((async (
      callback: (client: typeof tx) => Promise<unknown>
    ) => callback(tx)) as never);
  });

  it("counts an impression with a valid token", async () => {
    const token = createEventToken("sp_1")!;
    const response = await events(
      post({
        id: "sp_1",
        type: "impression",
        eventId: "ev_1234567890",
        token,
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, counted: true });
    expect(tx.sponsorship.update).toHaveBeenCalledWith({
      where: { id: "sp_1" },
      data: { impressions: { increment: 1 } },
    });
    expect(tx.sponsorshipDailyMetric.upsert).toHaveBeenCalled();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects missing or forged tokens when legacy events are disabled", async () => {
    vi.stubEnv("SPONSORSHIP_ALLOW_LEGACY_EVENTS", "false");
    expect(
      (await events(post({ id: "sp_1", type: "impression" }))).status
    ).toBe(401);
    const forged = await events(
      post({
        id: "sp_1",
        type: "impression",
        eventId: "ev_1234567890",
        token: "forged.token",
      })
    );
    expect(forged.status).toBe(401);
    expect(tx.sponsorship.update).not.toHaveBeenCalled();
  });

  it("accepts a legacy event without a token while migrating", async () => {
    const response = await events(post({ id: "sp_1", type: "impression" }));
    expect(await response.json()).toEqual({ ok: true, counted: true });
  });

  it("rejects an expired token", async () => {
    const token = createEventToken("sp_1", Date.now() - 70 * 60_000)!;
    const response = await events(
      post({
        id: "sp_1",
        type: "impression",
        eventId: "ev_1234567890",
        token,
      })
    );
    expect(response.status).toBe(401);
  });

  it("deduplicates a replay by event id", async () => {
    vi.mocked(tx.sponsorshipEvent.findUnique).mockResolvedValue({
      id: "ev_1234567890",
    } as never);
    const token = createEventToken("sp_1")!;
    const response = await events(
      post({
        id: "sp_1",
        type: "tap",
        eventId: "ev_1234567890",
        token,
      })
    );
    expect(await response.json()).toEqual({ ok: true, counted: false });
    expect(tx.sponsorship.update).not.toHaveBeenCalled();
  });

  it("does not count events for stopped campaigns", async () => {
    vi.mocked(db.sponsorship.findUnique).mockResolvedValue({
      ...campaign,
      active: false,
    } as never);
    const token = createEventToken("sp_1")!;
    const response = await events(
      post({
        id: "sp_1",
        type: "impression",
        eventId: "ev_1234567890",
        token,
      })
    );
    expect(await response.json()).toEqual({ ok: true, counted: false });
    expect(tx.sponsorship.update).not.toHaveBeenCalled();
  });

  it("protects the report and uses daily metrics for a date range", async () => {
    vi.mocked(db.sponsorship.findMany).mockResolvedValue([
      {
        id: "sp_1",
        placement: "feed",
        advertiser: "Orange",
        headline: "SCAN",
        active: true,
        startsAt: campaign.startsAt,
        endsAt: campaign.endsAt,
        dailyMetrics: [
          { day: new Date("2026-11-01T00:00:00Z"), impressions: 100, taps: 2 },
          { day: new Date("2026-11-02T00:00:00Z"), impressions: 50, taps: 1 },
        ],
      },
    ] as never);
    expect((await report(adminRequest("GET", "wrong"))).status).toBe(401);
    const response = await report(
      adminRequest(
        "GET",
        "secret",
        "http://localhost/api/mobile/v1/sponsorships/report?from=2026-11-01&to=2026-11-02"
      )
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items[0].impressions).toBe(150);
    expect(body.items[0].taps).toBe(3);
    expect(body.items[0].ctr).toBeCloseTo(0.02, 4);
    expect(body.items[0].daily).toHaveLength(2);
  });

  it("archives a campaign through DELETE", async () => {
    const response = await remove(adminRequest("DELETE", "secret"), {
      params: Promise.resolve({ id: "sp_1" }),
    });
    expect(response.status).toBe(200);
    expect(db.sponsorship.update).toHaveBeenCalledWith({
      where: { id: "sp_1" },
      data: { active: false, archivedAt: expect.any(Date) },
    });
  });

  it("refuses lifecycle edits without the key", async () => {
    expect(
      (
        await patch(adminRequest("PATCH"), {
          params: Promise.resolve({ id: "sp_1" }),
        })
      ).status
    ).toBe(401);
  });
});
