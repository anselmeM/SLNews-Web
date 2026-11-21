import { db } from "@/lib/db";

const DAY_MS = 86_400_000;

export type ReportItem = {
  id: string;
  placement: string;
  advertiser: string;
  headline: string;
  active: boolean;
  startsAt: Date;
  endsAt: Date | null;
  impressions: number;
  taps: number;
  ctr: number;
  daily: Array<{ day: string; impressions: number; taps: number }>;
};

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
  const rows = await db.sponsorship.findMany({
    where: { createdAt: { lte: to } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      placement: true,
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

  return rows.map((row) => {
    const impressions = row.dailyMetrics.reduce(
      (sum, metric) => sum + metric.impressions,
      0
    );
    const taps = row.dailyMetrics.reduce((sum, metric) => sum + metric.taps, 0);
    return {
      id: row.id,
      placement: row.placement,
      advertiser: row.advertiser,
      headline: row.headline,
      active: row.active,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      impressions,
      taps,
      ctr: impressions > 0 ? taps / impressions : 0,
      daily: row.dailyMetrics.map((metric) => ({
        day: metric.day.toISOString().slice(0, 10),
        impressions: metric.impressions,
        taps: metric.taps,
      })),
    };
  });
}

function cell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function reportToCsv(items: ReportItem[], from: Date, to: Date): string {
  const lines = [
    "campaign_id,advertiser,placement,headline,impressions,taps,ctr_percent",
    ...items.map((item) =>
      [
        item.id,
        item.advertiser,
        item.placement,
        item.headline,
        item.impressions,
        item.taps,
        (item.ctr * 100).toFixed(2),
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
