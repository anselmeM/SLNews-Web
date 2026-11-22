/**
 * Route tests for `/api/mobile/v1/sync`.
 *
 * Prisma is mocked at the module boundary; the resolver module is stubbed (its
 * own behaviour is a separate concern) while the merge engine is the real one, so
 * these tests exercise the contract end to end — status codes, tombstones,
 * `state`, `Retry-After` — rather than a stub of it. The engine's SQL runs
 * against the mocked `$executeRaw`, and its merge semantics against a real table
 * live in `src/lib/mobile-sync/__tests__/engine.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "../route";
import { db } from "@/lib/db";
import { reportError } from "@/lib/error-reporting";
import { resolveMobileUser } from "@/lib/mobile-sync/resolve-mobile-user";
import { checkDbRateLimit, getClientIp } from "@/lib/rate-limiter";

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    mobileBookmark: { findMany: vi.fn() },
    mobileReaction: { findMany: vi.fn() },
    mobileFollow: { findMany: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/rate-limiter", () => ({
  checkDbRateLimit: vi.fn(),
  getClientIp: vi.fn(() => "203.0.113.7"),
}));

vi.mock("@/lib/error-reporting", () => ({ reportError: vi.fn() }));

vi.mock("@/lib/mobile-sync/resolve-mobile-user", () => ({
  resolveMobileUser: vi.fn(),
}));

/** Shaped like a `Prisma.Sql`: `.text` plus the positional `.values`. */
interface SqlCall {
  text: string;
  values: unknown[];
}

type AsyncMock = ReturnType<typeof vi.fn>;

const findBookmarks = db.mobileBookmark.findMany as unknown as AsyncMock;
const findReactions = db.mobileReaction.findMany as unknown as AsyncMock;
const findFollows = db.mobileFollow.findMany as unknown as AsyncMock;
const executeRaw = db.$executeRaw as unknown as AsyncMock;
const transaction = db.$transaction as unknown as AsyncMock;

const resolveUser = vi.mocked(resolveMobileUser);
const rateLimit = vi.mocked(checkDbRateLimit);
const clientIp = vi.mocked(getClientIp);
const report = vi.mocked(reportError);

const USER_ID = "user_probe";
const ITEM = "slnews-api:4821";
const T0 = "2026-10-16T04:51:02.114Z";
const T1 = "2026-10-16T05:00:00.000Z";

function bookmarkRow(overrides: Record<string, unknown> = {}) {
  return {
    itemId: ITEM,
    title: "Leone Stars level with Guinea",
    sourceUrl: "https://example.test/a",
    imageUrl: null,
    publisher: "Example",
    publishedAt: new Date(T0),
    savedAt: new Date(T0),
    updatedAt: new Date(T0),
    deletedAt: null,
    ...overrides,
  };
}

function sqlCalls(): SqlCall[] {
  return executeRaw.mock.calls.map((call) => call[0] as unknown as SqlCall);
}

