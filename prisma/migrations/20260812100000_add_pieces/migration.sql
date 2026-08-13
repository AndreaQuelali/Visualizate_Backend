-- CreateEnum
CREATE TYPE "PieceStatus" AS ENUM ('DRAFT', 'READY', 'ARCHIVED');

-- CreateTable
CREATE TABLE "pieces" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "status" "PieceStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pieces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pieces_workspaceId_status_idx" ON "pieces"("workspaceId", "status");

-- AddForeignKey
ALTER TABLE "pieces" ADD CONSTRAINT "pieces_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pieces" ADD CONSTRAINT "pieces_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pieces" ADD CONSTRAINT "pieces_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

