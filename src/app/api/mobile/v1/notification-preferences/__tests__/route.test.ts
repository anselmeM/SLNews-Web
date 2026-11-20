import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PUT } from "../route";
import { db } from "@/lib/db";
import { resolveMobileUser } from "@/lib/mobile-sync/resolve-mobile-user";
import { checkDbRateLimit } from "@/lib/rate-limiter";

vi.mock("@/lib/db", () => ({
  db: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));

vi.mock("@/lib/mobile-sync/resolve-mobile-user", () => ({
  resolveMobileUser: vi.fn(),
}));

vi.mock("@/lib/rate-limiter", () => ({
  checkDbRateLimit: vi.fn(),
  getClientIp: vi.fn(() => "203.0.113.7"),
}));

vi.mock("@/lib/error-reporting", () => ({ reportError: vi.fn() }));

const PREFS = {
  digestCadence: "daily",
  quietHoursStart: 22 * 60,
  quietHoursEnd: 7 * 60,
  timezoneOffsetMinutes: 0,
};

function request(method: string, body?: unknown): Request {
  return new Request(
    "http://localhost/api/mobile/v1/notification-preferences",
    {
      method,
      headers: {
        authorization: "Bearer session.jwt",
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }
  );
}

function signedIn(): void {
  vi.mocked(resolveMobileUser).mockResolvedValue({
    id: "user-1",
    email: "reader@example.com",
    name: "Reader",
    image: null,
    role: "USER",
  } as never);
  vi.mocked(checkDbRateLimit).mockResolvedValue({
    allowed: true,
    retryAfter: 0,
  } as never);
}

describe("/api/mobile/v1/notification-preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signedIn();
    vi.mocked(db.user.findUnique).mockResolvedValue(PREFS as never);
    vi.mocked(db.user.update).mockResolvedValue(PREFS as never);
  });

  it("rejects an unauthenticated read", async () => {
    vi.mocked(resolveMobileUser).mockResolvedValue(null);

    const response = await GET(request("GET"));

    expect(response.status).toBe(401);
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("returns the preferences with display labels", async () => {
    const response = await GET(request("GET"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      digestCadence: "daily",
      quietHoursStart: 1320,
      quietHoursEnd: 420,
      quietHoursStartLabel: "22:00",
      quietHoursEndLabel: "07:00",
    });
  });

  it("saves cadence and a quiet window", async () => {
    vi.mocked(db.user.update).mockResolvedValue({
      ...PREFS,
      digestCadence: "off",
      quietHoursStart: 21 * 60,
      quietHoursEnd: 6 * 60,
    } as never);

    const response = await PUT(
      request("PUT", {
        digestCadence: "off",
        quietHoursStart: "21:00",
        quietHoursEnd: 360,
        timezoneOffsetMinutes: 60,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: {
          digestCadence: "off",
          quietHoursStart: 1260,
          quietHoursEnd: 360,
          timezoneOffsetMinutes: 60,
        },
      })
    );
    expect(body).toMatchObject({
      digestCadence: "off",
      quietHoursStartLabel: "21:00",
      quietHoursEndLabel: "06:00",
    });
  });

  it("clears a quiet window with two nulls", async () => {
    vi.mocked(db.user.update).mockResolvedValue({
      ...PREFS,
      quietHoursStart: null,
      quietHoursEnd: null,
    } as never);

    const response = await PUT(
      request("PUT", { quietHoursStart: null, quietHoursEnd: null })
    );

    expect(response.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { quietHoursStart: null, quietHoursEnd: null },
      })
    );
  });

  it("rejects malformed preferences", async () => {
    const cases: unknown[] = [
      { digestCadence: "weekly" },
      { quietHoursStart: 22 * 60 },
      { quietHoursStart: 22 * 60, quietHoursEnd: null },
      { quietHoursStart: "25:00", quietHoursEnd: "07:00" },
      { digestCadence: "daily", timezoneOffsetMinutes: 900 },
      {},
    ];
    for (const body of cases) {
      const response = await PUT(request("PUT", body));
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("rate-limits preference writes", async () => {
    vi.mocked(checkDbRateLimit).mockResolvedValue({
      allowed: false,
      retryAfter: 12,
    } as never);

    const response = await PUT(request("PUT", { digestCadence: "off" }));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("12");
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
