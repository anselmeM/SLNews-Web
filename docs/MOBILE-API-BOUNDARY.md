# Mobile API boundary

SLNews has three deployables. This document makes the mobile API ownership
explicit so new endpoints do not land on the wrong host.

| Surface | Owner | Host | Versioning |
|---|---|---|---|
| News/content ingestion + article/video feeds | `SLNewsAPIScrapper` | Render | `/api/news` legacy, prefer `/v1/*` |
| Sponsorships, sync, push devices, account, digest, sports scores | `SLNews-Web` (mobile BFF) | Vercel | `/api/mobile/v1/*` |
| Public website and admin | `SLNews-Web` | Vercel | UI routes |

## Base URLs in the app

| Purpose | App config | Default |
|---|---|---|
| Content API | `SLNEWS_API_URL` | `https://slnewsapiscapper.onrender.com` |
| Mobile BFF (ads, push, sync) | `SLNEWS_WEB_URL` | `https://sl-news.vercel.app` |
| Sync/digest | `SLNEWS_SYNC_URL` | `https://sl-news.vercel.app` |

The app attaches a Clerk JWT only to allow-listed hosts (`authTokenHosts`).
Never send a session token to the scraper host unless that host is also in the
allow-list.

## Auth rules

| Endpoint class | Auth |
|---|---|
| Public ad delivery, event posting | Public; events require a signed, short-lived token (legacy app builds may post without one during rollout) |
| Sync, account, digest preferences, push registration | Clerk session JWT |
| Admin create/edit/stop/report | `x-admin-key` header or the web admin session cookie |
| Scraper content API | Session JWT and/or optional static API key |

## Versioning and compatibility

- Web mobile routes are versioned by path: `/api/mobile/v1/...`.
- Additive optional fields are allowed within v1; breaking changes need a new
  path version and a migration plan for old app builds.
- The canonical sponsorship contract is [`contracts/`](../contracts/README.md).
- Old mobile builds that post `{id,type}` without a token are accepted while
  `SPONSORSHIP_ALLOW_LEGACY_EVENTS` is not `false`.

## Failure behavior

- Content API failure: show cached/seed content; never block the reader.
- Mobile BFF failure: ads/push/sync degrade quietly; local state remains usable.
- Sponsorship report failure: admin sees an error; public ad delivery still
  returns an empty list rather than a 5xx.

## Ownership rules

- Put content ingestion/reprocessing on the scraper.
- Put anything that needs Clerk identity, the Neon app database or the admin
  console on the web BFF.
- Do not add a mobile endpoint to the scraper just because it already has an
  Express router; check the ownership table first.
