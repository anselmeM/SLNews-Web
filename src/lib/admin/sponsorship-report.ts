import { db } from "@/lib/db";

const DAY_MS = 86_400_000;

export type ReportItem = {
  id: string;
  placement: string;
  adCategory: string | null;
  advertiser: string;
  headline: string;
  active: boolean;
  startsAt: Date;
  endsAt: Date | null;
  impressions: number;
  taps: number;
  ctr: number;
  /**
   * Distinct anonymous installs (`installIdHash`) that saw an impression in the
   * range. Null when no event in the range carries an identifiable reach id
   * (legacy events or app builds without an install id).
   */
  reach: number | null;
  /** impressions / reach. Null when reach is unknown. */
  frequency: number | null;
  daily: Array<{ day: string; impressions: number; taps: number }>;
};

type ReachRow = { sponsorshipId: string; reach: number };

function startOfUtcDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
  );
}

export function parseReportDay(raw: string | null, fallback: Date): Date | null {
  if (!raw) return startOfUtcDay(fallback);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function reportRange(
  rawFrom: string | null,
  rawTo: string | null
): { from: Date; to: Date } | null {
  const from = parseReportDay(rawFrom, new Date(Date.now() - 30 * DAY_MS));
  const to = parseReportDay(rawTo, new Date());
  if (!from || !to || to < from) return null;
  if ((to.getTime() - from.getTime()) / DAY_MS > 366) return null;
  return { from, to };
}

export async function loadSponsorshipReport(
  from: Date,
  to: Date
): Promise<ReportItem[]> {
  // Daily metrics are inclusive of the `to` day; the event range below must use
  // the same convention with an exclusive upper bound.
  const endExclusive = new Date(to.getTime() + DAY_MS);
  const rows = await db.sponsorship.findMany({
    where: { createdAt: { lte: to } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      placement: true,
      adCategory: true,
      advertiser: true,
      headline: true,
      active: true,
      startsAt: true,
      endsAt: true,
      dailyMetrics: {
        where: { day: { gte: from, lte: to } },
        orderBy: { day: "asc" },
        select: { day: true, impressions: true, taps: true },
      },
    },
  });

  // Unique reach per campaign in the same range. Counted in SQL so a report over
  // a busy month does not pull one row per event into the function.
  const reachRows =
    rows.length === 0
      ? []
      : await db.$queryRaw<ReachRow[]>`
          SELECT "sponsorshipId", COUNT(DISTINCT "installIdHash")::int AS reach
          FROM "SponsorshipEvent"
          WHERE "type" = 'impression'
            AND "installIdHash" IS NOT NULL
            AND "createdAt" >= ${from}
            AND "createdAt" < ${endExclusive}
          GROUP BY "sponsorshipId"
        `;
  const reachByCampaign = new Map(
    reachRows.map((row) => [row.sponsorshipId, Number(row.reach)])
  );

  return rows.map((row) => {
    const impressions = row.dailyMetrics.reduce(
      (sum, metric) => sum + metric.impressions,
      0
    );
    const taps = row.dailyMetrics.reduce((sum, metric) => sum + metric.taps, 0);
    const identifiedReach = reachByCampaign.get(row.id) ?? 0;
    const reach = identifiedReach > 0 ? identifiedReach : null;
    return {
      id: row.id,
      placement: row.placement,
      adCategory: row.adCategory,
      advertiser: row.advertiser,
      headline: row.headline,
      active: row.active,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      impressions,
      taps,
      ctr: impressions > 0 ? taps / impressions : 0,
      reach,
      frequency: reach !== null && impressions > 0 ? impressions / reach : null,
      daily: row.dailyMetrics.map((metric) => ({
        day: metric.day.toISOString().slice(0, 10),
        impressions: metric.impressions,
        taps: metric.taps,
      })),
    };
  });
}

function cell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function reportToCsv(items: ReportItem[], from: Date, to: Date): string {
  const lines = [
    "campaign_id,advertiser,placement,ad_category,headline,impressions,taps,ctr_percent,reach,frequency",
    ...items.map((item) =>
      [
        item.id,
        item.advertiser,
        item.placement,
        item.adCategory,
        item.headline,
        item.impressions,
        item.taps,
        (item.ctr * 100).toFixed(2),
        item.reach,
        item.frequency === null ? null : item.frequency.toFixed(2),
      ]
        .map(cell)
        .join(",")
    ),
    "",
    `from,${from.toISOString().slice(0, 10)}`,
    `to,${to.toISOString().slice(0, 10)}`,
  ];
  return lines.join("\n");
}
