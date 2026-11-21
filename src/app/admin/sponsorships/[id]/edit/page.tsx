import { redirect } from "next/navigation";
import { CampaignForm } from "../../new/campaign-form";
import { requireAdminPage } from "@/lib/admin/require-admin-page";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function localInput(value: Date | null): string {
  return value ? value.toISOString().slice(0, 16) : "";
}

export default async function EditCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdminPage();
  const { id } = await params;
  const { error } = await searchParams;
  const row = await db.sponsorship.findUnique({ where: { id } });
  if (!row || row.archivedAt !== null) {
    redirect("/admin/sponsorships?updateFailed=1");
  }

  return (
    <main className="space-y-4">
      <h1 className="text-xl font-bold">Edit campaign</h1>
      {error ? (
        <p className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>
      ) : null}
      <CampaignForm
        mode="edit"
        campaignId={row.id}
        initial={{
          placement: row.placement,
          advertiser: row.advertiser,
          headline: row.headline,
          body: row.body,
          ctaLabel: row.ctaLabel,
          ctaUrl: row.ctaUrl,
          brandHex: row.brandHex,
          brandAccentHex: row.brandAccentHex,
          assetLabel: row.assetLabel ?? "",
          disclosure: row.disclosure ?? "",
          imageUrl: row.imageUrl ?? "",
          altText: row.altText ?? "",
          priority: String(row.priority),
          weight: String(row.weight),
          maxImpressions: row.maxImpressions?.toString() ?? "",
          dailyImpressionCap: row.dailyImpressionCap?.toString() ?? "",
          startsAt: localInput(row.startsAt),
          endsAt: localInput(row.endsAt),
        }}
      />
    </main>
  );
}
