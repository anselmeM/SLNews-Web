import { CampaignForm } from "./campaign-form";
import { requireAdminPage } from "@/lib/admin/require-admin-page";

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdminPage();
  const { error } = await searchParams;
  return (
    <main className="space-y-4">
      <h1 className="text-xl font-bold">New campaign</h1>
      {error ? (
        <p className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>
      ) : null}
      <CampaignForm />
    </main>
  );
}
