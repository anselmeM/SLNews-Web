import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const digestRunCreate = vi.fn();
const mobileDeviceFindMany = vi.fn();
const sendNativePush = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    article: { findMany: (...args: unknown[]) => findMany(...args) },
    digestRun: { create: (...args: unknown[]) => digestRunCreate(...args) },
    mobileDevice: {
      findMany: (...args: unknown[]) => mobileDeviceFindMany(...args),
    },
  },
}));

vi.mock("@/lib/push/fcm", () => ({
  sendNativePush: (...args: unknown[]) => sendNativePush(...args),
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
    mobileDeviceFindMany.mockReset();
    mobileDeviceFindMany.mockResolvedValue([]);
    sendNativePush.mockReset();
    sendNativePush.mockResolvedValue({ sent: 1, failed: 0, invalid: 0 });
  });

  function device(
    userId: string,
    targets: string[],
    prefs: {
      digestCadence?: string;
      quietHoursStart?: number | null;
      quietHoursEnd?: number | null;
      timezoneOffsetMinutes?: number;
    } = {}
  ) {
    return {
      userId,
      user: {
        digestCadence: prefs.digestCadence ?? "daily",
        quietHoursStart: prefs.quietHoursStart ?? null,
        quietHoursEnd: prefs.quietHoursEnd ?? null,
        timezoneOffsetMinutes: prefs.timezoneOffsetMinutes ?? 0,
        mobileFollows: targets.map((targetId) => ({ targetId })),
      },
    };
  }

  function politicsStories() {
    return [
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
    ];
  }

  it("delivers one digest per reader, filtered to the subjects they follow", async () => {
    findMany.mockResolvedValue(politicsStories());
    mobileDeviceFindMany.mockResolvedValue([
      device("reader-1", ["topic:politics"]),
      device("reader-2", ["publisher:awoko"]),
      device("reader-3", ["topic:politics"], { digestCadence: "off" }),
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

    // The opt-out reader is skipped; the other two get only their own subject.
    expect(sendNativePush).toHaveBeenCalledTimes(2);
    const politicsCall = sendNativePush.mock.calls.find(
      (call) =>
        (call[0] as { data?: { target?: string } }).data?.target ===
        "topic:politics"
    );
    expect(politicsCall?.[0]).toMatchObject({ title: "Politics update" });
    expect(politicsCall?.[1]).toEqual({ userIds: ["reader-1"] });
    const awokoCall = sendNativePush.mock.calls.find(
      (call) =>
        (call[0] as { data?: { target?: string } }).data?.target ===
        "publisher:awoko"
    );
    expect(awokoCall?.[0]).toMatchObject({ title: "New from Awoko Newspaper" });
    expect(awokoCall?.[1]).toEqual({ userIds: ["reader-2"] });

    expect(result.topics).toHaveLength(2);
    expect(result.topics).toEqual(
      expect.arrayContaining([
        { target: "topic:politics", ok: true, count: 3 },
        { target: "publisher:awoko", ok: true, count: 3 },
      ])
    );
    expect(result.devices).toMatchObject({
      readers: 3,
      sent: 2,
      skippedCadence: 1,
    });
    expect(digestRunCreate).toHaveBeenCalledWith({
      data: { day: "2026-11-17", topics: 2 },
    });
  });

  it("respects the reader's local quiet-hours window", async () => {
    findMany.mockResolvedValue(politicsStories());
    // 06:30 UTC at +0 is outside 22:00–07:00; at +2 it is 08:30, still outside.
    // The window 06:00–07:00 contains 06:30 for a reader at UTC.
    mobileDeviceFindMany.mockResolvedValue([
      device("quiet-reader", ["topic:politics"], {
        quietHoursStart: 360,
        quietHoursEnd: 420,
      }),
      device("awake-reader", ["topic:politics"]),
    ]);

    const result = await broadcastSubjectDigest(
      new Date("2026-11-17T06:30:00Z")
    );

    expect(sendNativePush).toHaveBeenCalledTimes(1);
    expect(sendNativePush.mock.calls[0]![1]).toEqual({
      userIds: ["awake-reader"],
    });
    expect(result.devices).toMatchObject({ skippedQuiet: 1, sent: 1 });
  });

  it("does not send twice on the same UTC day", async () => {
    findMany.mockResolvedValue(politicsStories());
    digestRunCreate.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" })
    );

    const result = await broadcastSubjectDigest(
      new Date("2026-11-17T06:30:00Z")
    );

    expect(sendNativePush).not.toHaveBeenCalled();
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

    const result = await broadcastSubjectDigest(
      new Date("2026-11-17T06:30:00Z")
    );

    expect(sendNativePush).not.toHaveBeenCalled();
    // Nothing to send: the day stays unclaimed for a later run.
    expect(digestRunCreate).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      topics: [],
      stories: 1,
      skipped: "below-threshold",
    });
  });
});