# Schema migration policy

## Current state

There is no `prisma/migrations/` history. Production is reconciled from
`prisma/schema.prisma` by the **Database schema** GitHub workflow, which:

1. resolves a Neon database through the Neon API (no DB URL in the repo),
2. can run `discover`, `inspect`, `preview` or `apply`,
3. previews the SQL and refuses `--accept-data-loss` on apply,
4. verifies that the database matches the schema afterwards.

This is acceptable while one maintainer applies schema changes during planned
windows. It is not suitable for a team or for high-risk changes.

## Rules for every schema change

1. Run the workflow in `discover` mode and confirm the target database.
2. Run `preview` and read the SQL. Stop if it drops a column, casts a column type
   destructively, or renames a table.
3. Run `apply`; it fails closed if data loss would be required.
4. Deploy code that reads the new schema only after `apply` succeeds.
5. Record the apply run ID in the PR description.

## When to switch to real migrations

Move to `prisma migrate deploy` when any of these becomes true:

- more than one person can change the production schema,
- a change needs a multi-step backfill or rename,
- production data must be preserved through a type/cast change,
- an auditable migration history is required for compliance.

## Baseline procedure (future)

1. Create `prisma/migrations/000000000000_init/migration.sql` from the current
   schema using `prisma migrate diff --from-empty --to-schema`.
2. Apply it to a Neon branch and verify with `prisma migrate diff --exit-code`.
3. Mark the production database as baselined:
   `prisma migrate resolve --applied 000000000000_init`.
4. Replace the `db push` step in `db-schema.yml` with `prisma migrate deploy`.
5. Keep the workflow's Neon API resolution and preview gate.

Until that migration, CI must at least validate the schema on every change:
`npx prisma validate` runs in the test job.
