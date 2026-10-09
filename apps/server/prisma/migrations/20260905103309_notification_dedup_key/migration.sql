-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "dedupKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupKey_key" ON "Notification"("dedupKey");
