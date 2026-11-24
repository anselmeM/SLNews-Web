# Sponsorship operations

This document is the operator contract for the mobile sponsorship inventory. It
accompanies `docs/SPONSORSHIP-IMPROVEMENTS.md` in the app repo and
[`docs/AD-POLICY.md`](AD-POLICY.md) (advertiser categories and review).

## Inventory and placements

| Placement | App surface | Server-selected units |
|---|---|---|
| `feed` | For You, between story groups | at most 2 |
| `news_stream` | News tab, between story groups | at most 1 |
| `sports_stream` | Sports tab inline card | at most 1 |
| `article_end` | Article reader, after the body and before related stories | at most 1 |

The server is the slot selector. It returns a rotated, slot-limited list and the
app renders exactly that list in order: For You renders up to two returned feed
units; each singleton placement renders the first returned unit. The app must not
request a larger pool and choose from it.

## Selection rules

A campaign is served only when `active=true`, `archivedAt IS NULL`, the current
time is inside `startsAt`/`endsAt`, and its delivery caps allow another
impression. Unknown placements are rejected by the API and admin form.

- **Priority** is strict: higher priority is served first.
- **Weight** breaks ties inside the same priority band.
- A deterministic **hourly seed** rotates campaigns so new inventory does not
  starve older sold inventory; selection is stable within the hour and cached
  for 60 seconds (invalidated on admin writes).
- Lifetime and daily caps are evaluated before a unit is returned.
- `feed` is capped at two units; `news_stream`, `sports_stream` and
  `article_end` at one.

## Measurement definition

- **Impression:** every viewable rendering of the sold card (at least 50% of the
  card visible for about one second). Each rendering posts its own event with a
  fresh event id — impressions are **no longer deduplicated once per campaign per
  session**. This is a rendered/viewability approximation, not third-party
  audited measurement.
- **Tap:** every successful open of the sponsor landing page. Invalid targets,
  blocked launches and house ads are never billed. Each tap is its own event.
- **Offline events:** persisted in a capped on-device outbox and retried on the
  next app launch with the same event id (so a retry cannot double-count).
- **Server dedupe:** each event carries a signed, 60-minute token and a stable
  event id. The server ignores expired/forged tokens, stopped or out-of-window
  campaigns, replays and duplicate event ids. Token-less "legacy" events remain
  accepted while `SPONSORSHIP_ALLOW_LEGACY_EVENTS` is not `false`.
- **Anonymous install id:** the app sends a stable, random install id (32
  lowercase hex chars) with every event. The server **hashes it with
  HMAC-SHA256** using `SPONSORSHIP_EVENT_SECRET` (falling back to
  `SPONSORSHIP_ADMIN_KEY`) and stores only `SponsorshipEvent.installIdHash`. The
  raw id is never persisted or logged. Missing/invalid install ids are treated
  as "no identifiable reach": the event still counts.
- **Unique reach:** for a date range, the number of distinct `installIdHash`
  values with at least one impression on that campaign. Null when no event in
  the range carries an identifiable install id (legacy events, old app builds, or
  a deployment without a hashing secret).
- **Frequency:** `impressions / reach` — average impressions per reached
  anonymous install. Null when reach is null.
- **Daily totals:** every accepted event updates a UTC-day metric row
  (`SponsorshipDailyMetric`) used by the report API/admin page. Reach is counted
  from the event ledger, not from the daily metric row.

Rotating `SPONSORSHIP_EVENT_SECRET` invalidates existing hashes, so reach starts
from zero for installs seen after rotation; impressions/taps are unaffected. When
`SPONSORSHIP_EVENT_SECRET` is unset and only the admin key is configured, the
admin-key fallback is used — rotating the admin key has the same reach-reset
effect.

The interim control is signed tokens plus event dedupe; it is not Play
Integrity/device attestation. Treat numbers as planning/invoice inputs until a
third-party audit or attestation is added. Reach is aggregate and anonymous; it
must not be joined to a reader identity.

## Ad policy

Every new/edited campaign carries an allow-listed `adCategory`
(`src/lib/sponsorship-policy.ts`). Prohibited categories are rejected by the API
and the admin form; unknown categories are rejected. Campaigns created before the
policy have `adCategory = NULL` and remain valid until edited. Duplicating such a
campaign defaults the copy's category to `other` for review. Read the full policy
and review checklist in [`docs/AD-POLICY.md`](AD-POLICY.md).

## Admin workflow

- `/admin/sponsorships` — live/archived campaigns with category, placement,
  priority/caps, window and counters; derived status; edit, duplicate, stop,
  extend, reactivate, archive, test push.
- `/admin/sponsorships/new` — create with a live card preview; placement capacity
  and ad category/policy note are shown inline.
- `/admin/sponsorships/[id]/edit` — edit an existing campaign.
- `/admin/sponsorships/report` — date-bounded delivery report with impressions,
  reach, frequency, taps, CTR, ad category and placement, plus CSV export with
  the same columns.
- All mutating actions are audit-logged and invalidate the public sponsorship
  cache tag.

## Configuration

| Variable | Purpose |
|---|---|
| `SPONSORSHIP_ADMIN_KEY` | Admin console key; fallback secret for event tokens and install-id hashing |
| `SPONSORSHIP_EVENT_SECRET` | Preferred dedicated secret for event tokens **and** install-id HMACs |
| `SPONSORSHIP_ALLOW_LEGACY_EVENTS` | `false` disables token-less events from pre-token app builds; leave unset/true until those installs age out |
| `SPONSORSHIP_LEGACY_EVENTS_UNTIL` | ISO cutoff for token-less events when the flag is unset; defaults to 2027-01-31 |
| `BLOB_READ_WRITE_TOKEN` | Creative uploads (Vercel Blob) |
| `CREATIVE_ALLOWED_HOSTS` | Optional comma-separated extra image hosts; Vercel Blob and the private creative proxy are approved by default |

Rotate `SPONSORSHIP_ADMIN_KEY` when an operator leaves or a device with the key
is lost; existing admin cookies are invalidated because the cookie is derived
from the key. Keep both secrets in Vercel, never in the repo.

## Schema changes and deployment order

`prisma/migrations/` is the canonical schema history. The sponsorship tables are
covered by the baseline `20261122000000_init`; later changes land as additive
migration directories:

- `20261123150000_sponsorship_reach_and_policy` — adds nullable
  `Sponsorship.adCategory`, nullable `SponsorshipEvent.installIdHash` and the
  `(sponsorshipId, installIdHash)` index. No data is rewritten or dropped.

To deploy a schema change:

1. Run the **Database schema** GitHub workflow in `preview` mode to print the SQL
   diff against the target Neon database (a read-only check).
2. Run it in `apply` mode: `prisma migrate deploy` plus a drift check
   (`prisma migrate status` and `migrate diff --exit-code`).
3. Deploy the code only after `apply` succeeds.

The deploy path (`vercel-build` → `scripts/apply-mobile-sync-schema.mjs`) also
runs `docs/mobile-sync-migration.sql`, which now contains guarded
`ADD COLUMN IF NOT EXISTS` copies of the same two columns. That is a
belt-and-braces guard so a deployment that lands before the migration still has
the columns the event/report code writes; the Prisma migration remains the
canonical DDL and must still be applied so `migrate status` is clean.

Migration rules: SQL only, UTF-8 **without a BOM**, no destructive statements in
the same PR (additive → backfill → later cleanup), never edit an applied
migration, never `db push` against production. See
[`docs/SCHEMA-MIGRATIONS.md`](SCHEMA-MIGRATIONS.md) and the `recover` mode in
`.github/workflows/db-schema.yml` if a migration fails.
