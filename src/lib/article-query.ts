import type { Article, Category, Prisma, User } from "@prisma/client";
import { db } from "./db";

export type ArticleWithRelations = Article & {
  author: Pick<User, "name" | "image"> | null;
  categories: Pick<Category, "name">[];
};

export interface ArticlePage {
  skip?: number;
  take?: number;
}

/**
 * The one article listing shape used by every feed/search query.
 *
 * Keeping order/include here means a new feed cannot silently return a
 * different order or forget the relations `mapPrismaArticle` expects.
 */
export async function findArticlePage(
  where: Prisma.ArticleWhereInput,
  page: ArticlePage = {}
): Promise<ArticleWithRelations[]> {
  return db.article.findMany({
    where,
    orderBy: { publishedAt: "desc" },
    include: { author: true, categories: true },
    ...(page.skip !== undefined ? { skip: page.skip } : {}),
    ...(page.take !== undefined ? { take: page.take } : {}),
  });
}
