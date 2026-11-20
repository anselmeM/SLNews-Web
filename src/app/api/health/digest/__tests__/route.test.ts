import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";

import { GET } from "../route";

vi.mock("@/lib/db", () => ({
  db: {
    digestRun: { findFirst: vi.fn() },
  },
}));

describe("GET /api/health/digest", () => {
  beforeEach(() => {
    vi.mocked(db.digestRun.findFirst).mockReset();
  });

  it("returns the latest digest claim with its subject count", async () => {
    vi.mocked(db.digestRun.findFirst).mockResolvedValue({
      day: "2026-11-19",
      topics: 3,
      createdAt: new Date("2026-11-19T06:31:12.000Z"),
    } as never);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      digest: {
        day: "2026-11-19",
        topics: 3,
        at: "2026-11-19T06:31:12.000Z",
      },
    });
  });

  it("returns null when no digest has ever claimed a day", async () => {
    vi.mocked(db.digestRun.findFirst).mockResolvedValue(null);

    await expect((await GET()).json()).resolves.toEqual({ digest: null });
  });

  it("reports a 503 instead of throwing when the database is down", async () => {
    vi.mocked(db.digestRun.findFirst).mockRejectedValue(new Error("db down"));

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      digest: null,
      error: "db down",
    });
  });
});
