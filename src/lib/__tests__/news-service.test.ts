import type { Article, User, Category } from "@prisma/client";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { mapPrismaArticle, searchArticles } from "@/lib/news-service";

vi.mock("@/lib/db", () => ({
  db: { article: { findMany: vi.fn() } },
}));

vi.mock("@/lib/cache", () => ({
  cachedFetch: (_key: string, fn: () => unknown) => fn(),
  staleWhileRevalidate: (_key: string, fn: () => unknown) => fn(),
}));

const findMany = vi.mocked(db.article.findMany);

function whereOf(call = 0): Record<string, unknown> {
  const args = findMany.mock.calls[call]?.[0] as {
    where: Record<string, unknown>;
  };
  return args.where;
}

type TestArticle = Article & {
  author: Pick<User, "name" | "image"> | null;
  categories: Pick<Category, "name">[];
};

function makeArticle(overrides: Partial<TestArticle> = {}): TestArticle {
  const now = new Date("2026-07-01T12:00:00Z");
  return {
    id: "art-1",
    title: "Test Article",
    content: "Test content goes here.",
    summary: "A test summary.",
    imageUrl: "/test.jpg",
    sourceUrl: null,
    publisher: null,
    published: true,
    status: "PUBLISHED",
    province: "Western Area",
    district: "Freetown",
    authorId: "user-1",
    createdAt: now,
    updatedAt: now,
    publishedAt: now,
    breaking: false,
    breakingSetAt: null,
    author: { name: "John Doe", image: null },
    categories: [{ name: "National" }],
    ...overrides,
  };
}

describe("mapPrismaArticle", () => {
  it("maps a full article correctly", () => {
    const result = mapPrismaArticle(makeArticle());
    expect(result).toEqual({
      id: "art-1",
      title: "Test Article",
      summary: "A test summary.",
      content: "Test content goes here.",
      imageUrl: "/test.jpg",
      category: "National",
      location: "Freetown",
      source: "John Doe",
      sourceImage: undefined,
      authorId: "user-1",
      publishedAt: "2026-07-01T12:00:00.000Z",
    });
  });

  it("falls back to province when district is null", () => {
    const result = mapPrismaArticle(makeArticle({ district: null }));
    expect(result.location).toBe("Western Area");
  });

  it("returns undefined location when both district and province are null", () => {
    const result = mapPrismaArticle(
      makeArticle({ district: null, province: null })
    );
    expect(result.location).toBeUndefined();
  });

  it("uses default category 'National' when no categories exist", () => {
    const result = mapPrismaArticle(makeArticle({ categories: [] }));
    expect(result.category).toBe("National");
  });

  it("falls back to '/globe.svg' when imageUrl is null", () => {
    const result = mapPrismaArticle(makeArticle({ imageUrl: null }));
    expect(result.imageUrl).toBe("/globe.svg");
  });

  it("uses 'SLNews Contributor' when author is null", () => {
    const result = mapPrismaArticle(makeArticle({ author: null }));
    expect(result.source).toBe("SLNews Contributor");
  });

  it("uses createdAt when publishedAt is null", () => {
    const createdAt = new Date("2026-06-01T08:00:00Z");
    const result = mapPrismaArticle(
      makeArticle({ publishedAt: null, createdAt })
    );
    expect(result.publishedAt).toBe(createdAt.toISOString());
  });

  it("uses empty string when summary is null", () => {
    const result = mapPrismaArticle(makeArticle({ summary: null }));
    expect(result.summary).toBe("");
  });
});

/**
 * The province filter used to compare one exact string, while the app wrote
 * three different vocabularies into `province` — so picking a province returned
 * an empty page unless the stored spelling happened to match the option.
 */
describe("searchArticles — province filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([] as never);
  });

  it("matches a legacy spelling as well as the canonical one", async () => {
    await searchArticles("solar", 0, 20, { province: "Southern" });

    expect(whereOf().AND).toEqual([
      {
        OR: [
          { province: { in: ["Southern Province", "Southern"] } },
          { district: { in: ["Bo", "Bonthe", "Moyamba", "Pujehun"] } },
        ],
      },
    ]);
  });

  it("includes stories tagged only with a district of that province", async () => {
    await searchArticles("solar", 0, 20, { province: "Eastern Province" });

    expect(whereOf().AND).toEqual([
      {
        OR: [
          { province: { in: ["Eastern Province", "Eastern"] } },
          { district: { in: ["Kailahun", "Kenema", "Kono"] } },
        ],
      },
    ]);
  });

  it("keeps the text search intact and drops the old exact-match clause", async () => {
    await searchArticles("solar", 0, 20, { province: "Southern Province" });

    const where = whereOf();
    expect(where.OR).toHaveLength(3);
    expect(where.province).toBeUndefined();
    expect(where.AND).toHaveLength(1);
  });

  it("filters nothing for a value that is not a province", async () => {
    await searchArticles("solar", 0, 20, { province: "Nationwide" });

    expect(whereOf().AND).toBeUndefined();
  });

  it("does not widen one province into another", async () => {
    await searchArticles("solar", 0, 20, { province: "Southern Province" });
    await searchArticles("solar", 0, 20, { province: "Northern Province" });

    const southern = JSON.stringify(whereOf(0).AND);
    const northern = JSON.stringify(whereOf(1).AND);

    expect(southern).not.toBe(northern);
    expect(northern).toContain("Bombali");
    expect(northern).not.toContain("Pujehun");
  });

  it("still searches without any province filter", async () => {
    await searchArticles("solar", 0, 20);

    expect(whereOf().AND).toBeUndefined();
    expect(whereOf().OR).toHaveLength(3);
  });
});
