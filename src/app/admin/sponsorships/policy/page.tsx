import Link from "next/link";
import { requireAdminPage } from "@/lib/admin/require-admin-page";
import {
  AD_CATEGORIES,
  AD_CATEGORY_LABELS,
  PROHIBITED_AD_CATEGORIES,
} from "@/lib/sponsorship-policy";

export const dynamic = "force-dynamic";

/**
 * Operator-facing ad policy. Kept in the admin app (rather than only in ignored
 * Markdown docs) so the campaign form can link to a page that is deployed.
 */
export default async function SponsorshipPolicyPage() {
  await requireAdminPage();

  return (
    <main className="space-y-6">
      <div>
        <Link href="/admin/sponsorships" className="text-xs underline">
          ← Sponsorships
        </Link>
        <h1 className="mt-2 text-xl font-bold">Advertising policy</h1>
        <p className="mt-2 max-w-3xl text-sm text-on-surface-variant">
          This policy governs every directly sold placement: feed, News,
          Sports and article-end. The server rejects categories outside the
          allow-list. This is an operating policy, not legal advice; consult
          qualified counsel for uncertain categories.
        </p>
      </div>

      <section className="rounded-2xl border border-outline-variant/30 p-4">
        <h2 className="text-sm font-bold">Accepted categories</h2>
        <p className="mt-1 text-xs text-on-surface-variant">
          One category is required on every new or edited campaign.
        </p>
        <ul className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          {AD_CATEGORIES.map((category) => (
            <li key={category} className="rounded-lg bg-surface-container-low p-2">
              <span className="font-medium">{AD_CATEGORY_LABELS[category]}</span>
              <span className="ml-2 font-mono text-[11px] text-on-surface-variant">
                {category}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-red-200 bg-red-50 p-4">
        <h2 className="text-sm font-bold text-red-900">Prohibited categories</h2>
        <p className="mt-1 text-xs text-red-800">
          These are rejected outright, regardless of creative or review. There
          is no exception path and recategorising a prohibited product under a
          permitted category is a policy breach.
        </p>
        <ul className="mt-3 grid gap-1 text-xs text-red-900 sm:grid-cols-2">
          {PROHIBITED_AD_CATEGORIES.map((category) => (
            <li key={category} className="font-mono">
              {category}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2 rounded-2xl border border-outline-variant/30 p-4 text-sm">
        <h2 className="text-sm font-bold">Every accepted campaign must</h2>
        <ul className="list-disc space-y-1 pl-5 text-xs text-on-surface-variant">
          <li>
            Carry the <strong>Ad</strong> label and the advertiser disclosure
            rendered by the app.
          </li>
          <li>
            Avoid misleading claims, fake controls, fake urgency, malware,
            phishing, forced downloads or deceptive redirects.
          </li>
          <li>
            Be safe for a general audience; no targeting of minors, hate,
            harassment or discrimination.
          </li>
          <li>
            Keep required licensing evidence on file for regulated products
            such as banking, insurance, health services and telecom.
          </li>
        </ul>
      </section>

      <p className="text-xs text-on-surface-variant">
        Machine-enforced source: <code>src/lib/sponsorship-policy.ts</code>.
        Measurement is anonymous first-party reporting with hashed install IDs;
        see the delivery report. Stop a live campaign and record the reason if
        it breaches this policy.
      </p>
    </main>
  );
}
