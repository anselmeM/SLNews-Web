import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | SLNews",
  description:
    "Privacy policy for the SLNews Android and iOS apps and the SLNews website: what we collect, what we do not, and how to delete your account.",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="max-w-4xl mx-auto py-10 px-4 sm:px-6">
      <div className="mb-8 border-b border-outline-variant/30 pb-6">
        <div className="flex items-center gap-2 text-xs font-bold text-primary uppercase tracking-wider mb-2">
          <span className="material-symbols-outlined text-[18px]">
            verified_user
          </span>
          Legal &amp; Compliance
        </div>
        <h1 className="text-3xl sm:text-4xl font-black text-on-surface tracking-tight mb-2">
          Privacy Policy
        </h1>
        <p className="text-xs text-on-surface-variant">
          Last updated: October 2026 · Covers the SLNews Android and iOS apps
          and this website
        </p>
      </div>

      <div className="prose dark:prose-invert max-w-none space-y-6 text-sm text-on-surface-variant leading-relaxed">
        <section className="bg-surface-container-lowest border border-outline-variant/30 p-6 rounded-3xl">
          <h2 className="text-base font-bold text-on-surface mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-xl">
              info
            </span>
            1. Overview &amp; commitment
          </h2>
          <p>
            <strong>SLNews</strong> (&quot;we&quot;, &quot;our&quot;, or
            &quot;us&quot;) publishes news aggregation, local coverage and
            market information for Sierra Leone and its diaspora. Our main
            product is now the <strong>SLNews app for Android and iOS</strong>,
            built with Flutter. This website remains the companion site and the
            backend that feeds the app.
          </p>
          <p className="mt-2">
            We follow data minimisation: the app is fully usable without an
            account, and we only keep what a feature you chose to use actually
            needs.
          </p>
        </section>

        <section className="bg-surface-container-lowest border border-outline-variant/30 p-6 rounded-3xl">
          <h2 className="text-base font-bold text-on-surface mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-xl">
              phone_android
            </span>
            2. What the SLNews apps collect
          </h2>
          <ul className="list-disc list-inside space-y-2">
            <li>
              <strong>Account information (optional):</strong> if you sign in,
              we receive your email address and display name from our
              authentication provider (Clerk). Reading, search, saving and
              liking all work without an account.
            </li>
            <li>
              <strong>Your reading state, if you sign in:</strong> the stories
              you save, the posts you like, the teams, leagues, locations and
              topics you follow, and your reader preferences are synced to our
              database so they appear on your other devices.
            </li>
            <li>
              <strong>Push-notification token:</strong> if you enable alerts,
              the app registers a device token so our server can deliver them.
              Turning alerts off removes it.
            </li>
            <li>
              <strong>On-device storage:</strong> recent articles, images and
              preferences are cached on your phone so the app opens and reads
              offline. The cache stays on the device; clearing app data or
              uninstalling removes it.
            </li>
            <li>
              <strong>Technical requests:</strong> like any app that talks to a
              server, requests carry your IP address, app version and timestamps
              to our hosting providers, and they appear in our logs for security
              and debugging.
            </li>
            <li>
              <strong>Crash diagnostics:</strong> if the app crashes or hits an
              unexpected error, it sends a report to Sentry containing the stack
              trace, the device model, the operating system and version, the app
              version and the action that failed. We configure Sentry not to
              store IP addresses; reports carry no account identifier, no
              reading history and no article content. A small sample (5 %) of
              anonymous performance traces (app start, navigation and network
              timings) is sent for the same diagnostic purpose.
            </li>

            <li>
              <strong>&quot;Read original&quot; pages:</strong> when you tap
              Read original, the publisher&apos;s article opens in an in-app
              browser view inside SLNews. That view does not share your SLNews
              sign-in, but while the page is open the publisher may set its own
              cookies or use its own trackers under its own privacy policy. We
              do not receive or store that data.
            </li>
          </ul>
          <p className="mt-3">
            <strong>The apps do not collect</strong> your location (the weather
            chip uses the location you pick from a list, never GPS), contacts,
            calendar, SMS, call logs, photos, camera or microphone input, health
            data, or your advertising identifier.
          </p>
          <p className="mt-2">
            The apps contain{" "}
            <strong>no analytics SDK and no advertising SDK</strong>. Search
            terms are matched against content already on your device and are not
            sent to us as a search log. Crash diagnostics are the only automatic
            telemetry the apps send, and they are limited to what the paragraph
            above lists.
          </p>
        </section>

        <section className="bg-surface-container-lowest border border-outline-variant/30 p-6 rounded-3xl">
          <h2 className="text-base font-bold text-on-surface mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-xl">
              language
            </span>
            3. What the website collects (web only)
          </h2>
          <p>
            These practices apply when you use <strong>this website</strong>.
            None of them run inside the mobile apps:
          </p>
          <ul className="list-disc list-inside space-y-2 mt-2">
            <li>
              <strong>Local storage:</strong> your theme preference is kept in
              your browser.
            </li>
            <li>
              <strong>No advertising or tracking:</strong> the website loads no
              advertising SDK, no social pixel and no analytics script, and
              creates no tracking cookie.
            </li>
            <li>
              <strong>Contact email:</strong> if you email us, your message and
              address are used only to answer you.
            </li>
          </ul>
        </section>

        <section className="bg-surface-container-lowest border border-outline-variant/30 p-6 rounded-3xl">
          <h2 className="text-base font-bold text-on-surface mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-xl">
              hub
            </span>
            4. Third-party services
          </h2>
          <ul className="list-disc list-inside space-y-2">
            <li>
              <strong>Clerk:</strong> authentication and session management in
              the apps.
            </li>
            <li>
              <strong>Firebase Cloud Messaging (Google):</strong> delivery of
              push notifications. The app registers a device token with our
              server, which passes it to Google to deliver the alert; it is not
              used for analytics or advertising.
            </li>
            <li>
              <strong>Sentry:</strong> crash and error diagnostics for the apps
              and this website, configured without IP storage and without
              account identifiers.
            </li>
            <li>
              <strong>Vercel &amp; Neon Postgres:</strong> hosting, delivery and
              encrypted database storage.
            </li>
            <li>
              <strong>Render:</strong> our content-ingestion service that
              collects publisher feeds.
            </li>
            <li>
              <strong>Google / YouTube:</strong> embedded video playback through
              the privacy-enhanced player.
            </li>
            <li>
              <strong>Google Translate:</strong> opened only if you ask to
              translate a story.
            </li>
            <li>
              <strong>Yahoo Finance</strong> and{" "}
              <strong>open.er-api.com</strong>: market data requested by the
              app.
            </li>
          </ul>
          <p className="mt-2">
            These providers may process data outside Sierra Leone, including in
            the United States and the European Union, under their standard
            contractual safeguards.
          </p>
        </section>

        <section className="bg-surface-container-lowest border border-outline-variant/30 p-6 rounded-3xl">
          <h2 className="text-base font-bold text-on-surface mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-xl">
              ad_units
            </span>
            5. Advertising and sponsored content
          </h2>
          <p>
            In the apps, sponsored cards are served by our own backend and
            always labelled
            <strong> Ad</strong>. The apps contain no third-party ad SDK and do
            not send your data to advertisers. If you tap a sponsored card, the
            advertiser&apos;s site opens in your browser and its own policy
            applies.
          </p>
        </section>

        <section className="bg-surface-container-lowest border border-outline-variant/30 p-6 rounded-3xl">
          <h2 className="text-base font-bold text-on-surface mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-xl">
              security
            </span>
            6. Retention, deletion and your rights
          </h2>
          <p>
            Crash reports are retained by Sentry for 90 days and are not linked
            to an account. Account data and synced reading state are kept until
            you delete your account. Deleting removes the account record and the
            synced saved stories, likes, follows and device tokens; backups are
            purged on a rolling basis within 90 days. Server logs follow our
            providers&apos; standard retention. The on-device cache clears when
            you clear the app data or uninstall.
          </p>
          <p className="mt-2">You can at any time:</p>
          <ul className="list-disc list-inside space-y-2 mt-2">
            <li>
              <strong>Delete your account</strong> in the app (Settings → SLNews
              account → Delete account), on the{" "}
              <Link
                href="/delete-account"
                className="text-primary font-semibold hover:underline"
              >
                account deletion page
              </Link>
              , or by email.
            </li>
            <li>
              Request a copy of the personal data associated with your account.
            </li>
            <li>Correct your name or email, or stop syncing by signing out.</li>
            <li>
              Turn notifications off at any time in the app or in Android
              settings.
            </li>
          </ul>
          <p className="mt-3">
            To submit a data access or deletion request, email{" "}
            <a
              href="mailto:privacy@slnews.sl"
              className="text-primary font-semibold hover:underline"
            >
              privacy@slnews.sl
            </a>
            . We answer verified requests within 30 days.
          </p>
        </section>

        <section className="bg-surface-container-lowest border border-outline-variant/30 p-6 rounded-3xl">
          <h2 className="text-base font-bold text-on-surface mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-xl">
              child_care
            </span>
            7. Children
          </h2>
          <p>
            SLNews is not directed to children under 13 and we do not knowingly
            collect their personal data. If you believe a child has created an
            account, contact us and we will delete it.
          </p>
        </section>

        <section className="bg-surface-container-lowest border border-outline-variant/30 p-6 rounded-3xl">
          <h2 className="text-base font-bold text-on-surface mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-xl">
              lock
            </span>
            8. Security
          </h2>
          <p>
            Traffic between the apps and our servers uses TLS. Sign-in tokens
            are managed by Clerk and stored by the SDK in the platform&apos;s
            protected storage. Access to our database is limited to the service
            and to maintainers who need it. On-device caches are not encrypted
            at rest, so anyone with access to your unlocked device can read
            cached articles and preferences.
          </p>
        </section>

        <section className="bg-surface-container-lowest border border-outline-variant/30 p-6 rounded-3xl">
          <h2 className="text-base font-bold text-on-surface mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-xl">
              update
            </span>
            9. Changes to this policy
          </h2>
          <p>
            We will update this policy when our practices change, and the date
            above changes with it. Material changes are announced in the app or
            on this page before they take effect.
          </p>
        </section>

        <section className="bg-surface-container-lowest border border-outline-variant/30 p-6 rounded-3xl">
          <h2 className="text-base font-bold text-on-surface mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-xl">
              mail
            </span>
            10. Contact us
          </h2>
          <p>
            If you have questions or feedback about this policy, please reach
            out to our team:
          </p>
          <div className="mt-3 p-3 bg-surface-container rounded-2xl text-xs space-y-1">
            <p>
              <strong>SLNews Privacy &amp; Data Protection Team</strong>
            </p>
            <p>
              Email:{" "}
              <a
                href="mailto:privacy@slnews.sl"
                className="text-primary hover:underline"
              >
                privacy@slnews.sl
              </a>
            </p>
            <p>Freetown, Sierra Leone / Toronto, Ontario, Canada</p>
          </div>
        </section>
      </div>

      <div className="mt-8 pt-6 border-t border-outline-variant/20 flex flex-wrap items-center justify-between gap-3 text-xs">
        <Link
          href="/"
          className="text-primary font-bold hover:underline flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[16px]">
            arrow_back
          </span>
          Back to Home
        </Link>
        <div className="flex items-center gap-4">
          <Link
            href="/delete-account"
            className="text-on-surface-variant hover:text-on-surface transition-colors"
          >
            Delete your account
          </Link>
          <Link
            href="/terms"
            className="text-on-surface-variant hover:text-on-surface transition-colors"
          >
            Terms of Service →
          </Link>
        </div>
      </div>
    </div>
  );
}
