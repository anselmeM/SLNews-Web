/**
 * Daily follow digest: one push per busy subject, published to that subject's
 * FCM topic.
 *
 * The app subscribes `slnews_<follow id>` for every topic, team, league and
 * newspaper the reader follows, so a message published here reaches exactly the
 * readers who follow that subject. Nothing is fanned out per device: the server
 * does not need to know who follows what.
 *
 * Rules, all of them deliberate:
 *
 * - **Once a day.** The sync cron runs daily at 06:30, so the window is the
 *   previous 24 hours and the windows tile instead of overlapping (a shorter
 *   window would either miss stories or alert the same ones twice).
 * - **At least three stories.** One story is not a digest, and a push per story
 *   per subject would be spam; busy subjects earn the alert.
 * - **At most six subjects per run.** Topics are global, so the cap is the only
 *   thing bounding how many pushes a heavily-following reader receives in a
 *   day. The busiest subjects win.
 */
import { Status } from "@prisma/client";
import { sendPushNotifications } from "@/app/actions/push-actions";
import { db } from "@/lib/db";
import {
  categoryTargetForName,
  publisherTargetForSource,
  publisherTargetForUrl,
  publisherNameForId,
} from "@/lib/push/topics";

/** The daily digest window. Cron runs once a day, so windows tile exactly. */
export const SUBJECT_ALERT_WINDOW_MS = 24 * 60 * 60_000;

/** One story is not a digest; this is the noise floor. */
export const SUBJECT_ALERT_MIN_STORIES = 3;

/** Upper bound on pushes per run, since topics are global. */
export const SUBJECT_ALERT_MAX_TOPICS = 6;

export interface SubjectGroup {
  /** Follow id, e.g. `topic:politics` or `publisher:awoko`. */
  target: string;
  /** Human label for the message, e.g. "Politics" or "Awoko Newspaper". */
  label: string;
  count: number;
  /** True for a newspaper, false for a category. */
  isPublisher: boolean;
}

interface SubjectArticle {
  sourceUrl: string | null;
  /** Outlet name from the scraper; null for rows imported before the column. */
  publisher: string | null;
  categories: string[];
}

/**
 * Counts articles per follow target and returns the subjects worth alerting.
 *
 * Pure on purpose: the threshold, the cap and the merge of a story's category
 * and publisher targets are the rules most likely to be wrong, and they can be
 * tested without a database.
 */
export function groupSubjectTargets(
  articles: readonly SubjectArticle[]
): SubjectGroup[] {
  const groups = new Map<string, SubjectGroup>();

  const bump = (target: string, label: string, isPublisher: boolean): void => {
    const existing = groups.get(target);
    if (existing) {
      existing.count += 1;
      return;
    }
    groups.set(target, { target, label, count: 1, isPublisher });
  };

  for (const article of articles) {
    for (const name of article.categories) {
      const target = categoryTargetForName(name);
      if (target) bump(target, name.trim(), false);
    }
    // The outlet name the scraper recorded wins: host inference cannot map
    // every feed host to the app's publisher id. Older rows fall back to it.
    const publisher =
      publisherTargetForSource(article.publisher) ??
      publisherTargetForUrl(article.sourceUrl);
    if (publisher) {
      const id = publisher.slice("publisher:".length);
      bump(publisher, publisherNameForId(id) ?? id, true);
    }
  }

  return Array.from(groups.values())
    .filter((group) => group.count >= SUBJECT_ALERT_MIN_STORIES)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, SUBJECT_ALERT_MAX_TOPICS);
}

/** Pushes yesterday's digest. Returns what was attempted, for the cron log. */
export async function broadcastSubjectDigest(
  now: Date = new Date()
): Promise<{
  topics: Array<{ target: string; ok: boolean; count: number }>;
  stories: number;
  skipped?: string;
}> {
  const since = new Date(now.getTime() - SUBJECT_ALERT_WINDOW_MS);
  const rows = await db.article.findMany({
    where: {
      published: true,
      status: Status.PUBLISHED,
      publishedAt: { gte: since },
    },
    select: {
      sourceUrl: true,
      publisher: true,
      categories: { select: { name: true } },
    },
    take: 500,
  });

  const articles: SubjectArticle[] = rows.map((row) => ({
    sourceUrl: row.sourceUrl,
    publisher: row.publisher,
    categories: row.categories.map((category) => category.name),
  }));

  const groups = groupSubjectTargets(articles);
  const topics: Array<{ target: string; ok: boolean; count: number }> = [];
  for (const group of groups) {
    const title = group.isPublisher
      ? `New from ${group.label}`
      : `${group.label} update`;
    const body = `${group.count} new ${
      group.count === 1 ? "story" : "stories"
    } you follow. Tap to read.`;
    const result = await sendPushNotifications(title, body, "/", {
      // The app's history kinds are breaking/team/publisher/score/system;
      // a category digest has no dedicated kind, so it lands as `system`.
      category: group.isPublisher ? "publisher" : "system",
      targets: [group.target],
      skipWebPush: true,
      data: { target: group.target },
    });
    const delivered =
      result.nativeTopics?.find((entry) => entry.ok) !== undefined;
    topics.push({ target: group.target, ok: delivered, count: group.count });
  }

  return {
    topics,
    stories: articles.length,
    ...(topics.length === 0 ? { skipped: "below-threshold" } : {}),
  };
}
