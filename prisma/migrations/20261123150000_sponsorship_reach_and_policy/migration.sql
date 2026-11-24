-- Additive: ad policy category and anonymous install-id reach hashes.
--
-- "Sponsorship"."adCategory" is nullable because campaigns sold before the ad
-- policy have no category; the API and admin form require a category for every
-- new or edited campaign (allow-list in src/lib/sponsorship-policy.ts).
--
-- "SponsorshipEvent"."installIdHash" stores an HMAC-SHA256 of the app's stable
-- anonymous install id, never the raw id. Nullable so legacy events and events
-- posted by app builds without an install id stay valid; the index lets the
-- report count distinct reach per campaign over a date range.
--
-- No data is rewritten and no column is dropped, so this migration is safe to
-- apply while the previous deployment is still serving.

ALTER TABLE "Sponsorship" ADD COLUMN IF NOT EXISTS "adCategory" TEXT;
ALTER TABLE "SponsorshipEvent" ADD COLUMN IF NOT EXISTS "installIdHash" TEXT;

CREATE INDEX IF NOT EXISTS "SponsorshipEvent_sponsorshipId_installIdHash_idx"
  ON "SponsorshipEvent" ("sponsorshipId", "installIdHash");

-- The deploy guard in docs/mobile-sync-migration.sql used to recreate this
-- pre-migration index after the drop migration ran, leaving permanent schema
-- drift. Remove it here as well so migrate status and diff are clean.
DROP INDEX IF EXISTS "Sponsorship_placement_active_startsAt_endsAt_idx";
