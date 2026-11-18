import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const digestRunCreate = vi.fn();
const sendPushNotifications = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    article: { findMany: (...args: unknown[]) => findMany(...args) },
    digestRun: { create: (...args: unknown[]) => digestRunCreate(...args) },
  },
}));

vi.mock("@/app/actions/push-actions", () => ({
  sendPushNotifications: (...args: unknown[]) => sendPushNotifications(...args),
}));

const {
  broadcastSubjectDigest,
  groupSubjectTargets,
  labelForSubject,
  SUBJECT_ALERT_MAX_TOPICS,
  SUBJECT_ALERT_MIN_STORIES,
  SUBJECT_ALERT_WINDOW_MS,
} = await import("../subject-alerts");

function article(
  sourceUrl: string | null,
  ...categories: string[]
): {
  sourceUrl: string | null;
  publisher: string | null;
  teams: string[];
  categories: string[];
} {
  return { sourceUrl, publisher: null, teams: [], categories };
}

function teamArticle(teams: string[], ...categories: string[]) {
  return { sourceUrl: null, publisher: null, teams, categories };
}

function sourcedArticle(
  publisher: string,
  sourceUrl: string | null,
  ...categories: string[]
) {
  return { sourceUrl, publisher, teams: [], categories };
}

describe("groupSubjectTargets", () => {
  it("counts a story against both its category and its publisher", () => {
    const groups = groupSubjectTargets([
      article("https://awoko.org/1", "Politics"),
      article("https://awoko.org/2", "Politics"),
      article("https://awoko.org/3", "Politics"),
    ]);

    const politics = groups.find((group) => group.target === "topic:politics");
    const awoko = groups.find((group) => group.target === "publisher:awoko");
    expect(politics).toMatchObject({ count: 3, kind: "category" });
    expect(awoko).toMatchObject({
      count: 3,
      kind: "publisher",
      label: "Awoko Newspaper",
    });
  });

  it(`drops subjects below the ${SUBJECT_ALERT_MIN_STORIES}-story floor`, () => {
    expect(
      groupSubjectTargets([
        article("https://awoko.org/1", "Politics"),
        article("https://awoko.org/2", "Politics"),
      ])
    ).toEqual([]);
  });

  it("ignores unknown hosts and empty categories", () => {
    expect(
      groupSubjectTargets([
        article("https://example.com/1", "Business"),
        article("https://example.com/2", "Business"),
        article("https://example.com/3", "Business"),
      ]).map((group) => group.target)
    ).toEqual(["topic:business"]);
  });

  it("prefers the scraper's outlet name over the URL host", () => {
    // The scraper's Concord Times feed host is sierraleoneconcordtimes.com,
    // which the app's registry (concordtimes.net) cannot resolve; the name can.
    const groups = groupSubjectTargets([
      sourcedArticle("Concord Times", "https://sierraleoneconcordtimes.com/1", "Politics"),
      sourcedArticle("Concord Times", "https://sierraleoneconcordtimes.com/2", "Politics"),
      sourcedArticle("Concord Times", "https://sierraleoneconcordtimes.com/3", "Politics"),
    ]);

    expect(groups.map((group) => group.target)).toContain(
      "publisher:concordtimes"
    );
  });

  it("falls back to the host when a row predates the source column", () => {
    const groups = groupSubjectTargets([
      article("https://awoko.org/1", "Politics"),
      article("https://awoko.org/2", "Politics"),
      article("https://awoko.org/3", "Politics"),
    ]);

    expect(groups.map((group) => group.target)).toContain("publisher:awoko");
  });

  it("never groups the home feed's Top stories", () => {
    expect(
      groupSubjectTargets([
        article("https://example.com/1", "Top stories"),
        article("https://example.com/2", "Top stories"),
        article("https://example.com/3", "Top stories"),
      ])
    ).toEqual([]);
  });

  it("alerts on a single story about a followed team", () => {
    // Teams clear a lower bar than categories: one story about Bo Rangers is
    // exactly what a follower wants to hear about.
    expect(groupSubjectTargets([teamArticle(["team:bo-rangers"])])).toEqual([
      {
        target: "team:bo-rangers",
        label: "Bo Rangers",
        count: 1,
        kind: "team",
      },
    ]);
  });

  it("labels team and league ids for the message copy", () => {
    expect(labelForSubject("team:leone-stars")).toBe("Leone Stars");
    expect(labelForSubject("league:spl")).toBe("SPL");
    expect(labelForSubject("league:la-liga")).toBe("La Liga");
    expect(labelForSubject("team:lal")).toBe("LAL");
  });

  it("ignores tags outside the team and league namespaces", () => {
    expect(groupSubjectTargets([teamArticle(["topic:politics"])])).toEqual([]);
    expect(groupSubjectTargets([teamArticle(["publisher:awoko"])])).toEqual([]);
  });

  it(`caps a run at ${SUBJECT_ALERT_MAX_TOPICS} subjects, busiest first`, () => {
    const subjects = ["Politics", "Business", "Sports", "Tech", "Health", "Mining", "World"];
    const groups = groupSubjectTargets(
      subjects.flatMap((subject, index) =>
        Array.from({ length: index + 3 }, () =>
          article("https://example.com/x", subject)
        )
      )
    );

    expect(groups).toHaveLength(SUBJECT_ALERT_MAX_TOPICS);
    // The subject with the most stories leads.
    const [first] = groups;
    expect(first?.label).toBe("World");
    expect(first?.count).toBe(9);
  });
});

