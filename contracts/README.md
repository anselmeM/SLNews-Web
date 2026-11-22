# Mobile API contract

`openapi.json` is the canonical contract for the sponsorship mobile endpoints.
`fixtures/` contains the canonical AdUnit and event request used by both the
Flutter app and SLNews-Web tests.

## Ownership and change policy

- **Owner:** SLNews-Web (mobile BFF/admin). The Flutter app is a consumer.
- **Versioning:** path version is `/api/mobile/v1`; breaking changes require a new
  path version. Additive optional fields are allowed within v1.
- **Change process:** update `openapi.json` and `fixtures/` in the same change as
  the Web route, then update the Flutter fixture test. CI must pass on both repos.
- **Do not** add a field to the API response without adding it to the AdUnit
  schema and fixture; do not remove or rename a field without a new API version.

## Endpoints

| Endpoint | Auth | Consumer |
|---|---|---|
| `GET /api/mobile/v1/sponsorships?placement=` | public | Flutter |
| `POST /api/mobile/v1/sponsorships` | `x-admin-key` | admin/API |
| `POST /api/mobile/v1/sponsorships/events` | signed event token or legacy flag | Flutter |
| `GET /api/mobile/v1/sponsorships/report` | `x-admin-key` | admin |
| `PATCH/DELETE /api/mobile/v1/sponsorships/{id}` | `x-admin-key` | admin/API |

The app must treat absent/null optional fields as empty. Unknown response fields
are ignored for forward compatibility.
