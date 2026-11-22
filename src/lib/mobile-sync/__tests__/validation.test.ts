import { describe, expect, it } from "vitest";
import { parsePushBody } from "@/lib/mobile-sync/validation";

describe("mobile sync validation", () => {
  it("clamps a client timestamp that is far in the future", () => {
    const future = new Date(Date.now() + 365 * 24 * 60 * 60_000);
    const result = parsePushBody(
      JSON.stringify({
        bookmarks: [
          {
            itemId: "rss:future",
            title: "Future",
            updatedAt: future.toISOString(),
          },
        ],
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const updatedAt = result.value.bookmarks[0]?.updatedAt;
    expect(updatedAt).toBeInstanceOf(Date);
    expect(updatedAt!.getTime()).toBeLessThanOrEqual(
      Date.now() + 5 * 60_000 + 1_000
    );
  });

  it("keeps a normal past timestamp unchanged", () => {
    const past = new Date(Date.now() - 60_000);
    const result = parsePushBody(
      JSON.stringify({
        bookmarks: [
          {
            itemId: "rss:past",
            title: "Past",
            updatedAt: past.toISOString(),
          },
        ],
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.bookmarks[0]?.updatedAt.getTime()).toBe(past.getTime());
  });
});
