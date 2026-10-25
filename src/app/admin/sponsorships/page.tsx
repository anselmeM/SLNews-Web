import { redirect } from "next/navigation";
import {
  extendCampaign,
  logout,
  seedDemoCampaign,
  sendTestPush,
  stopCampaign,
} from "./actions";
import { isAdminRequest } from "@/lib/admin/sponsorship-auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function ctr(impressions: number, taps: number): string {
  if (impressions <= 0) return "—";
  return `${((taps / impressions) * 100).toFixed(2)}%`;
}

export default async function SponsorshipsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    created?: string;
    stopped?: string;
    extended?: string;
  }>;
}) {
  if (!(await isAdminRequest())) redirect("/admin/sponsorships/login");
  const flags = await searchParams;
  const [rows, deviceCount] = await Promise.all([
    db.sponsorship.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    db.mobileDevice.count(),
  ]);
  const totals = rows.reduce(
    (acc, row) => {
      acc.impressions += row.impressions;
      acc.taps += row.taps;
      return acc;
    },
    { impressions: 0, taps: 0 }
  );

  return (
    <main className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Sponsorships</h1>
        <div className="flex items-center gap-2">
          <form action={sendTestPush}>
            <button className="rounded-lg border border-outline-variant/40 px-3 py-1.5">
              Send test push
            </button>
          </form>
          <form action={seedDemoCampaign}>
            <button className="rounded-lg border border-outline-variant/40 px-3 py-1.5">
              Seed demo campaign
            </button>
          </form>
          <a
            className="rounded-lg bg-black px-3 py-1.5 text-white"
            href="/admin/sponsorships/new"
          >
            New campaign
          </a>
          <form action={logout}>
            <button className="rounded-lg border border-outline-variant/40 px-3 py-1.5">
              Sign out
            </button>
          </form>
        </div>
      </div>

      {flags.created ? (
        <p className="rounded-lg bg-emerald-50 p-2 text-emerald-800">
          Campaign saved.
        </p>
      ) : null}
      {flags.stopped ? (
        <p className="rounded-lg bg-amber-50 p-2 text-amber-800">
          Campaign stopped.
        </p>
      ) : null}
      {flags.extended ? (
        <p className="rounded-lg bg-emerald-50 p-2 text-emerald-800">
          Campaign extended by 7 days.
        </p>
      ) : null}

      <p className="text-xs text-on-surface-variant">
        Total: {totals.impressions} impressions · {totals.taps} taps · CTR{" "}
        {ctr(totals.impressions, totals.taps)} · {deviceCount} device
        {deviceCount === 1 ? "" : "s"} registered for push
      </p>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-outline-variant/30 p-6 text-on-surface-variant">
          No campaigns yet. Use <strong>Seed demo campaign</strong> to try the
          whole loop in the browser, then install the app to see it render.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-outline-variant/30">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-surface-container-low">
              <tr>
                <th className="p-2">Advertiser</th>
                <th className="p-2">Placement</th>
                <th className="p-2">Headline</th>
                <th className="p-2">Active</th>
                <th className="p-2">Window</th>
                <th className="p-2">Impr.</th>
                <th className="p-2">Taps</th>
                <th className="p-2">CTR</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-outline-variant/20">
                  <td className="p-2">{row.advertiser}</td>
                  <td className="p-2">{row.placement}</td>
                  <td className="p-2">{row.headline}</td>
                  <td className="p-2">{row.active ? "yes" : "no"}</td>
                  <td className="p-2">
                    {row.startsAt.toISOString().slice(0, 10)} →{" "}
                    {row.endsAt
                      ? row.endsAt.toISOString().slice(0, 10)
                      : "open"}
                  </td>
                  <td className="p-2">{row.impressions}</td>
                  <td className="p-2">{row.taps}</td>
                  <td className="p-2">{ctr(row.impressions, row.taps)}</td>
                  <td className="p-2">
                    <div className="flex gap-2">
                      <form action={stopCampaign}>
                        <input type="hidden" name="id" value={row.id} />
                        <button className="rounded border border-outline-variant/40 px-2 py-1">
                          Stop
                        </button>
                      </form>
                      <form action={extendCampaign}>
                        <input type="hidden" name="id" value={row.id} />
                        <input type="hidden" name="days" value="7" />
                        <button className="rounded border border-outline-variant/40 px-2 py-1">
                          +7d
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-on-surface-variant">
        The table is the same data the customer report uses: impressions and
        taps come from the app&apos;s event endpoint, CTR is computed here.
      </p>
    </main>
  );
}
