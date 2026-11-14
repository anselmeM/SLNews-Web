import type { Prisma } from "@prisma/client";
import { findArticlePage, type ArticleWithRelations } from "./article-query";
import { cachedFetch, staleWhileRevalidate } from "./cache";
import { db } from "./db";
import { provinceMatchTerms } from "./geo";

export type { ArticleWithRelations } from "./article-query";

export type NewsArticle = {
  id: string;
  title: string;
  summary: string;
  content: string;
  imageUrl: string;
  category: string;
  location?: string;
  source: string;
  sourceImage?: string;
  publishedAt: string;
  externalUrl?: string;
  authorId: string;
};

export function mapPrismaArticle(article: ArticleWithRelations): NewsArticle {
  const categoryName = article.categories?.[0]?.name || "National";

  let sourceName = article.author?.name || "SLNews Contributor";
  if (sourceName === "News Bot") {
    const match = article.content?.match(/Source: (.+?) —/);
    if (match?.[1]) sourceName = match[1].trim();
  }

  return {
    id: article.id,
    title: article.title,
    summary: article.summary || "",
    content: article.content,
    imageUrl: article.imageUrl || "/globe.svg",
    category: categoryName,
    location: article.district || article.province || undefined,
    source: sourceName,
    sourceImage: article.author?.image || undefined,
    publishedAt: article.publishedAt
      ? article.publishedAt.toISOString()
      : article.createdAt.toISOString(),
    authorId: article.authorId,
  };
}

const DEFAULT_PAGE_SIZE = 10;
// The home page and its briefing digest both read this many feed articles, so
// they share one cached query per render instead of issuing two.
export const HOME_FEED_SIZE = 30;
const TTL = { feed: 30, single: 60 };
// Sierra Leone news feed categories. "Local" and "National" were merged into
// a single "National" tag — they drive the national feed.
export const SL_FEED_CATEGORIES = [
  "National",
  "Politics",
  "Economy",
  "Education",
];
// International / world news categories (populated by the world-news sync;
// mirrors the /world page tabs: World, Africa, Business, Tech, Health,
// Sports, Culture).
const WORLD_FEED_CATEGORIES = [
  "International",
  "Africa",
  "Business",
  "Sports",
  "Tech",
  "Health",
  "Culture",
];

export async function fetchSLNews(
  region?: string,
  topic?: string,
  skip = 0,
  take = DEFAULT_PAGE_SIZE
): Promise<NewsArticle[]> {
  return staleWhileRevalidate(
    `slnews:${region}:${topic}:${skip}:${take}`,
    async () => {
      const categoryNames = topic ? [topic] : SL_FEED_CATEGORIES;
      const where: Prisma.ArticleWhereInput = {
        published: true,
        status: "PUBLISHED",
        categories: { some: { name: { in: categoryNames } } },
      };
      if (region) where.province = region;
      const articles = await findArticlePage(where, { skip, take });
      return articles.map(mapPrismaArticle);
    },
    TTL.feed
  );
}

// One page of the home feed: interleaves Sierra Leone news with international
// news so the home page always shows a mix of both, never one-sided.
async function fetchMixedFeedPage(
  skip: number,
  take: number
): Promise<ArticleWithRelations[]> {
  const half = Math.ceil(take / 2);
  // Both groups advance by the same offset so every page stays a half/half mix.
  const groupSkip = Math.floor(skip / 2);
  const [sl, world] = await Promise.all([
    findArticlePage(
      {
        published: true,
        status: "PUBLISHED",
        categories: { some: { name: { in: SL_FEED_CATEGORIES } } },
      },
      { skip: groupSkip, take: half }
    ),
    findArticlePage(
      {
        published: true,
        status: "PUBLISHED",
        categories: { some: { name: { in: WORLD_FEED_CATEGORIES } } },
      },
      { skip: groupSkip, take: half }
    ),
  ]);

  const mixed: ArticleWithRelations[] = [];
  let li = 0;
  let wi = 0;
  while (mixed.length < take && (li < sl.length || wi < world.length)) {
    const slItem = sl[li];
    if (slItem) mixed.push(slItem);
    li++;
    const worldItem = world[wi];
    if (worldItem && mixed.length < take) mixed.push(worldItem);
    wi++;
  }
  return mixed;
}

// First page of the home feed (stale-while-revalidate — shared by SSR and the
// client feed; keeps serving the cached page while it refreshes in the
// background so the reader never waits on Neon).
export async function fetchMixedHomeFeed(
  take = DEFAULT_PAGE_SIZE
): Promise<NewsArticle[]> {
  return staleWhileRevalidate(
    `home:${take}`,
    async () => {
      return (await fetchMixedFeedPage(0, take)).map(mapPrismaArticle);
    },
    TTL.feed
  );
}

// Paginated home feed (used for "More Articles" / pull-to-refresh).
export async function fetchMixedNews(
  skip = 0,
  take = DEFAULT_PAGE_SIZE
): Promise<NewsArticle[]> {
  return (await fetchMixedFeedPage(skip, take)).map(mapPrismaArticle);
}

export async function fetchTrendingNews(
  skip = 0,
  take = DEFAULT_PAGE_SIZE
): Promise<NewsArticle[]> {
  return staleWhileRevalidate(
    `trending:${skip}:${take}`,
    async () => {
      const articles = await findArticlePage(
        { published: true, status: "PUBLISHED" },
        { skip, take }
      );
      return articles.map(mapPrismaArticle);
    },
    60
  );
}

