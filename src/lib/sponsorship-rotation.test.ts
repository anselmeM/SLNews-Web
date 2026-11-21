import { describe, expect, it } from "vitest";
import { rotateSponsorships } from "./sponsorship-rotation";

type Row = { id: string; priority: number; weight: number };

describe("rotateSponsorships", () => {
  it("respects priority before weight", () => {
    const rows: Row[] = [
      { id: "low-heavy", priority: 0, weight: 100 },
      { id: "high-light", priority: 5, weight: 1 },
      { id: "high-heavy", priority: 5, weight: 100 },
    ];
    const result = rotateSponsorships(rows, 2, 123);
    expect(result.map((row) => row.id)).toContain("high-light");
    expect(result.map((row) => row.id)).not.toContain("low-heavy");
  });

  it("rotates campaigns instead of always serving the newest", () => {
    const rows: Row[] = Array.from({ length: 6 }, (_, index) => ({
      id: `campaign-${index}`,
      priority: 0,
      weight: 1,
    }));
    const seen = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      for (const row of rotateSponsorships(rows, 2, seed)) seen.add(row.id);
    }
    expect(seen.size).toBeGreaterThan(2);
  });

  it("never returns duplicates or more than the limit", () => {
    const rows: Row[] = Array.from({ length: 10 }, (_, index) => ({
      id: `campaign-${index}`,
      priority: index % 2,
      weight: (index % 3) + 1,
    }));
    const result = rotateSponsorships(rows, 4, 42);
    expect(result).toHaveLength(4);
    expect(new Set(result.map((row) => row.id)).size).toBe(4);
  });
});
