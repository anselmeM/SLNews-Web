-- Additive mobile-sync schema.
--
-- Applied by scripts/apply-mobile-sync-schema.mjs before every Vercel build, so
-- every statement is IF NOT EXISTS-guarded and nothing is dropped or altered:
-- running it against an already-migrated database must be a no-op. The local
-- development database receives the same file.
--
-- Why this is a script and not a Prisma migration: this schema has no migration
-- history (it was created with pushes), so there is no baseline to deploy onto.
-- These three tables are additive, so an idempotent file is enough.

-- CreateTable
CREATE TABLE IF NOT EXISTS "MobileBookmark" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "imageUrl" TEXT,
    "publisher" TEXT,
    "publishedAt" TIMESTAMP(3),
    "savedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobileBookmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MobileReaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'like',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobileReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MobileFollow" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobileFollow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MobileBookmark_userId_updatedAt_idx" ON "MobileBookmark"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MobileBookmark_userId_itemId_key" ON "MobileBookmark"("userId", "itemId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MobileReaction_userId_updatedAt_idx" ON "MobileReaction"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MobileReaction_userId_itemId_kind_key" ON "MobileReaction"("userId", "itemId", "kind");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MobileFollow_userId_updatedAt_idx" ON "MobileFollow"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MobileFollow_userId_targetId_key" ON "MobileFollow"("userId", "targetId");

-- AddForeignKey
-- `ADD CONSTRAINT` has no IF NOT EXISTS form, so each one checks the catalogue
-- first: the foreign keys cascade with the User rows the sync route bootstraps.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'MobileBookmark_userId_fkey'
    ) THEN
        ALTER TABLE "MobileBookmark" ADD CONSTRAINT "MobileBookmark_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'MobileReaction_userId_fkey'
    ) THEN
        ALTER TABLE "MobileReaction" ADD CONSTRAINT "MobileReaction_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'MobileFollow_userId_fkey'
    ) THEN
        ALTER TABLE "MobileFollow" ADD CONSTRAINT "MobileFollow_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Phase 5 parity: Article.sourceUrl.
--
-- Additive so it can run on every deploy. The column lets the scraper importer
-- identify a story by its canonical link instead of its headline, and lets a
-- bookmark saved in the mobile app (MobileBookmark.sourceUrl) be matched to the
-- article the web app stored.
--
-- Nullable for rows that predate it and for editor drafts, which have no external
-- link. The unique index still allows any number of NULLs in Postgres, so the
-- existing rows are not affected; the index exists to stop two rows claiming the
-- same story, which is the duplicate this column replaces title matching to
-- avoid.
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "sourceUrl" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Article_sourceUrl_key" ON "Article"("sourceUrl");

-- Phase 6: MobileDevice, the native push token registry.
--
-- Browsers register a VAPID endpoint in "PushSubscription"; a phone registers an
-- FCM token here after sign-in. The token is unique because FCM reissues the same
-- token for a reinstalled app on the same device, so registration is an upsert
-- keyed by token: two devices are two rows, a re-registration is one.
CREATE TABLE IF NOT EXISTS "MobileDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobileDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MobileDevice_token_key" ON "MobileDevice"("token");
CREATE INDEX IF NOT EXISTS "MobileDevice_userId_idx" ON "MobileDevice"("userId");

-- `ADD CONSTRAINT` has no IF NOT EXISTS form, so check the catalogue first.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'MobileDevice_userId_fkey'
    ) THEN
        ALTER TABLE "MobileDevice" ADD CONSTRAINT "MobileDevice_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Direct sponsorships (additive). Served by /api/mobile/v1/sponsorships and
-- rendered by the app's existing AdUnit widget.
CREATE TABLE IF NOT EXISTS "Sponsorship" (
  "id" TEXT PRIMARY KEY,
  "placement" TEXT NOT NULL,
  "advertiser" TEXT NOT NULL,
  "headline" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "ctaLabel" TEXT NOT NULL,
  "ctaUrl" TEXT NOT NULL,
  "brandHex" TEXT NOT NULL DEFAULT '#0B6FD1',
  "brandAccentHex" TEXT NOT NULL DEFAULT '#2E9BF5',
  "assetLabel" TEXT,
  "disclosure" TEXT,
  "imageUrl" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endsAt" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "Sponsorship_placement_active_startsAt_endsAt_idx"
  ON "Sponsorship" ("placement", "active", "startsAt", "endsAt");

-- Sponsorship counters (additive; measured by the public event endpoint).
ALTER TABLE "Sponsorship" ADD COLUMN IF NOT EXISTS "impressions" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Sponsorship" ADD COLUMN IF NOT EXISTS "taps" INTEGER NOT NULL DEFAULT 0;

-- Article.publisher (additive): the outlet a scraped story came from. The follow
-- digest addresses newspapers by publisher id; host inference misses outlets
-- whose feed host differs from the app's registry (Concord Times: the scraper
-- reads sierraleoneconcordtimes.com, the registry maps concordtimes.net), so
-- the scraper's own source name is stored and preferred.
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "publisher" TEXT;

-- Article.teams (additive): follow ids the scraper derived for a story, e.g.
-- {team:lal,league:nba}. The follow digest addresses readers on these topics.
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "teams" TEXT[] NOT NULL DEFAULT '{}';