function request(
  method: "GET" | "POST",
  {
    headers = {},
    body,
    query = "",
  }: { headers?: Record<string, string>; body?: unknown; query?: string } = {}
): Request {
  return new Request(`http://localhost/api/mobile/v1/sync${query}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body:
      body === undefined
        ? undefined
        : typeof body === "string"
          ? body
          : JSON.stringify(body),
  });
}

const BEARER = { authorization: "Bearer probe.jwt.token" };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CLERK_SECRET_KEY = "sk_test_secret";
  delete process.env.CLERK_AUTHORIZED_PARTIES;

  clientIp.mockReturnValue("203.0.113.7");
  rateLimit.mockResolvedValue({ allowed: true, remaining: 59, retryAfter: 0 });
  resolveUser.mockResolvedValue({
    id: USER_ID,
    email: "probe@example.test",
    name: "Probe Reader",
    image: null,
    role: "USER",
  });
  transaction.mockImplementation(async (fn: unknown) =>
    (fn as (client: unknown) => Promise<unknown>)(db)
  );
  executeRaw.mockResolvedValue(1);
  findBookmarks.mockResolvedValue([]);
  findReactions.mockResolvedValue([]);
  findFollows.mockResolvedValue([]);
});

describe("POST /api/mobile/v1/sync — authentication", () => {
  it("answers 401 when the request carries no credentials at all", async () => {
    resolveUser.mockResolvedValue(null);

    const response = await POST(request("POST", { body: { bookmarks: [] } }));

    expect(response.status).toBe(401);
    expect(findBookmarks).not.toHaveBeenCalled();
  });

  it("answers 401 for a malformed bearer token", async () => {
    resolveUser.mockResolvedValue(null);

    const response = await POST(request("POST", { headers: BEARER, body: {} }));

    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("Unauthorized");
  });

  it("answers 401 when the token verifier rejects the token", async () => {
    resolveUser.mockResolvedValue(null);

    const response = await GET(request("GET", { headers: BEARER }));

    expect(response.status).toBe(401);
  });

  it("accepts the cookie session when there is no Authorization header", async () => {
    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    expect(resolveUser).toHaveBeenCalledTimes(1);
    expect(findBookmarks).toHaveBeenCalledTimes(1);
  });

  it("does not spend a rate-limit token on an unauthenticated request", async () => {
    resolveUser.mockResolvedValue(null);

    await GET(request("GET"));

    expect(rateLimit).not.toHaveBeenCalled();
  });
});

describe("POST /api/mobile/v1/sync — caller identity", () => {
  it("scopes every query to the resolved user id", async () => {
    const response = await POST(
      request("POST", {
        headers: BEARER,
        body: { bookmarks: [{ itemId: ITEM, title: "saved", updatedAt: T0 }] },
      })
    );

    expect(response.status).toBe(200);
    expect(findBookmarks).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: USER_ID }),
      })
    );
    expect(sqlCalls()[0]?.values).toContain(USER_ID);
  });

  it("uses the Postgres id even when it differs from the Clerk id", async () => {
    // An Auth.js-era row keeps its cuid; sync rows must hang off that id.
    resolveUser.mockResolvedValue({
      id: "cuid_authjs",
      email: "probe@example.test",
      name: "Probe Reader",
      image: null,
      role: "USER",
    });

    const response = await POST(
      request("POST", {
        headers: BEARER,
        body: { bookmarks: [{ itemId: ITEM, title: "saved", updatedAt: T0 }] },
      })
    );

    expect(response.status).toBe(200);
    expect(findBookmarks).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "cuid_authjs" }),
      })
    );
    expect(sqlCalls()[0]?.values).toContain("cuid_authjs");
  });
});

describe("GET /api/mobile/v1/sync — delta pull", () => {
  it("returns the full state, tombstones included, when since is omitted", async () => {
    findBookmarks.mockResolvedValue([
      bookmarkRow(),
      bookmarkRow({
        itemId: "rss:deadbeef",
        title: "Deleted",
        sourceUrl: null,
        updatedAt: new Date(T1),
        savedAt: new Date(T1),
        deletedAt: new Date(T1),
      }),
    ]);

    const response = await GET(request("GET", { headers: BEARER }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(new Date(body.serverTime).toISOString()).toBe(body.serverTime);
    expect(body.hasMore).toBe(false);
    expect(body.bookmarks).toHaveLength(2);
    expect(body.bookmarks[0]).toMatchObject({ itemId: ITEM, deleted: false });
    expect(body.bookmarks[1]).toMatchObject({
      itemId: "rss:deadbeef",
      deleted: true,
    });
    expect(findBookmarks).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID }, take: 501 })
    );
  });

  it("filters by since and passes the limit through, per collection", async () => {
    const response = await GET(
      request("GET", {
        headers: BEARER,
        query: `?since=${encodeURIComponent(T0)}&limit=10`,
      })
    );

    expect(response.status).toBe(200);
    for (const finder of [findBookmarks, findReactions, findFollows]) {
      expect(finder).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: USER_ID, updatedAt: { gt: new Date(T0) } },
          take: 11,
        })
      );
    }
  });

  it("sets hasMore when any collection was truncated", async () => {
    findFollows.mockResolvedValue(
      Array.from({ length: 3 }, (_, index) => ({
        targetId: `team:t${index}`,
        kind: "team",
        label: null,
        updatedAt: new Date(T1),
        deletedAt: null,
      }))
    );

    const response = await GET(
      request("GET", { headers: BEARER, query: "?limit=2" })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.follows).toHaveLength(2);
    expect(body.hasMore).toBe(true);
  });

  it("rejects a malformed since", async () => {
    const response = await GET(
      request("GET", { headers: BEARER, query: "?since=yesterday" })
    );

    expect(response.status).toBe(400);
    expect(findBookmarks).not.toHaveBeenCalled();
  });

  it("rejects a limit outside 1..500", async () => {
    expect(
      (await GET(request("GET", { headers: BEARER, query: "?limit=0" }))).status
    ).toBe(400);
    expect(
      (await GET(request("GET", { headers: BEARER, query: "?limit=501" })))
        .status
    ).toBe(400);
    expect(
      (await GET(request("GET", { headers: BEARER, query: "?limit=abc" })))
        .status
    ).toBe(400);
  });
});

describe("POST /api/mobile/v1/sync — merge", () => {
  it("applies a new row and returns the touched state", async () => {
    const response = await POST(
      request("POST", {
        headers: BEARER,
        body: {
          bookmarks: [
            {
              itemId: ITEM,
              title: "Leone Stars level with Guinea",
              savedAt: T0,
              updatedAt: T0,
              deleted: false,
            },
          ],
        },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.applied).toEqual({ bookmarks: 1, reactions: 0, follows: 0 });
    expect(body.rejected).toEqual([]);
    expect(body.state.bookmarks).toHaveLength(1);
    expect(body.state.bookmarks[0]).toMatchObject({
      itemId: ITEM,
      deleted: false,
    });
    // One guarded insert + one guarded update per chunk.
    expect(executeRaw).toHaveBeenCalledTimes(2);
    expect(sqlCalls()[1]?.text).toContain('"updatedAt" > target."updatedAt"');
  });

  it("rejects an older row as stale and still returns the server's row", async () => {
    findBookmarks.mockResolvedValue([
      bookmarkRow({ title: "v2", updatedAt: new Date(T1) }),
    ]);

    const response = await POST(
      request("POST", {
        headers: BEARER,
        body: {
          bookmarks: [
            { itemId: ITEM, title: "v1", updatedAt: T0, deleted: false },
          ],
        },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.applied.bookmarks).toBe(0);
    expect(body.rejected).toEqual([
      { collection: "bookmarks", itemId: ITEM, reason: "stale" },
    ]);
    expect(body.state.bookmarks[0].title).toBe("v2");
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("is idempotent on an equal timestamp", async () => {
    findReactions.mockResolvedValue([
      { itemId: ITEM, kind: "like", updatedAt: new Date(T0), deletedAt: null },
    ]);

    const response = await POST(
      request("POST", {
        headers: BEARER,
        body: {
          reactions: [
            { itemId: ITEM, kind: "like", updatedAt: T0, deleted: false },
          ],
        },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.applied.reactions).toBe(0);
    expect(body.rejected).toEqual([]);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("keeps a tombstone when a stale non-deleted push arrives", async () => {
    findBookmarks.mockResolvedValue([
      bookmarkRow({
        title: "deleted",
        updatedAt: new Date(T1),
        deletedAt: new Date(T1),
      }),
    ]);

    const response = await POST(
      request("POST", {
        headers: BEARER,
        body: {
          bookmarks: [
            { itemId: ITEM, title: "resurrect", updatedAt: T0, deleted: false },
          ],
        },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.applied.bookmarks).toBe(0);
    expect(body.rejected[0]).toMatchObject({ itemId: ITEM, reason: "stale" });
    expect(body.state.bookmarks[0].deleted).toBe(true);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("applies a tombstone", async () => {
    const response = await POST(
      request("POST", {
        headers: BEARER,
        body: {
          bookmarks: [
            { itemId: ITEM, title: "gone", updatedAt: T1, deleted: true },
          ],
        },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.applied.bookmarks).toBe(1);
    expect(body.state.bookmarks[0].deleted).toBe(true);
    // deletedAt is derived from updatedAt, never taken from the client.
    expect(sqlCalls()[0]?.text).toContain('"deletedAt"');
  });

  it("applies every collection in one batch", async () => {
    const response = await POST(
      request("POST", {
        headers: BEARER,
        body: {
          bookmarks: [{ itemId: ITEM, title: "saved", updatedAt: T0 }],
          reactions: [{ itemId: ITEM, kind: "like", updatedAt: T0 }],
          follows: [
            {
              targetId: "team:lal",
              kind: "team",
              label: "Lakers",
              updatedAt: T0,
            },
          ],
        },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.applied).toEqual({ bookmarks: 1, reactions: 1, follows: 1 });
    expect(body.state.follows[0]).toMatchObject({
      targetId: "team:lal",
      kind: "team",
    });
    expect(executeRaw).toHaveBeenCalledTimes(6);
  });
});

describe("POST /api/mobile/v1/sync — validation", () => {
  it("answers 400 for a missing required field", async () => {
    const response = await POST(
      request("POST", {
        headers: BEARER,
        body: { bookmarks: [{ itemId: ITEM }] },
      })
    );

    expect(response.status).toBe(400);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("answers 400 for a bad timestamp", async () => {
    const response = await POST(
      request("POST", {
        headers: BEARER,
        body: {
          bookmarks: [{ itemId: ITEM, title: "x", updatedAt: "16/10/2026" }],
        },
      })
    );

    expect(response.status).toBe(400);
  });

  it("answers 400 for a bad kind", async () => {
    const follow = await POST(
      request("POST", {
        headers: BEARER,
        body: {
          follows: [{ targetId: "team:lal", kind: "sport", updatedAt: T0 }],
        },
      })
    );
    const reaction = await POST(
      request("POST", {
        headers: BEARER,
        body: { reactions: [{ itemId: ITEM, kind: "love", updatedAt: T0 }] },
      })
    );

    expect(follow.status).toBe(400);
    expect(reaction.status).toBe(400);
  });

  it("answers 400 for malformed JSON", async () => {
    const response = await POST(
      request("POST", { headers: BEARER, body: "{not json" })
    );

    expect(response.status).toBe(400);
  });

  it("answers 413 over the 500-row cap", async () => {
    const follows = Array.from({ length: 501 }, (_, index) => ({
      targetId: `team:t${index}`,
      kind: "team",
      updatedAt: T0,
    }));

    const response = await POST(
      request("POST", { headers: BEARER, body: { follows } })
    );

    expect(response.status).toBe(413);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("answers 413 over the 200 KB body cap", async () => {
    // The cap itself is asserted in the validation tests; here one row carries a
    // body larger than it.
    const padding = "x".repeat(200 * 1024);

    const response = await POST(
      request("POST", {
        headers: BEARER,
        body: {
          bookmarks: [
            { itemId: ITEM, title: "big", updatedAt: T0, sourceUrl: padding },
          ],
        },
      })
    );

    expect(response.status).toBe(413);
  });

  it("authenticates and rate-limits before answering 413", async () => {
    const follows = Array.from({ length: 501 }, (_, index) => ({
      targetId: `team:t${index}`,
      kind: "team",
      updatedAt: T0,
    }));

    const response = await POST(
      request("POST", { headers: BEARER, body: { follows } })
    );

    expect(response.status).toBe(413);
    expect(rateLimit).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/mobile/v1/sync — limits and faults", () => {
  it("answers 429 with Retry-After when the per-user bucket is empty", async () => {
    rateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfter: 90,
    });

    const response = await POST(
      request("POST", { headers: BEARER, body: { bookmarks: [] } })
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("90");
    expect(rateLimit).toHaveBeenCalledWith(
      `mobile-sync:${USER_ID}:203.0.113.7`,
      expect.objectContaining({ maxRequests: 60, windowMs: 15 * 60 * 1000 })
    );
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("answers 500 and reports the fault when the write fails", async () => {
    transaction.mockRejectedValue(new Error("db down"));

    const response = await POST(
      request("POST", {
        headers: BEARER,
        body: { bookmarks: [{ itemId: ITEM, title: "x", updatedAt: T0 }] },
      })
    );

    expect(response.status).toBe(500);
    expect(report).toHaveBeenCalledWith(expect.any(Error), {
      where: "api/mobile/v1/sync",
    });
  });

  it("answers 500 and reports the fault when the pull fails", async () => {
    findBookmarks.mockRejectedValue(new Error("db down"));

    const response = await GET(request("GET", { headers: BEARER }));

    expect(response.status).toBe(500);
    expect(report).toHaveBeenCalledWith(expect.any(Error), {
      where: "api/mobile/v1/sync",
    });
  });

  it("sends no-store so no proxy caches per-user state", async () => {
    const response = await GET(request("GET", { headers: BEARER }));

    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
