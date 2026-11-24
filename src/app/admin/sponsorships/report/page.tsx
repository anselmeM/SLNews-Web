import Link from "next/link";
import { requireAdminPage } from "@/lib/admin/require-admin-page";
import {
  loadSponsorshipReport,
  reportRange,
} from "@/lib/admin/sponsorship-report";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function money(value: number): string {
  return `$${value.toLocaleString("en-US")}`;
}

export default async function SponsorshipReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireAdminPage();
  const params = await searchParams;
  const range =
    reportRange(params.from ?? null, params.to ?? null) ??
    reportRange(null, null)!;
  const [items, audit] = await Promise.all([
    loadSponsorshipReport(range.from, range.to),
    db.adminAuditLog.findMany({ orderBy: { createdAt: "desc" }, take: 12 }),
  ]);
  const totalImpressions = items.reduce(
    (sum, item) => sum + item.impressions,
    0
  );
  const totalTaps = items.reduce((sum, item) => sum + item.taps, 0);
  // Reach is per campaign and an install can appear in several campaigns, so the
  // dashboard total is a sum of campaign reach, not a de-duplicated audience.
  const totalReach = items.reduce((sum, item) => sum + (item.reach ?? 0), 0);
  const totalFrequency =
    totalReach > 0 && totalImpressions > 0
      ? totalImpressions / totalReach
      : null;
  const fromValue = range.from.toISOString().slice(0, 10);
  const toValue = range.to.toISOString().slice(0, 10);

  return (
    <main className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin/sponsorships" className="text-xs underline">
            ← Sponsorships
          </Link>
          <h1 className="mt-2 text-xl font-bold">Delivery report</h1>
        </div>
        <Link
          className="rounded-lg bg-black px-3 py-1.5 text-white"
          href={`/admin/sponsorships/report/export?from=${fromValue}&to=${toValue}`}
        >
          Download CSV
        </Link>
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-2xl border border-outline-variant/30 p-4">
        <label className="text-xs font-semibold">
          From
          <input
            className="mt-1 block rounded-lg border px-3 py-2"
            type="date"
            name="from"
            defaultValue={fromValue}
          />
        </label>
        <label className="text-xs font-semibold">
          To
          <input
            className="mt-1 block rounded-lg border px-3 py-2"
            type="date"
            name="to"
            defaultValue={toValue}
          />
        </label>
        <button className="rounded-lg border px-3 py-2 text-xs" type="submit">
          Apply range
        </button>
      </form>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-2xl border border-outline-variant/30 p-4">
          <p className="text-xs uppercase text-on-surface-variant">
            Impressions
          </p>
          <p className="text-2xl font-bold">{money(totalImpressions)}</p>
        </div>
        <div className="rounded-2xl border border-outline-variant/30 p-4">
          <p className="text-xs uppercase text-on-surface-variant">
            Reach (Σ campaigns)
          </p>
          <p className="text-2xl font-bold">
            {totalReach > 0 ? money(totalReach) : "—"}
          </p>
          <p className="text-[10px] text-on-surface-variant">
            Distinct anonymous installs per campaign
          </p>
        </div>
        <div className="rounded-2xl border border-outline-variant/30 p-4">
          <p className="text-xs uppercase text-on-surface-variant">
            Frequency
          </p>
          <p className="text-2xl font-bold">
            {totalFrequency === null ? "—" : totalFrequency.toFixed(2)}
          </p>
          <p className="text-[10px] text-on-surface-variant">
            Impressions ÷ reach
          </p>
        </div>
        <div className="rounded-2xl border border-outline-variant/30 p-4">
          <p className="text-xs uppercase text-on-surface-variant">Taps</p>
          <p className="text-2xl font-bold">{money(totalTaps)}</p>
        </div>
        <div className="rounded-2xl border border-outline-variant/30 p-4">
          <p className="text-xs uppercase text-on-surface-variant">CTR</p>
          <p className="text-2xl font-bold">
            {totalImpressions > 0
              ? `${((totalTaps / totalImpressions) * 100).toFixed(2)}%`
              : "—"}
          </p>
        </div>
      </section>

      <div className="overflow-x-auto rounded-2xl border border-outline-variant/30">
        <table
          aria-label="Sponsorship delivery by campaign"
          className="min-w-full text-left text-xs"
        >
          <caption className="sr-only">
            Impressions, reach, frequency, taps and CTR for the selected date
            range
          </caption>
          <thead className="bg-surface-container-low">
            <tr>
              <th className="p-2">Advertiser</th>
              <th className="p-2">Category</th>
              <th className="p-2">Placement</th>
              <th className="p-2">Impr.</th>
              <th className="p-2">Reach</th>
              <th className="p-2">Freq.</th>
              <th className="p-2">Taps</th>
              <th className="p-2">CTR</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t border-outline-variant/20">
                <td className="p-2 font-medium">{item.advertiser}</td>
                <td className="p-2">{item.adCategory ?? "—"}</td>
                <td className="p-2">{item.placement}</td>
                <td className="p-2">{item.impressions}</td>
                <td className="p-2">{item.reach ?? "—"}</td>
                <td className="p-2">
                  {item.frequency === null ? "—" : item.frequency.toFixed(2)}
                </td>
                <td className="p-2">{item.taps}</td>
                <td className="p-2">
                  {item.impressions > 0
                    ? `${(item.ctr * 100).toFixed(2)}%`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-on-surface-variant">
        Report basis: every viewable impression and successful landing-page tap
        recorded by the app, deduplicated per event id. Reach counts distinct
        anonymous installs (hashed), so a campaign with no identified reach
        shows “—” and frequency is blank. Figures are planning and invoice
        inputs, not audited third-party measurement.
      </p>

      {audit.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-bold">Recent admin activity</h2>
          <ul className="space-y-1 text-xs text-on-surface-variant">
            {audit.map((entry) => (
              <li key={entry.id}>
                {entry.createdAt.toISOString().slice(0, 16).replace("T", " ")} ·{" "}
                {entry.action}
                {entry.targetId ? ` · ${entry.targetId}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
