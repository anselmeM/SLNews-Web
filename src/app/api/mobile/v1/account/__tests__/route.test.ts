import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE } from "../route";
import { deleteClerkUser } from "@/lib/clerk-backend";
import { db } from "@/lib/db";
import { resolveMobileUser } from "@/lib/mobile-sync/resolve-mobile-user";
import { checkDbRateLimit, getClientIp } from "@/lib/rate-limiter";

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(),
    user: { deleteMany: vi.fn() },
    mobileBookmark: { deleteMany: vi.fn() },
    mobileReaction: { deleteMany: vi.fn() },
    mobileFollow: { deleteMany: vi.fn() },
    mobileDevice: { deleteMany: vi.fn() },
  },
}));

vi.mock("@/lib/mobile-sync/resolve-mobile-user", () => ({
  resolveMobileUser: vi.fn(),
}));

vi.mock("@/lib/clerk-backend", () => ({
  deleteClerkUser: vi.fn(),
}));

vi.mock("@/lib/rate-limiter", () => ({
  checkDbRateLimit: vi.fn(),
  getClientIp: vi.fn(() => "203.0.113.7"),
}));

vi.mock("@/lib/error-reporting", () => ({ reportError: vi.fn() }));

const USER_ID = "user_1";

function request(): Request {
  return new Request("http://localhost/api/mobile/v1/account", {
    method: "DELETE",
    headers: { authorization: "Bearer session.jwt" },
  });
}

function signedIn(): void {
  vi.mocked(resolveMobileUser).mockResolvedValue({
    id: USER_ID,
    email: "reader@example.com",
    name: "Reader",
    image: null,
    role: "USER",
  } as never);
  vi.mocked(checkDbRateLimit).mockResolvedValue({
    allowed: true,
    remaining: 4,
    retryAfter: 0,
  } as never);
}

describe("/api/mobile/v1/account DELETE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signedIn();
    vi.mocked(db.$transaction).mockResolvedValue([] as never);
    vi.mocked(deleteClerkUser).mockResolvedValue("deleted");
  });

  it("rejects an unauthenticated request", async () => {
    vi.mocked(resolveMobileUser).mockResolvedValue(null);

    const response = await DELETE(request());

    expect(response.status).toBe(401);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(deleteClerkUser).not.toHaveBeenCalled();
  });

  it("answers 429 above the rate limit", async () => {
    vi.mocked(checkDbRateLimit).mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfter: 30,
    } as never);

    const response = await DELETE(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("deletes the app rows and the account, then the Clerk identity", async () => {
    const response = await DELETE(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, deleted: true });
    expect(db.mobileBookmark.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
    });
    expect(db.mobileReaction.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
    });
    expect(db.mobileFollow.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
    });
    expect(db.mobileDevice.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
    });
    expect(db.user.deleteMany).toHaveBeenCalledWith({ where: { id: USER_ID } });
    expect(deleteClerkUser).toHaveBeenCalledWith(USER_ID);
  });

  it("hashes the request-derived rate-limit bucket key", async () => {
    await DELETE(request());
    await DELETE(request());

    const [first, second] = vi
      .mocked(checkDbRateLimit)
      .mock.calls.map(([key]) => key);

    // The bucket key goes to the database layer: it must be an opaque digest,
    // never the raw user id or client-controlled header value.
    expect(first).toMatch(/^mobile-account-delete:[0-9a-f]{64}$/);
    expect(first).not.toContain(USER_ID);
    expect(first).not.toContain("203.0.113.7");

    // Same reader and IP stay in one bucket.
    expect(second).toBe(first);
  });

  it("gives a different bucket per reader and per client IP", async () => {
    await DELETE(request());
    const base = vi.mocked(checkDbRateLimit).mock.calls[0]?.[0];

    vi.mocked(getClientIp).mockReturnValueOnce("198.51.100.9");
    await DELETE(request());
    const otherIp = vi.mocked(checkDbRateLimit).mock.calls[1]?.[0];

    vi.mocked(resolveMobileUser).mockResolvedValueOnce({
      id: "user_2",
      email: null,
      name: null,
      image: null,
      role: "USER",
    } as never);
    await DELETE(request());
    const otherReader = vi.mocked(checkDbRateLimit).mock.calls[2]?.[0];

    expect(otherIp).not.toBe(base);
    expect(otherReader).not.toBe(base);
  });

  it("does not touch Clerk when the row delete fails", async () => {
    vi.mocked(db.$transaction).mockRejectedValue(new Error("db down"));

    const response = await DELETE(request());

    expect(response.status).toBe(500);
    expect(deleteClerkUser).not.toHaveBeenCalled();
  });

  it("reports 503 when the server has no Clerk secret", async () => {
    vi.mocked(deleteClerkUser).mockResolvedValue("unconfigured");

    const response = await DELETE(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("privacy@slnews.sl"),
    });
  });

  it("reports 502 when Clerk refuses, leaving a retryable account", async () => {
    vi.mocked(deleteClerkUser).mockResolvedValue("failed");

    const response = await DELETE(request());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("could not be removed"),
    });
  });
});
