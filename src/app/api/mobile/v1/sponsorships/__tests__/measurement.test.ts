import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as remove, PATCH as patch } from "../[id]/route";
import { POST as events } from "../events/route";
import { GET as report } from "../report/route";
import { db } from "@/lib/db";
import { reportError } from "@/lib/error-reporting";
import { checkDbRateLimit } from "@/lib/rate-limiter";
import {
  createEventToken,
  hashInstallId,
} from "@/lib/sponsorship-events";

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
  $queryRaw: vi.fn(),
  sponsorshipEvent: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  sponsorship: { findUnique: vi.fn(), update: vi.fn() },
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
    $queryRaw: vi.fn(),
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
    vi.mocked(db.$queryRaw).mockResolvedValue([] as never);
    vi.mocked(tx.sponsorshipEvent.findUnique).mockResolvedValue(null);
    vi.mocked(tx.sponsorshipEvent.create).mockResolvedValue({} as never);
    vi.mocked(tx.sponsorship.findUnique).mockResolvedValue(campaign as never);
    vi.mocked(tx.sponsorship.update).mockResolvedValue({} as never);
    vi.mocked(tx.$queryRaw).mockResolvedValue([] as never);
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
    // Legacy event without an install id: counted, but no identifiable reach.
    expect(tx.sponsorshipEvent.create).toHaveBeenCalledWith({
      data: {
        id: "ev_1234567890",
        sponsorshipId: "sp_1",
        type: "impression",
        installIdHash: null,
      },
    });
  });

  it("stores only the HMAC hash of the install id", async () => {
    const token = createEventToken("sp_1")!;
    const installId = "0123456789abcdef0123456789abcdef";
    const response = await events(
      post({
        id: "sp_1",
        type: "impression",
        eventId: "ev_install_hash_0001",
        token,
        installId,
      })
    );
    expect(await response.json()).toEqual({ ok: true, counted: true });
    const expected = hashInstallId(installId);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
    expect(tx.sponsorshipEvent.create).toHaveBeenCalledWith({
      data: {
        id: "ev_install_hash_0001",
        sponsorshipId: "sp_1",
        type: "impression",
        installIdHash: expected,
      },
    });
    // The raw install id must never reach storage.
    const stored = JSON.stringify(
      vi.mocked(tx.sponsorshipEvent.create).mock.calls
    );
    expect(stored).not.toContain(installId);
  });

  it("accepts a legacy token-less event that carries an install id", async () => {
    const installId = "fedcba9876543210fedcba9876543210";
    const response = await events(
      post({ id: "sp_1", type: "tap", installId })
    );
    expect(await response.json()).toEqual({ ok: true, counted: true });
    expect(tx.sponsorshipEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          installIdHash: hashInstallId(installId),
        }),
      })
    );
  });

  it("accepts install ids across the documented 16-128 character range", async () => {
    const token = createEventToken("sp_1")!;
    for (const [index, installId] of [
      "a".repeat(16),
      "b".repeat(64),
      "c".repeat(128),
      "Ab_C-1234567890aB_c-1234567890",
    ].entries()) {
      const response = await events(
        post({
          id: "sp_1",
          type: "impression",
          eventId: `ev_install_range_${index}`,
          token,
          installId,
        })
      );
      expect(await response.json()).toEqual({ ok: true, counted: true });
    }
  });

  it("rejects a malformed install id", async () => {
    const token = createEventToken("sp_1")!;
    for (const installId of [
      "short",
      "has spaces in the value",
      "z".repeat(129),
      "0123456789abcdef0123456789abcde!", // not URL-safe
    ]) {
      const response = await events(
        post({
          id: "sp_1",
          type: "impression",
          eventId: "ev_bad_install",
          token,
          installId,
        })
      );
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/installId/i);
    }
    expect(tx.sponsorship.update).not.toHaveBeenCalled();
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

  it("does not exceed the lifetime impression cap under the lock", async () => {
    vi.mocked(tx.sponsorship.findUnique).mockResolvedValue({
      ...campaign,
      impressions: 10,
      maxImpressions: 10,
    } as never);
    const token = createEventToken("sp_1")!;
    const response = await events(
      post({
        id: "sp_1",
        type: "impression",
        eventId: "ev_cap_lifetime",
        token,
      })
    );
    expect(await response.json()).toEqual({ ok: true, counted: false });
    expect(tx.sponsorship.update).not.toHaveBeenCalled();
    expect(tx.sponsorshipDailyMetric.upsert).not.toHaveBeenCalled();
  });

  it("does not exceed the daily impression cap under the lock", async () => {
    vi.mocked(tx.sponsorship.findUnique).mockResolvedValue({
      ...campaign,
      dailyImpressionCap: 5,
    } as never);
    vi.mocked(tx.sponsorshipDailyMetric.findUnique).mockResolvedValue({
      impressions: 5,
    } as never);
    const token = createEventToken("sp_1")!;
    const response = await events(
      post({
        id: "sp_1",
        type: "impression",
        eventId: "ev_cap_daily",
        token,
      })
    );
    expect(await response.json()).toEqual({ ok: true, counted: false });
    expect(tx.sponsorship.update).not.toHaveBeenCalled();
    expect(tx.sponsorshipDailyMetric.upsert).not.toHaveBeenCalled();
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
        placement: "news_stream",
        adCategory: "telecom",
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
    vi.mocked(db.$queryRaw).mockResolvedValue([
      { sponsorshipId: "sp_1", reach: 3 },
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
    expect(body.items[0].placement).toBe("news_stream");
    expect(body.items[0].adCategory).toBe("telecom");
    expect(body.items[0].reach).toBe(3);
    expect(body.items[0].frequency).toBeCloseTo(50, 4);
  });

  it("reports null reach and frequency when no install is identifiable", async () => {
    vi.mocked(db.sponsorship.findMany).mockResolvedValue([
      {
        id: "sp_1",
        placement: "feed",
        adCategory: null,
        advertiser: "Orange",
        headline: "SCAN",
        active: true,
        startsAt: campaign.startsAt,
        endsAt: campaign.endsAt,
        dailyMetrics: [
          { day: new Date("2026-11-01T00:00:00Z"), impressions: 25, taps: 0 },
        ],
      },
    ] as never);
    const response = await report(
      adminRequest(
        "GET",
        "secret",
        "http://localhost/api/mobile/v1/sponsorships/report?from=2026-11-01&to=2026-11-01"
      )
    );
    const body = await response.json();
    expect(body.items[0].reach).toBeNull();
    expect(body.items[0].frequency).toBeNull();
  });

  it("reports a storage failure while keeping the reader response safe", async () => {
    vi.mocked(tx.sponsorshipEvent.create).mockRejectedValue(
      new Error("database unavailable")
    );
    const token = createEventToken("sp_1")!;
    const response = await events(
      post({
        id: "sp_1",
        type: "impression",
        eventId: "ev_storage_failure",
        token,
      })
    );
    expect(await response.json()).toEqual({ ok: true, counted: false });
    expect(vi.mocked(reportError)).toHaveBeenCalled();
  });

  it("closes token-less legacy events after the fallback cutoff", async () => {
    vi.stubEnv("SPONSORSHIP_ALLOW_LEGACY_EVENTS", "");
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2027-02-01T00:00:00.000Z"));
      const response = await events(post({ id: "sp_1", type: "impression" }));
      expect(response.status).toBe(401);
    } finally {
      vi.useRealTimers();
    }
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
