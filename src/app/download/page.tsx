import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import DownloadCTA from "./_components/DownloadCTA";
import { siteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Download SLNews | Sierra Leone News, Live Rates & Offline Reading",
  description:
    "Install SLNews — fast Sierra Leone breaking news, daily USD/Leone exchange rates, fuel prices, and offline reading. Under 3MB, built for Orange and Africell networks.",
  alternates: { canonical: siteUrl("/download") },
  openGraph: {
    title: "Download SLNews | Sierra Leone News & Live Rates",
    description:
      "Breaking news, daily USD/Leone rates, fuel prices, and offline reading — in an app under 3MB.",
    url: siteUrl("/download"),
    type: "website",
  },
};

const VALUE_PROPS = [
  {
    icon: "data_saver_on",
    title: "Saves your data",
    body: "Under 3MB and image-light. Read the news without burning through your Orange or Africell bundle.",
  },
  {
    icon: "currency_exchange",
    title: "Today's rates, live",
    body: "Official and market USD/Leone exchange rates, fuel prices, and rice prices in one place.",
  },
  {
    icon: "cloud_off",
    title: "Reads offline",
    body: "Save stories and keep the headlines cached so the news still works when the network drops.",
  },
  {
    icon: "notifications_active",
    title: "Breaking alerts",
    body: "Optional push notifications for the stories that matter most, straight to your phone.",
  },
];

const STEPS = [
  {
    n: "1",
    title: "Tap Install",
    body: 'Press "Install the app" above, or pick "Add to Home screen" from your browser menu.',
  },
  {
    n: "2",
    title: "Confirm",
    body: "Accept the prompt — SLNews is saved to your home screen in seconds.",
  },
  {
    n: "3",
    title: "Open anytime",
    body: "Launch SLNews like any app and read even when your data runs low.",
  },
];

const FAQS = [
  {
    q: "Do I need to pay or create an account?",
    a: "No. SLNews is free to read and installing it costs nothing. An account is only needed to save bookmarks or post notices.",
  },
  {
    q: "How much space does it take?",
    a: "The app itself is under 3MB, so it will not fill up your phone's storage.",
  },
  {
    q: "Will it work on my phone?",
    a: "Yes — SLNews installs on any modern Android or iPhone browser, and a Google Play version is available for Android.",
  },
];

export default async function DownloadPage() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const appJsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "SLNews",
    applicationCategory: "NewsApplication",
    operatingSystem: "Android, Web",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    url: siteUrl("/download"),
    description:
      "Sierra Leone breaking news, daily USD/Leone exchange rates, fuel prices, and offline reading in an app under 3MB.",
  };

  return (
    <div className="w-full max-w-4xl mx-auto">
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: JSON.stringify(appJsonLd) }}
      />

      {/* Hero / conversion band */}
      <section className="bg-primary text-on-primary rounded-3xl p-8 md:p-12 text-center shadow-sm mb-10">
        <span className="inline-block bg-white/15 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide mb-4">
          Free · Under 3MB · Works offline
        </span>
        <h1 className="text-3xl md:text-4xl font-black leading-tight mb-3">
          SLNews, built for Sierra Leone&apos;s networks
        </h1>
        <p className="text-primary-container max-w-xl mx-auto mb-7">
          Breaking news, live USD/Leone rates, fuel prices, and community
          notices — fast to open and light on data. Install it in seconds.
        </p>
        <DownloadCTA />
        <p className="text-xs text-on-primary/70 mt-5">
          Available for Android on Google Play. iOS and desktop open straight in
          your browser.
        </p>
      </section>

      {/* Value props */}
      <section className="mb-12">
        <h2 className="text-2xl font-bold text-on-surface text-center mb-6">
          Why install SLNews?
        </h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {VALUE_PROPS.map((v) => (
            <div
              key={v.title}
              className="flex items-start gap-3.5 bg-surface-container-low rounded-2xl p-5 border border-outline-variant/30"
            >
              <span className="material-symbols-outlined text-2xl text-primary bg-primary/10 p-2 rounded-lg shrink-0">
                {v.icon}
              </span>
              <div>
                <h3 className="font-bold text-on-surface text-sm mb-1">
                  {v.title}
                </h3>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  {v.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Install steps */}
      <section className="mb-12 bg-surface-container-lowest rounded-2xl p-6 md:p-8 border border-outline-variant/30">
        <h2 className="text-xl font-bold text-on-surface text-center mb-6">
          Install in three taps
        </h2>
        <div className="grid md:grid-cols-3 gap-4">
          {STEPS.map((s) => (
            <div
              key={s.n}
              className="flex md:flex-col items-center md:text-center gap-3"
            >
              <span className="bg-primary text-on-primary font-black rounded-full w-9 h-9 flex items-center justify-center shrink-0">
                {s.n}
              </span>
              <div>
                <p className="font-bold text-sm text-on-surface mb-0.5">
                  {s.title}
                </p>
                <p className="text-xs text-on-surface-variant">{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="mb-12">
        <h2 className="text-2xl font-bold text-on-surface text-center mb-6">
          Questions
        </h2>
        <div className="space-y-3">
          {FAQS.map((f) => (
            <details
              key={f.q}
              className="bg-surface-container-low rounded-xl p-4 border border-outline-variant/30 group"
            >
              <summary className="font-semibold text-on-surface cursor-pointer list-none flex items-center justify-between gap-3">
                {f.q}
                <span className="material-symbols-outlined text-on-surface-variant group-open:rotate-180 transition-transform">
                  expand_more
                </span>
              </summary>
              <p className="text-sm text-on-surface-variant mt-3">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <p className="text-center text-sm text-on-surface-variant mb-8">
        Prefer the browser?{" "}
        <Link href="/" className="text-primary font-semibold hover:underline">
          Continue to SLNews →
        </Link>
      </p>
    </div>
  );
}
