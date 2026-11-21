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
};

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

  it("creates a unit with the admin key", async () => {
    vi.stubEnv("SPONSORSHIP_ADMIN_KEY", "secret");
    const response = await POST(postRequest({ ...row }, "secret"));
    expect(response.status).toBe(201);
    expect(db.sponsorship.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ placement: "feed" }),
      })
    );
    vi.unstubAllEnvs();
  });
});
