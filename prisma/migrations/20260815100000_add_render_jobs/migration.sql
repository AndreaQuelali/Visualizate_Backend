-- CreateEnum
CREATE TYPE "RenderFormat" AS ENUM ('PNG', 'PDF');

-- CreateEnum
CREATE TYPE "RenderStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "render_jobs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "pieceId" TEXT NOT NULL,
    "format" "RenderFormat" NOT NULL,
    "scale" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "status" "RenderStatus" NOT NULL DEFAULT 'QUEUED',
    "inputHash" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "inputData" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "outputObjectKey" TEXT,
    "outputBytes" INTEGER,
    "durationMs" INTEGER,
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "render_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "render_jobs_workspaceId_pieceId_createdAt_idx" ON "render_jobs"("workspaceId", "pieceId", "createdAt");

-- CreateIndex
CREATE INDEX "render_jobs_workspaceId_status_idx" ON "render_jobs"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "render_jobs_pieceId_inputHash_idx" ON "render_jobs"("pieceId", "inputHash");

-- AddForeignKey
ALTER TABLE "render_jobs" ADD CONSTRAINT "render_jobs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "render_jobs" ADD CONSTRAINT "render_jobs_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "pieces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

