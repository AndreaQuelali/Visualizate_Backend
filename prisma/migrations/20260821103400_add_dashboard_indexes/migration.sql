-- Indexes used by the dashboard aggregation and the quota counters.
CREATE INDEX "pieces_workspaceId_updatedAt_idx" ON "pieces"("workspaceId", "updatedAt");
CREATE INDEX "render_jobs_workspaceId_createdAt_idx" ON "render_jobs"("workspaceId", "createdAt");
CREATE INDEX "render_jobs_workspaceId_pieceId_status_idx" ON "render_jobs"("workspaceId", "pieceId", "status");
CREATE INDEX "review_items_reviewId_status_idx" ON "review_items"("reviewId", "status");