export async function fetchLocalNews(
  province?: string,
  district?: string,
  skip = 0,
  take = DEFAULT_PAGE_SIZE
): Promise<NewsArticle[]> {
  return staleWhileRevalidate(
    `local:${province}:${district}:${skip}:${take}`,
    async () => {
      const where: Prisma.ArticleWhereInput = {
        published: true,
        status: "PUBLISHED",
        categories: { some: { name: { in: SL_FEED_CATEGORIES } } },
      };
      if (province) where.province = province;
      if (district) where.district = district;
      const articles = await findArticlePage(where, { skip, take });
      return articles.map(mapPrismaArticle);
    },
    TTL.feed
  );
}

export async function fetchWorldNews(
  topic?: string,
  skip = 0,
  take = DEFAULT_PAGE_SIZE
): Promise<NewsArticle[]> {
  return staleWhileRevalidate(
    `world:${topic}:${skip}:${take}`,
    async () => {
      const categoryName = topic && topic !== "World" ? topic : "International";
      const articles = await findArticlePage(
        {
          published: true,
          status: "PUBLISHED",
          categories: { some: { name: categoryName } },
        },
        { skip, take }
      );
      return articles.map(mapPrismaArticle);
    },
    TTL.feed
  );
}

export async function fetchNationalNews(
  category = "National",
  skip = 0,
  take = DEFAULT_PAGE_SIZE
): Promise<NewsArticle[]> {
  return staleWhileRevalidate(
    `national:${category}:${skip}:${take}`,
    async () => {
      const articles = await findArticlePage(
        {
          published: true,
          status: "PUBLISHED",
          categories: { some: { name: category } },
        },
        { skip, take }
      );
      return articles.map(mapPrismaArticle);
    },
    TTL.feed
  );
}

export async function fetchArticleById(
  id: string
): Promise<NewsArticle | null> {
  return cachedFetch(
    `article:${id}`,
    async () => {
      const article = await db.article.findUnique({
        where: { id },
        include: { author: true, categories: true },
      });
      if (!article) return null;
      return mapPrismaArticle(article);
    },
    TTL.single
  );
}

export type SearchFilters = {
  category?: string;
  province?: string;
  dateFrom?: string;
};

export async function searchArticles(
  query: string,
  skip = 0,
  take = DEFAULT_PAGE_SIZE,
  filters?: SearchFilters
): Promise<NewsArticle[]> {
  const sanitized = query.trim().slice(0, 200);
  if (!sanitized) return [];
  const f = filters ?? {};
  const filterKey = `${f.category ?? ""}:${f.province ?? ""}:${f.dateFrom ?? ""}`;
  // Searches are user-specific — short TTL to avoid stale cache on repeat queries
  return cachedFetch(
    `search:${sanitized}:${skip}:${take}:${filterKey}`,
    async () => {
      const where: Prisma.ArticleWhereInput = {
        published: true,
        status: "PUBLISHED",
        OR: [
          { title: { contains: sanitized, mode: "insensitive" } },
          { summary: { contains: sanitized, mode: "insensitive" } },
          { content: { contains: sanitized, mode: "insensitive" } },
        ],
      };
      if (f.category) where.categories = { some: { name: f.category } };
      // Province filtering matches every spelling the column may hold, plus the
      // districts of that province — `mapPrismaArticle` shows `district || province`
      // as the story's location, so a story tagged only "Bo" is a Southern Province
      // story to the reader. An unrecognised value filters nothing rather than
      // filtering on an impossible one, which would look like "no news from there".
      const provinceTerms = provinceMatchTerms(f.province);
      if (provinceTerms) {
        where.AND = [
          {
            OR: [
              { province: { in: provinceTerms.provinces } },
              { district: { in: provinceTerms.districts } },
            ],
          },
        ];
      }
      if (f.dateFrom) {
        const from = new Date(f.dateFrom);
        if (!Number.isNaN(from.getTime())) where.publishedAt = { gte: from };
      }
      const articles = await findArticlePage(where, { skip, take });
      return articles.map(mapPrismaArticle);
    },
    15
  );
}

export async function fetchRelatedArticles(
  excludeId: string,
  category: string,
  take = 4
): Promise<NewsArticle[]> {
  return cachedFetch(
    `related:${excludeId}:${category}:${take}`,
    async () => {
      const articles = await findArticlePage(
        {
          id: { not: excludeId },
          published: true,
          status: "PUBLISHED",
          categories: { some: { name: category } },
        },
        { take }
      );
      return articles.map(mapPrismaArticle);
    },
    TTL.single
  );
}

export async function fetchFollowingNews(
  userId: string,
  skip = 0,
  take = DEFAULT_PAGE_SIZE
): Promise<NewsArticle[]> {
  return cachedFetch(
    `following:${userId}:${skip}:${take}`,
    async () => {
      const follows = await db.follow.findMany({
        where: { followerId: userId },
        select: { followingId: true },
      });
      const authorIds = follows.map((f) => f.followingId);
      if (authorIds.length === 0) return [];

      const articles = await findArticlePage(
        {
          published: true,
          status: "PUBLISHED",
          authorId: { in: authorIds },
        },
        { skip, take }
      );
      return articles.map(mapPrismaArticle);
    },
    TTL.feed
  );
}
