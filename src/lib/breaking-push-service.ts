import { sendPushNotifications } from "@/app/actions/push-actions";
import { db } from "@/lib/db";

export interface BreakingArticlePayload {
  title: string;
  body: string;
  url: string;
  tag: string;
  actions: Array<{ action: string; title: string }>;
}

export function formatBreakingPayload(article: {
  id: string;
  title: string;
  summary?: string | null;
}): BreakingArticlePayload {
  return {
    title: "🚨 BREAKING NEWS",
    body: article.title,
    url: `/article/${article.id}`,
    tag: `slnews-breaking-${article.id}`,
    actions: [{ action: "open", title: "Read Story" }],
  };
}

export async function broadcastBreakingArticle(
  articleId: string
): Promise<{ sent: number; error?: string }> {
  try {
    const article = await db.article.findUnique({
      where: { id: articleId },
      select: {
        id: true,
        title: true,
        summary: true,
        published: true,
        breaking: true,
      },
    });

    if (!article) {
      return { sent: 0, error: "Article not found" };
    }

    const payload = formatBreakingPayload(article);
    const result = await sendPushNotifications(
      payload.title,
      payload.body,
      payload.url,
      {
        tag: payload.tag,
        actions: payload.actions,
        category: "breaking",
        // The broadcast topic every reader who enabled breaking news has
        // subscribed to; phones are not fanned out token-by-token.
        targets: ["breaking"],
      }
    );

    return { sent: result.sent };
  } catch (error) {
    return {
      sent: 0,
      error:
        error instanceof Error
          ? error.message
          : "Failed to broadcast breaking news",
    };
  }
}
