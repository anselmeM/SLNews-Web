# Schema migrations

Production schema history is tracked with Prisma migrations in
`prisma/migrations/`.

## Current state

- `20261122000000_init` is the baseline migration generated from
  `prisma/schema.prisma` when production already matched that schema.
- The production database was marked as having that migration applied with
  `prisma migrate resolve --applied`, not by executing its DDL.
- The **Database schema** workflow now supports:
  - `discover` — list Neon databases,
  - `inspect` — run a read-only query,
  - `preview` — print the database→schema diff,
  - `baseline` — record the first migration as applied on an existing database,
  - `recover` — mark a failed migration rolled back (`migration_name`), then rerun `apply`,\n  - `apply` — run `prisma migrate deploy` and verify `migrate status`.

## Changing the schema

1. Change `prisma/schema.prisma` locally.
2. Generate a migration into a new timestamped directory:
   ```bash
   npx prisma migrate diff \
     --from-migrations prisma/migrations \
     --to-schema prisma/schema.prisma \
     --script > prisma/migrations/<timestamp>_<name>/migration.sql
   ```
   For a dev database, `npx prisma migrate dev --name <name>` does this and
   validates the SQL against a shadow database.
3. Review the SQL. It must not contain destructive changes unless the PR
   explicitly plans a backfill.
4. Commit the migration with the schema change.
5. Run the workflow in `preview` mode, then `apply` mode.
6. Deploy code only after `apply` succeeds.

## Rules

- Never edit an already-applied migration.\n- Write migration files as UTF-8 **without a BOM**; a BOM makes Postgres reject the\n  first statement. If a migration fails, use the `recover` workflow mode before\n  retrying.
- Never use `db push` against production.
- Destructive changes need a multi-step plan: additive migration, backfill,
  then a later cleanup migration.
- Keep migrations SQL-only; data backfills belong in scripts run before the
  cleanup migration.
