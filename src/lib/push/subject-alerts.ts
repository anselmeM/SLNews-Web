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

/** One story is not a digest; this is the noise floor for categories/wires. */
export const SUBJECT_ALERT_MIN_STORIES = 3;

/**
 * A single story about a followed team or league is the point of following it,
 * so subject tags clear a lower bar than the general news categories.
 */
export const SUBJECT_ALERT_MIN_TEAM_STORIES = 1;

/** Upper bound on pushes per run, since topics are global. */
export const SUBJECT_ALERT_MAX_TOPICS = 6;

export type SubjectKind = "category" | "publisher" | "team";

export interface SubjectGroup {
  /** Follow id, e.g. `topic:politics`, `publisher:awoko` or `team:lal`. */
  target: string;
  /** Human label for the message, e.g. "Politics" or "Awoko Newspaper". */
  label: string;
  count: number;
  kind: SubjectKind;
}

interface SubjectArticle {
  sourceUrl: string | null;
  /** Outlet name from the scraper; null for rows imported before the column. */
  publisher: string | null;
  /** Follow ids the scraper derived for the story (`team:lal`). */
  teams: string[];
  categories: string[];
}

/**
 * Reads a follow id as a label: `team:leone-stars` -> "Leone Stars",
 * `league:spl` -> "SPL".
 *
 * The web app has no team catalogue, so the id is the only source. Short,
 * un-hyphenated slugs are acronyms in this vocabulary (NBA, EPL, SPL, AFCON);
 * longer ones are names.
 */
export function labelForSubject(target: string): string {
  const slug = target.slice(target.indexOf(":") + 1);
  const words = slug.split("-").filter(Boolean);
  if (words.length === 1 && slug.length <= 5) return slug.toUpperCase();
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Counts articles per follow target and returns the subjects worth alerting.
 *
 * Pure on purpose: the thresholds, the cap and the merge of a story's category,
 * publisher and team targets are the rules most likely to be wrong, and they
 * can be tested without a database.
 */
export function groupSubjectTargets(
  articles: readonly SubjectArticle[]
): SubjectGroup[] {
  const groups = new Map<string, SubjectGroup>();

  const bump = (target: string, label: string, kind: SubjectKind): void => {
    const existing = groups.get(target);
    if (existing) {
      existing.count += 1;
      return;
    }
    groups.set(target, { target, label, count: 1, kind });
  };

  for (const article of articles) {
    for (const name of article.categories) {
      const target = categoryTargetForName(name);
      if (target) bump(target, name.trim(), "category");
    }
    // The outlet name the scraper recorded wins: host inference cannot map
    // every feed host to the app's publisher id. Older rows fall back to it.
    const publisher =
      publisherTargetForSource(article.publisher) ??
      publisherTargetForUrl(article.sourceUrl);
    if (publisher) {
      const id = publisher.slice("publisher:".length);
      bump(publisher, publisherNameForId(id) ?? id, "publisher");
    }
    for (const target of article.teams) {
      if (!target.startsWith("team:") && !target.startsWith("league:")) continue;
      bump(target, labelForSubject(target), "team");
    }
  }

  return Array.from(groups.values())
    .filter(
      (group) =>
        group.count >=
        (group.kind === "team"
          ? SUBJECT_ALERT_MIN_TEAM_STORIES
          : SUBJECT_ALERT_MIN_STORIES)
    )
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
      teams: true,
      categories: { select: { name: true } },
    },
    take: 500,
  });

  const articles: SubjectArticle[] = rows.map((row) => ({
    sourceUrl: row.sourceUrl,
    publisher: row.publisher,
    teams: row.teams,
    categories: row.categories.map((category) => category.name),
  }));

  const groups = groupSubjectTargets(articles);

  // One digest per UTC day. The claim is taken only when there is something to
  // send, so a quiet day can be re-evaluated by a later run without sending; a
  // run that already sent returns early instead of pushing the same subjects
  // twice (cron retries and manual trigger are both at-least-once).
  const day = now.toISOString().slice(0, 10);
  if (groups.length > 0) {
    try {
      await db.digestRun.create({ data: { day, topics: groups.length } });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        return { topics: [], stories: articles.length, skipped: "already-ran" };
      }
      throw error;
    }
  }

  const topics: Array<{ target: string; ok: boolean; count: number }> = [];
  for (const group of groups) {
    const title =
      group.kind === "publisher"
        ? `New from ${group.label}`
        : `${group.label} update`;
    const body = `${group.count} new ${
      group.count === 1 ? "story" : "stories"
    } you follow. Tap to read.`;
    const result = await sendPushNotifications(title, body, "/", {
      // The app's history kinds are breaking/team/publisher/score/system; a
      // category digest has no dedicated kind, so it lands as `system`.
      category:
        group.kind === "publisher"
          ? "publisher"
          : group.kind === "team"
            ? "team"
            : "system",
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
