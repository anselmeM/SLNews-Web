import Link from "next/link";
import {
  archiveCampaign,
  duplicateCampaign,
  extendCampaign,
  logout,
  reactivateCampaign,
  seedDemoCampaign,
  sendTestPush,
  stopCampaign,
} from "./actions";
import { ConfirmSubmit } from "./confirm-submit";
import { requireAdminPage } from "@/lib/admin/require-admin-page";
import {
  sponsorshipStatus,
  STATUS_LABEL,
} from "@/lib/admin/sponsorship-status";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function ctr(impressions: number, taps: number): string {
  if (impressions <= 0) return "—";
  return `${((taps / impressions) * 100).toFixed(2)}%`;
}

function day(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : "open";
}

export default async function SponsorshipsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    created?: string;
    stopped?: string;
    extended?: string;
    reactivated?: string;
    extendBlocked?: string;
    reactivateFailed?: string;
    updated?: string;
    duplicated?: string;
    archived?: string;
    updateFailed?: string;
    duplicateFailed?: string;
    view?: string;
  }>;
}) {
  await requireAdminPage();
  const flags = await searchParams;
  const showingArchived = flags.view === "archived";
  const [rows, deviceCount] = await Promise.all([
    db.sponsorship.findMany({
      where: showingArchived
        ? { archivedAt: { not: null } }
        : { archivedAt: null },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
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
        <div className="flex flex-wrap items-center gap-2">
          <form action={sendTestPush}>
            <ConfirmSubmit
              className="rounded-lg border border-outline-variant/40 px-3 py-1.5"
              message="Send a real test notification to every registered device?"
            >
              Send test push
            </ConfirmSubmit>
          </form>
          <form action={seedDemoCampaign}>
            <ConfirmSubmit
              className="rounded-lg border border-outline-variant/40 px-3 py-1.5"
              message="Insert a demo campaign into the live inventory?"
            >
              Seed demo campaign
            </ConfirmSubmit>
          </form>
          <Link
            className="rounded-lg border border-outline-variant/40 px-3 py-1.5"
            href="/admin/sponsorships/report"
          >
            Report
          </Link>
          <Link
            className="rounded-lg border border-outline-variant/40 px-3 py-1.5"
            href="/admin/system"
          >
            System
          </Link>
          <Link
            className="rounded-lg bg-black px-3 py-1.5 text-white"
            href="/admin/sponsorships/new"
          >
            New campaign
          </Link>
          <form action={logout}>
            <button className="rounded-lg border border-outline-variant/40 px-3 py-1.5">
              Sign out
            </button>
          </form>
        </div>
      </div>

      {[
        [flags.created, "Campaign saved."],
        [flags.updated, "Campaign updated."],
        [flags.duplicated, "Campaign duplicated as a paused draft."],
        [flags.stopped, "Campaign stopped."],
        [flags.extended, "Campaign extended."],
        [flags.reactivated, "Campaign reactivated."],
        [flags.archived, "Campaign archived."],
      ]
        .filter(([flag]) => Boolean(flag))
        .map(([, message]) => (
          <p
            key={message}
            className="rounded-lg bg-emerald-50 p-2 text-emerald-800"
          >
            {message}
          </p>
        ))}

      {flags.extendBlocked ? (
        <p className="rounded-lg bg-amber-50 p-2 text-amber-800">
          Only a live, unexpired campaign can be extended. Use Reactivate for a
          stopped or expired campaign.
        </p>
      ) : null}
      {flags.reactivateFailed ? (
        <p className="rounded-lg bg-amber-50 p-2 text-amber-800">
          That campaign no longer exists or has been archived.
        </p>
      ) : null}
      {flags.updateFailed ? (
        <p className="rounded-lg bg-amber-50 p-2 text-amber-800">
          Could not update that campaign.
        </p>
      ) : null}
      {flags.duplicateFailed ? (
        <p className="rounded-lg bg-amber-50 p-2 text-amber-800">
          Could not duplicate that campaign.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-on-surface-variant">
        <p>
          Total: {totals.impressions} impressions · {totals.taps} taps · CTR{" "}
          {ctr(totals.impressions, totals.taps)} · {deviceCount} device
          {deviceCount === 1 ? "" : "s"} registered for push
        </p>
        <Link
          className="underline"
          href={
            showingArchived
              ? "/admin/sponsorships"
              : "/admin/sponsorships?view=archived"
          }
        >
          {showingArchived ? "Show active campaigns" : "Show archived"}
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-outline-variant/30 p-6 text-on-surface-variant">
          No campaigns yet. Use <strong>New campaign</strong> to create a
          sponsored placement.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-outline-variant/30">
          <table
            aria-label="Sponsorship campaigns"
            className="min-w-full text-left text-xs"
          >
            <caption className="sr-only">
              Campaign status, delivery and actions
            </caption>
            <thead className="bg-surface-container-low">
              <tr>
                <th className="p-2">Status</th>
                <th className="p-2">Advertiser</th>
                <th className="p-2">Category</th>
                <th className="p-2">Placement</th>
                <th className="p-2">Headline</th>
                <th className="p-2">Window</th>
                <th className="p-2">Priority / caps</th>
                <th className="p-2">Impr.</th>
                <th className="p-2">Taps</th>
                <th className="p-2">CTR</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const status = sponsorshipStatus(row);
                return (
                  <tr
                    key={row.id}
                    className="border-t border-outline-variant/20"
                  >
                    <td className="p-2">
                      <span className="rounded-full bg-surface-container-high px-2 py-0.5">
                        {STATUS_LABEL[status]}
                      </span>
                    </td>
                    <td className="p-2">{row.advertiser}</td>
                    <td className="p-2">{row.adCategory ?? "—"}</td>
                    <td className="p-2">{row.placement}</td>
                    <td className="p-2">{row.headline}</td>
                    <td className="p-2">
                      {day(row.startsAt)} → {day(row.endsAt)}
                    </td>
                    <td className="p-2">
                      {row.priority}
                      {row.maxImpressions ? ` · max ${row.maxImpressions}` : ""}
                      {row.dailyImpressionCap
                        ? ` · ${row.dailyImpressionCap}/day`
                        : ""}
                    </td>
                    <td className="p-2">{row.impressions}</td>
                    <td className="p-2">{row.taps}</td>
                    <td className="p-2">{ctr(row.impressions, row.taps)}</td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">
                        {row.archivedAt === null ? (
                          <>
                            <Link
                              className="rounded border border-outline-variant/40 px-2 py-1"
                              href={`/admin/sponsorships/${row.id}/edit`}
                            >
                              Edit
                            </Link>
                            <form action={duplicateCampaign}>
                              <input type="hidden" name="id" value={row.id} />
                              <button className="rounded border border-outline-variant/40 px-2 py-1">
                                Duplicate
                              </button>
                            </form>
                            {row.active && status !== "expired" ? (
                              <>
                                <form action={stopCampaign}>
                                  <input
                                    type="hidden"
                                    name="id"
                                    value={row.id}
                                  />
                                  <ConfirmSubmit
                                    className="rounded border border-outline-variant/40 px-2 py-1"
                                    message="Stop serving this campaign now?"
                                  >
                                    Stop
                                  </ConfirmSubmit>
                                </form>
                                <form action={extendCampaign}>
                                  <input
                                    type="hidden"
                                    name="id"
                                    value={row.id}
                                  />
                                  <input type="hidden" name="days" value="7" />
                                  <button className="rounded border border-outline-variant/40 px-2 py-1">
                                    +7d
                                  </button>
                                </form>
                              </>
                            ) : (
                              <form action={reactivateCampaign}>
                                <input type="hidden" name="id" value={row.id} />
                                <button className="rounded border border-outline-variant/40 px-2 py-1">
                                  Reactivate
                                </button>
                              </form>
                            )}
                            <form action={archiveCampaign}>
                              <input type="hidden" name="id" value={row.id} />
                              <ConfirmSubmit
                                className="rounded border border-outline-variant/40 px-2 py-1"
                                message="Archive this campaign? It disappears from the app and default list; counters are kept."
                              >
                                Archive
                              </ConfirmSubmit>
                            </form>
                          </>
                        ) : (
                          <span className="text-on-surface-variant">
                            Archived
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-on-surface-variant">
        Impressions count every viewable card rendering the app reports, not once
        per session. Taps count successful sponsor landing-page opens. See the
        report page for date-bounded reach, frequency and the invoice view.
      </p>
    </main>
  );
}
