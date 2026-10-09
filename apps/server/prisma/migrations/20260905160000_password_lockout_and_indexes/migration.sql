-- AlterTable
ALTER TABLE "User" ADD COLUMN "failedPasswordAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "passwordLockedUntil" DATETIME;
ALTER TABLE "User" ADD COLUMN "lockoutAlertedAt" DATETIME;

-- CreateIndex
CREATE INDEX "Task_companyId_idx" ON "Task"("companyId");
CREATE INDEX "Task_updatedAt_idx" ON "Task"("updatedAt");
CREATE INDEX "TaskAttachment_attachmentId_idx" ON "TaskAttachment"("attachmentId");
CREATE INDEX "Comment_authorId_idx" ON "Comment"("authorId");
