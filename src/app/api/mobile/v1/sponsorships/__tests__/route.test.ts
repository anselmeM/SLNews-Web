import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../route";
import { db } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  db: { sponsorship: { findMany: vi.fn(), create: vi.fn() } },
}));
vi.mock("@/lib/error-reporting", () => ({ reportError: vi.fn() }));

const row = {
  id: "sp_1",
  placement: "feed",
  adCategory: "telecom",
  advertiser: "Orange SL",
  headline: "SCAN AND SAVE",
  body: "Every top-up this month",
  ctaLabel: "View more",
  ctaUrl: "https://example.com/offer",
  brandHex: "#0B6FD1",
  brandAccentHex: "#2E9BF5",
  assetLabel: "$5",
  disclosure: "Terms apply",
  imageUrl: null,
  priority: 0,
  weight: 1,
};

function feedRows(count: number, placement = "feed") {
  return Array.from({ length: count }, (_, index) => ({
    ...row,
    id: `sp_${placement}_${index}`,
    placement,
  }));
}

function getRequest(placement?: string): Request {
  const suffix = placement ? `?placement=${placement}` : "";
  return new Request(`http://localhost/api/mobile/v1/sponsorships${suffix}`);
}

function postRequest(body: unknown, key?: string): Request {
  return new Request("http://localhost/api/mobile/v1/sponsorships", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? { "x-admin-key": key } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("/api/mobile/v1/sponsorships", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.sponsorship.findMany).mockResolvedValue([row] as never);
    vi.mocked(db.sponsorship.create).mockResolvedValue(row as never);
  });

  it("returns active units in the app's AdUnit shape", async () => {
    const response = await GET(getRequest("feed"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: "sp_1",
      headline: "SCAN AND SAVE",
      targetUrl: "https://example.com/offer",
      advertiser: "Orange SL",
    });
    expect(db.sponsorship.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ placement: "feed", active: true }),
        take: 50,
      })
    );
  });

  it("returns at most two server-selected units for feed", async () => {
    vi.mocked(db.sponsorship.findMany).mockResolvedValue(
      feedRows(6) as never
    );
    const response = await GET(getRequest("feed"));
    const body = await response.json();
    expect(body.items).toHaveLength(2);
  });

  it.each(["news_stream", "sports_stream", "article_end"])(
    "returns at most one unit for %s",
    async (placement) => {
      vi.mocked(db.sponsorship.findMany).mockResolvedValue(
        feedRows(4, placement) as never
      );
      const response = await GET(getRequest(placement));
      const body = await response.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].placement).toBe(placement);
    }
  );

  it("caps an unscoped read at the largest single-placement capacity", async () => {
    vi.mocked(db.sponsorship.findMany).mockResolvedValue(
      feedRows(6) as never
    );
    const response = await GET(getRequest());
    const body = await response.json();
    expect(body.items).toHaveLength(2);
  });

  it("rejects an unknown placement", async () => {
    const response = await GET(getRequest("sidebar"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      items: [],
      error: "Unknown placement.",
    });
  });

  it("degrades to an empty list when the read fails", async () => {
    vi.mocked(db.sponsorship.findMany).mockRejectedValue(new Error("db down"));
    const response = await GET(getRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [] });
  });

  it("refuses writes without the admin key", async () => {
    vi.stubEnv("SPONSORSHIP_ADMIN_KEY", "secret");
    const response = await POST(postRequest({ ...row }, "wrong"));
    expect(response.status).toBe(401);
    vi.unstubAllEnvs();
    expect(db.sponsorship.create).not.toHaveBeenCalled();
  });

  it("rejects malformed payloads", async () => {
    vi.stubEnv("SPONSORSHIP_ADMIN_KEY", "secret");
    const response = await POST(postRequest({ placement: "feed" }, "secret"));
    expect(response.status).toBe(400);
    vi.unstubAllEnvs();
  });

  it("creates a feed unit with the admin key", async () => {
    vi.stubEnv("SPONSORSHIP_ADMIN_KEY", "secret");
    const response = await POST(postRequest({ ...row }, "secret"));
    expect(response.status).toBe(201);
    expect(db.sponsorship.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          placement: "feed",
          adCategory: "telecom",
        }),
      })
    );
    vi.unstubAllEnvs();
  });

  it("creates a news_stream campaign with an allowed category", async () => {
    vi.stubEnv("SPONSORSHIP_ADMIN_KEY", "secret");
    vi.mocked(db.sponsorship.create).mockResolvedValue({
      ...row,
      placement: "news_stream",
    } as never);
    const response = await POST(
      postRequest(
        { ...row, placement: "news_stream", adCategory: "retail" },
        "secret"
      )
    );
    expect(response.status).toBe(201);
    expect(db.sponsorship.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          placement: "news_stream",
          adCategory: "retail",
        }),
      })
    );
    vi.unstubAllEnvs();
  });

  it("rejects a prohibited ad category on create", async () => {
    vi.stubEnv("SPONSORSHIP_ADMIN_KEY", "secret");
    const response = await POST(
      postRequest({ ...row, adCategory: "gambling" }, "secret")
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/prohibited ad category/i);
    vi.unstubAllEnvs();
    expect(db.sponsorship.create).not.toHaveBeenCalled();
  });

  it("requires an ad category on create", async () => {
    vi.stubEnv("SPONSORSHIP_ADMIN_KEY", "secret");
    const response = await POST(
      postRequest({ ...row, adCategory: "" }, "secret")
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/ad category is required/i);
    vi.unstubAllEnvs();
  });
});
