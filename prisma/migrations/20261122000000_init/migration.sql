-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'WRITER', 'EDITOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "Status" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'REJECTED');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "password" TEXT,
    "bio" TEXT,
    "preferredTopics" TEXT[],
    "dailyBriefing" BOOLEAN NOT NULL DEFAULT false,
    "digestCadence" TEXT NOT NULL DEFAULT 'daily',
    "quietHoursStart" INTEGER,
    "quietHoursEnd" INTEGER,
    "timezoneOffsetMinutes" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedArticle" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionDay" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "firstVisits" INTEGER NOT NULL DEFAULT 0,
    "returningVisits" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "summary" TEXT,
    "imageUrl" TEXT,
    "sourceUrl" TEXT,
    "publisher" TEXT,
    "teams" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "published" BOOLEAN NOT NULL DEFAULT false,
    "status" "Status" NOT NULL DEFAULT 'DRAFT',
    "province" TEXT,
    "district" TEXT,
    "authorId" TEXT NOT NULL,
    "breaking" BOOLEAN NOT NULL DEFAULT false,
    "breakingSetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketPrice" (
    "id" TEXT NOT NULL,
    "commodity" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'Freetown Central',
    "price" DOUBLE PRECISION NOT NULL,
    "trend" TEXT,
    "trendPct" DOUBLE PRECISION,
    "trendPeriod" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "organization" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "dateLabel" TEXT NOT NULL,
    "urgency" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnouncementComment" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnnouncementComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleReaction" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigestRun" (
    "day" TEXT NOT NULL,
    "topics" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigestRun_pkey" PRIMARY KEY ("day")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "keys" JSONB NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "commodity" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "lastNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "commodity" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "reportedPrice" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Follow" (
    "id" TEXT NOT NULL,
    "followerId" TEXT NOT NULL,
    "followingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobileBookmark" (
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
CREATE TABLE "MobileReaction" (
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
CREATE TABLE "MobileFollow" (
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

-- CreateTable
CREATE TABLE "MobileDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobileDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sponsorship" (
    "id" TEXT NOT NULL,
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
    "altText" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "maxImpressions" INTEGER,
    "dailyImpressionCap" INTEGER,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "taps" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sponsorship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SponsorshipDailyMetric" (
    "sponsorshipId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "taps" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SponsorshipDailyMetric_pkey" PRIMARY KEY ("sponsorshipId","day")
);

-- CreateTable
CREATE TABLE "SponsorshipEvent" (
    "id" TEXT NOT NULL,
    "sponsorshipId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SponsorshipEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "actor" TEXT NOT NULL DEFAULT 'admin',
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ArticleToCategory" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ArticleToCategory_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "SavedArticle_userId_idx" ON "SavedArticle"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedArticle_userId_articleId_key" ON "SavedArticle"("userId", "articleId");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionDay_day_key" ON "RetentionDay"("day");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "Article_sourceUrl_key" ON "Article"("sourceUrl");

-- CreateIndex
CREATE INDEX "Article_published_status_idx" ON "Article"("published", "status");

-- CreateIndex
CREATE INDEX "Article_published_status_publishedAt_idx" ON "Article"("published", "status", "publishedAt");

-- CreateIndex
CREATE INDEX "Article_breaking_published_status_idx" ON "Article"("breaking", "published", "status");

-- CreateIndex
CREATE INDEX "Article_publishedAt_idx" ON "Article"("publishedAt");

-- CreateIndex
CREATE INDEX "Article_updatedAt_idx" ON "Article"("updatedAt");

-- CreateIndex
CREATE INDEX "Article_province_idx" ON "Article"("province");

-- CreateIndex
CREATE INDEX "Article_authorId_idx" ON "Article"("authorId");

-- CreateIndex
CREATE INDEX "Article_title_idx" ON "Article"("title");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "MarketPrice_commodity_market_key" ON "MarketPrice"("commodity", "market");

-- CreateIndex
CREATE INDEX "Announcement_published_category_createdAt_idx" ON "Announcement"("published", "category", "createdAt");

-- CreateIndex
CREATE INDEX "AnnouncementComment_announcementId_createdAt_idx" ON "AnnouncementComment"("announcementId", "createdAt");

-- CreateIndex
CREATE INDEX "AnnouncementComment_userId_idx" ON "AnnouncementComment"("userId");

-- CreateIndex
CREATE INDEX "Comment_articleId_createdAt_idx" ON "Comment"("articleId", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_userId_idx" ON "Comment"("userId");

-- CreateIndex
CREATE INDEX "ArticleReaction_articleId_idx" ON "ArticleReaction"("articleId");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleReaction_articleId_userId_emoji_key" ON "ArticleReaction"("articleId", "userId", "emoji");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimit_key_key" ON "RateLimit"("key");

-- CreateIndex
CREATE INDEX "RateLimit_expiresAt_idx" ON "RateLimit"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "PasswordResetToken_email_idx" ON "PasswordResetToken"("email");

-- CreateIndex
CREATE INDEX "PasswordResetToken_token_idx" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PriceAlert_market_idx" ON "PriceAlert"("market");

-- CreateIndex
CREATE UNIQUE INDEX "PriceAlert_userId_commodity_market_key" ON "PriceAlert"("userId", "commodity", "market");

-- CreateIndex
CREATE INDEX "PriceReport_status_createdAt_idx" ON "PriceReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Follow_followingId_idx" ON "Follow"("followingId");

-- CreateIndex
CREATE UNIQUE INDEX "Follow_followerId_followingId_key" ON "Follow"("followerId", "followingId");

-- CreateIndex
CREATE INDEX "MobileBookmark_userId_updatedAt_idx" ON "MobileBookmark"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MobileBookmark_userId_itemId_key" ON "MobileBookmark"("userId", "itemId");

-- CreateIndex
CREATE INDEX "MobileReaction_userId_updatedAt_idx" ON "MobileReaction"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MobileReaction_userId_itemId_kind_key" ON "MobileReaction"("userId", "itemId", "kind");

-- CreateIndex
CREATE INDEX "MobileFollow_userId_updatedAt_idx" ON "MobileFollow"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MobileFollow_userId_targetId_key" ON "MobileFollow"("userId", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "MobileDevice_token_key" ON "MobileDevice"("token");

-- CreateIndex
CREATE INDEX "MobileDevice_userId_idx" ON "MobileDevice"("userId");

-- CreateIndex
CREATE INDEX "Sponsorship_placement_active_archivedAt_startsAt_endsAt_idx" ON "Sponsorship"("placement", "active", "archivedAt", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "Sponsorship_createdAt_idx" ON "Sponsorship"("createdAt");

-- CreateIndex
CREATE INDEX "SponsorshipDailyMetric_day_idx" ON "SponsorshipDailyMetric"("day");

-- CreateIndex
CREATE INDEX "SponsorshipEvent_sponsorshipId_createdAt_idx" ON "SponsorshipEvent"("sponsorshipId", "createdAt");

-- CreateIndex
CREATE INDEX "SponsorshipEvent_createdAt_idx" ON "SponsorshipEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "_ArticleToCategory_B_index" ON "_ArticleToCategory"("B");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedArticle" ADD CONSTRAINT "SavedArticle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedArticle" ADD CONSTRAINT "SavedArticle_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementComment" ADD CONSTRAINT "AnnouncementComment_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementComment" ADD CONSTRAINT "AnnouncementComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleReaction" ADD CONSTRAINT "ArticleReaction_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleReaction" ADD CONSTRAINT "ArticleReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceAlert" ADD CONSTRAINT "PriceAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceReport" ADD CONSTRAINT "PriceReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileBookmark" ADD CONSTRAINT "MobileBookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileReaction" ADD CONSTRAINT "MobileReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileFollow" ADD CONSTRAINT "MobileFollow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileDevice" ADD CONSTRAINT "MobileDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SponsorshipDailyMetric" ADD CONSTRAINT "SponsorshipDailyMetric_sponsorshipId_fkey" FOREIGN KEY ("sponsorshipId") REFERENCES "Sponsorship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SponsorshipEvent" ADD CONSTRAINT "SponsorshipEvent_sponsorshipId_fkey" FOREIGN KEY ("sponsorshipId") REFERENCES "Sponsorship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ArticleToCategory" ADD CONSTRAINT "_ArticleToCategory_A_fkey" FOREIGN KEY ("A") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ArticleToCategory" ADD CONSTRAINT "_ArticleToCategory_B_fkey" FOREIGN KEY ("B") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