describe("broadcastSubjectDigest", () => {
  beforeEach(() => {
    findMany.mockReset();
    digestRunCreate.mockReset();
    digestRunCreate.mockResolvedValue({});
    sendPushNotifications.mockReset();
    sendPushNotifications.mockResolvedValue({
      sent: 0,
      nativeTopics: [{ topic: "slnews_topic_politics", ok: true }],
    });
  });

  it("queries the last 24 hours and pushes one alert per subject topic", async () => {
    findMany.mockResolvedValue([
      {
        sourceUrl: "https://awoko.org/1",
        publisher: null,
        teams: [],
        categories: [{ name: "Politics" }],
      },
      {
        sourceUrl: "https://awoko.org/2",
        publisher: null,
        teams: [],
        categories: [{ name: "Politics" }],
      },
      {
        sourceUrl: "https://awoko.org/3",
        publisher: null,
        teams: [],
        categories: [{ name: "Politics" }],
      },
    ]);

    const result = await broadcastSubjectDigest(
      new Date("2026-11-17T06:30:00Z")
    );

    const where = findMany.mock.calls[0]![0].where;
    expect(where.publishedAt.gte.toISOString()).toBe(
      new Date(
        new Date("2026-11-17T06:30:00Z").getTime() - SUBJECT_ALERT_WINDOW_MS
      ).toISOString()
    );

    expect(sendPushNotifications).toHaveBeenCalledTimes(2);
    const targets = sendPushNotifications.mock.calls.map(
      (call) => (call[3] as { targets: string[] }).targets
    );
    expect(targets).toContainEqual(["topic:politics"]);
    expect(targets).toContainEqual(["publisher:awoko"]);

    // Targeted alerts must not fan out to browser subscriptions, which carry no
    // follow information, and must use kinds the app's history understands.
    for (const call of sendPushNotifications.mock.calls) {
      const options = call[3] as { skipWebPush?: boolean; category?: string };
      expect(options.skipWebPush).toBe(true);
      expect(["publisher", "system"]).toContain(options.category);
    }
    expect(result.topics).toHaveLength(2);
    expect(result.stories).toBe(3);
    // The day is claimed before sending, so a retry cannot repeat it.
    expect(digestRunCreate).toHaveBeenCalledWith({
      data: { day: "2026-11-17", topics: 2 },
    });
  });

  it("does not send twice on the same UTC day", async () => {
    findMany.mockResolvedValue([
      {
        sourceUrl: "https://awoko.org/1",
        publisher: null,
        teams: [],
        categories: [{ name: "Politics" }],
      },
      {
        sourceUrl: "https://awoko.org/2",
        publisher: null,
        teams: [],
        categories: [{ name: "Politics" }],
      },
      {
        sourceUrl: "https://awoko.org/3",
        publisher: null,
        teams: [],
        categories: [{ name: "Politics" }],
      },
    ]);
    digestRunCreate.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" })
    );

    const result = await broadcastSubjectDigest(
      new Date("2026-11-17T06:30:00Z")
    );

    expect(sendPushNotifications).not.toHaveBeenCalled();
    expect(result).toMatchObject({ topics: [], skipped: "already-ran" });
  });

  it("reports a below-threshold run without pushing", async () => {
    findMany.mockResolvedValue([
      {
        sourceUrl: "https://awoko.org/1",
        publisher: null,
        teams: [],
        categories: [{ name: "Politics" }],
      },
    ]);

    const result = await broadcastSubjectDigest(new Date("2026-11-17T06:30:00Z"));

    expect(sendPushNotifications).not.toHaveBeenCalled();
    // Nothing to send: the day stays unclaimed for a later run.
    expect(digestRunCreate).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      topics: [],
      stories: 1,
      skipped: "below-threshold",
    });
  });
});
