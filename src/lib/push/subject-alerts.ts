/**
 * Daily follow digest: one message per reader, built from the subjects they
 * follow.
 *
 * This used to publish to per-subject FCM topics, which reached exactly the
 * followers of a subject without the server knowing who they were. Reader-level
 * quiet hours and digest opt-out cannot be honoured inside a topic broadcast, so
 * delivery now fans out per reader using their registered devices and follows.
 * The trade is scale for control: the send is capped by `DIGEST_DEVICE_LIMIT`.
 *
 * Rules, all of them deliberate:
 *
 * - **Once a day.** The sync cron runs daily at 06:30, so the window is the
 *   previous 24 hours and the windows tile instead of overlapping (a shorter
 *   window would either miss stories or alert the same ones twice).
 * - **At least three stories.** One story is not a digest, and a push per story
 *   per subject would be spam; busy subjects earn the alert.
 * - **At most six subjects per run.** Every reader gets at most one digest, and
 *   only for subjects they actually follow.
 * - **Reader settings win.** `digestCadence = "off"` skips the reader entirely;
 *   a quiet-hours window in their local time skips them too.
 */

const DIGEST_DEVICE_LIMIT = 5_000;

import { Status } from "@prisma/client";
import { db } from "@/lib/db";
import { sendNativePush, type NativeMessage } from "@/lib/push/fcm";
import { isWithinQuietHours } from "@/lib/push/quiet-hours";
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
  devices: {
    readers: number;
    sent: number;
    failed: number;
    skippedCadence: number;
    skippedQuiet: number;
    skippedNoMatch: number;
  };
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
        return {
          topics: [],
          stories: articles.length,
          devices: {
            readers: 0,
            sent: 0,
            failed: 0,
            skippedCadence: 0,
            skippedQuiet: 0,
            skippedNoMatch: 0,
          },
          skipped: "already-ran",
        };
      }
      throw error;
    }
  }

  const topics: Array<{ target: string; ok: boolean; count: number }> = [];
  const deviceRows = await db.mobileDevice.findMany({
    select: {
      userId: true,
      user: {
        select: {
          digestCadence: true,
          quietHoursStart: true,
          quietHoursEnd: true,
          timezoneOffsetMinutes: true,
          mobileFollows: {
            where: { deletedAt: null },
            select: { targetId: true },
          },
        },
      },
    },
    take: DIGEST_DEVICE_LIMIT,
  });

  // One delivery decision per reader, even when they have several devices. The
  // reader's follows decide which of today's subjects are relevant to them, and
  // their quiet-hours window decides whether now is an acceptable time.
  const readers = new Map<
    string,
    {
      userId: string;
      prefs: (typeof deviceRows)[number]["user"];
      targets: Set<string>;
    }
  >();
  for (const row of deviceRows) {
    if (readers.has(row.userId)) continue;
    readers.set(row.userId, {
      userId: row.userId,
      prefs: row.user,
      targets: new Set(row.user.mobileFollows.map((follow) => follow.targetId)),
    });
  }

  const stats = {
    readers: readers.size,
    sent: 0,
    failed: 0,
    skippedCadence: 0,
    skippedQuiet: 0,
    skippedNoMatch: 0,
  };
  const deliveredTargets = new Set<string>();
  const queue = [...readers.values()];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const reader = queue.shift();
      if (!reader) return;
      if (reader.prefs.digestCadence !== "daily") {
        stats.skippedCadence++;
        continue;
      }
      if (
        isWithinQuietHours(
          now,
          reader.prefs.timezoneOffsetMinutes,
          reader.prefs.quietHoursStart,
          reader.prefs.quietHoursEnd
        )
      ) {
        stats.skippedQuiet++;
        continue;
      }
      const matching = groups.filter((group) =>
        reader.targets.has(group.target)
      );
      if (matching.length === 0) {
        stats.skippedNoMatch++;
        continue;
      }
      try {
        const result = await sendNativePush(digestMessage(matching), {
          userIds: [reader.userId],
        });
        stats.sent += result.sent;
        stats.failed += result.failed;
        if (result.sent > 0) {
          for (const group of matching) deliveredTargets.add(group.target);
        }
      } catch (error) {
        // One reader's delivery failure must not abort the rest of the digest.
        stats.failed++;
        console.warn(
          `digest: delivery failed for ${reader.userId}: ${
            error instanceof Error ? error.message : "unknown error"
          }`
        );
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(5, queue.length) }, () => worker())
  );

  for (const group of groups) {
    topics.push({
      target: group.target,
      ok: deliveredTargets.has(group.target),
      count: group.count,
    });
  }

  return {
    topics,
    stories: articles.length,
    devices: stats,
    ...(topics.length === 0 ? { skipped: "below-threshold" } : {}),
  };
}

/** Builds the per-reader digest message from the subjects they follow. */
function digestMessage(groups: readonly SubjectGroup[]): NativeMessage {
  if (groups.length === 1) {
    const group = groups[0];
    if (!group) {
      return {
        title: "Your daily briefing",
        body: "Tap to read.",
        url: "/",
        category: "system",
      };
    }
    return {
      title:
        group.kind === "publisher"
          ? `New from ${group.label}`
          : `${group.label} update`,
      body: `${group.count} new ${
        group.count === 1 ? "story" : "stories"
      } you follow. Tap to read.`,
      url: "/",
      // The app's history kinds are breaking/team/publisher/score/system; a
      // category digest has no dedicated kind, so it lands as `system`.
      category:
        group.kind === "publisher"
          ? "publisher"
          : group.kind === "team"
            ? "team"
            : "system",
      data: { target: group.target },
    };
  }

  const labels = groups.slice(0, 3).map((group) => group.label);
  const extra = groups.length > labels.length ? ` +${groups.length - labels.length} more` : "";
  const first = groups[0];
  if (!first) {
    return {
      title: "Your daily briefing",
      body: "Tap to read.",
      url: "/",
      category: "system",
    };
  }
  return {
    title: "Your daily briefing",
    body: `${groups.length} followed topics updated: ${labels.join(", ")}${extra}. Tap to read.`,
    url: "/",
    category: "system",
    data: {
      target: first.target,
      targets: groups.map((group) => group.target).join(","),
    },
  };
}
