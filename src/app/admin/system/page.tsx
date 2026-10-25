import Link from "next/link";

export const dynamic = "force-dynamic";

type Backfill = {
  filled: number;
  revalidated: number;
  missing_remaining: number;
  stuck_runs: number;
  alert: boolean;
  alert_reason: string | null;
  limits: { missing: number; revalidate: number; reason: string };
  last_run_at: number | null;
};

async function scraperGet(path: string) {
  const key = process.env.SCRAPER_API_KEY ?? process.env.SLNEWS_API_KEY;
  const base =
    process.env.SCRAPER_BASE_URL ?? "https://slnewsapiscapper.onrender.com";
  if (!key) return { error: "SCRAPER_API_KEY is not configured" as const };
  try {
    const response = await fetch(`${base}${path}`, {
      headers: { authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      return { error: `scraper returned ${response.status}` as const };
    return { data: await response.json() };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : ("fetch failed" as const),
    };
  }
}

export default async function SystemPage() {
  const [stats, sources] = await Promise.all([
    scraperGet("/api/stats"),
    scraperGet("/api/stats/sources"),
  ]);
  const backfill: Backfill | undefined = stats.data?.image_backfill;
  const sourceRows: Array<{
    source: string;
    failures: number;
    lastError: string | null;
    skip: boolean;
  }> = sources.data?.sources ?? [];

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/admin/sponsorships" className="text-sm underline">
        ← Sponsorships
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">System health</h1>

      <section className="mt-8">
        <h2 className="text-lg font-medium">Image backfill</h2>
        {backfill ? (
          <div className="mt-2 space-y-1 text-sm">
            {backfill.alert && (
              <p className="rounded bg-red-100 px-3 py-2 text-red-800">
                {backfill.alert_reason}
              </p>
            )}
            <p>Filled: {backfill.filled}</p>
            <p>Revalidated: {backfill.revalidated}</p>
            <p>Missing remaining: {backfill.missing_remaining}</p>
            <p>
              Budgets: {backfill.limits.missing}/{backfill.limits.revalidate} (
              {backfill.limits.reason})
            </p>
            <p>Stuck runs: {backfill.stuck_runs}</p>
            <p>
              Last run:{" "}
              {backfill.last_run_at
                ? new Date(backfill.last_run_at).toLocaleString()
                : "never"}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-gray-600">
            {stats.error ??
              "No backfill snapshot yet (runs after the next cron)."}
          </p>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-medium">Source health</h2>
        {sourceRows.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">
            {sources.error ?? "No source snapshot yet."}
          </p>
        ) : (
          <table className="mt-2 w-full text-left text-sm">
            <thead>
              <tr>
                <th>Source</th>
                <th>Failures</th>
                <th>Backoff</th>
                <th>Last error</th>
              </tr>
            </thead>
            <tbody>
              {sourceRows.map((row) => (
                <tr key={row.source}>
                  <td>{row.source}</td>
                  <td>{row.failures}</td>
                  <td>{row.skip ? "yes" : "no"}</td>
                  <td>{row.lastError ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
