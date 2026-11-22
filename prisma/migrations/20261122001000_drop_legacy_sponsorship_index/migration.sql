-- The pre-migration schema used a narrower index name. The current schema
-- declares the four-column index; remove the legacy index once, then future
-- databases start from migration history only.
DROP INDEX IF EXISTS "Sponsorship_placement_active_startsAt_endsAt_idx";
