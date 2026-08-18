-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReviewCategory" AS ENUM ('LEGIBILITY', 'COMPOSITION', 'CONTENT', 'BRAND');

-- CreateEnum
CREATE TYPE "ReviewSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ReviewSource" AS ENUM ('RULE', 'AI');

-- CreateEnum
CREATE TYPE "ReviewItemStatus" AS ENUM ('PENDING', 'APPLIED', 'DISMISSED', 'STALE');

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "aiReviewEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "pieces" ADD COLUMN     "overrides" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "render_jobs" ADD COLUMN     "inputOverrides" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "pieceId" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'QUEUED',
    "aiStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "summary" TEXT,
    "model" TEXT,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "errorMessage" TEXT,
    "snapshotHash" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_items" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "category" "ReviewCategory" NOT NULL,
    "severity" "ReviewSeverity" NOT NULL,
    "source" "ReviewSource" NOT NULL,
    "title" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "target" JSONB,
    "patch" JSONB,
    "status" "ReviewItemStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reviews_workspaceId_pieceId_createdAt_idx" ON "reviews"("workspaceId", "pieceId", "createdAt");

-- CreateIndex
CREATE INDEX "reviews_workspaceId_createdAt_idx" ON "reviews"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "review_items_reviewId_idx" ON "review_items"("reviewId");

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "pieces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

