# Sponsorship operations

This document is the operator contract for the mobile sponsorship inventory.
It accompanies `docs/SPONSORSHIP-IMPROVEMENTS.md` in the app repo.

## Inventory and placements

| Placement | App surface |
|---|---|
| `feed` | For You (two cards) and News (one card) |
| `sports_stream` | Sports tab inline card |
| `article_end` | Article reader, after the body and before related stories |

A campaign is served only when `active=true`, `archivedAt IS NULL`, the current
time is inside `startsAt`/`endsAt`, and its delivery caps allow another
impression. Unknown placements are rejected by the API and admin form.

## Measurement definition

- **Impression:** at least 50% of the sold card visible for about one second,
  posted once per campaign per app session. This is a rendered/viewability
  approximation, not third-party audited measurement.
- **Tap:** a successful open of the sponsor landing page. Invalid targets,
  blocked launches and house ads are never billed. Taps dedupe per campaign per
  session.
- **Offline events:** persisted in a capped on-device outbox and retried on the
  next app launch with the same event id.
- **Server dedupe:** each event carries a signed, 60-minute token and a stable
  event id. The server ignores expired/forged tokens, stopped or out-of-window
  campaigns, replays and duplicate event ids.
- **Daily totals:** every accepted event updates a UTC-day metric row used by
  the report API/admin page.

The interim control is signed tokens plus event dedupe; it is not Play
Integrity/device attestation. Treat numbers as planning/invoice inputs until a
third-party audit or attestation is added.

## Admin workflow

- `/admin/sponsorships` — live/archived campaigns, derived status, edit,
  duplicate, stop, extend, reactivate, archive, test push.
- `/admin/sponsorships/new` — create with a live card preview.
- `/admin/sponsorships/[id]/edit` — edit an existing campaign.
- `/admin/sponsorships/report` — date-bounded delivery report and CSV export.
- All mutating actions are audit-logged and invalidate the public sponsorship
  cache tag.

## Configuration

| Variable | Purpose |
|---|---|
| `SPONSORSHIP_ADMIN_KEY` | Admin console key and fallback event-token secret |
| `SPONSORSHIP_EVENT_SECRET` | Preferred dedicated event-token secret |
| `SPONSORSHIP_ALLOW_LEGACY_EVENTS` | `false` disables token-less events from pre-token app builds; leave unset/true until those installs age out |\n| `SPONSORSHIP_LEGACY_EVENTS_UNTIL` | ISO cutoff for token-less events when the flag is unset; defaults to 2027-01-31 |
| `BLOB_READ_WRITE_TOKEN` | Creative uploads (Vercel Blob) |
| `CREATIVE_ALLOWED_HOSTS` | Optional comma-separated extra image hosts; Vercel Blob and the private creative proxy are approved by default |

Rotate `SPONSORSHIP_ADMIN_KEY` when an operator leaves or a device with the key
is lost; existing admin cookies are invalidated because the cookie is derived
from the key. Keep both secrets in Vercel, never in the repo.

## Schema changes

There are no migration files for this schema; production is reconciled from
`prisma/schema.prisma` by the `db-schema` GitHub workflow (`db push`). Before
deploying this change, run the workflow in `discover` mode, then `apply`, and
confirm the `SponsorshipDailyMetric`, `SponsorshipEvent` and `AdminAuditLog`
tables exist. `Sponsorship.placement` stays text and is checked by the shared
placement allow-list in code.
