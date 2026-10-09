-- AlterTable
ALTER TABLE `Notification` ADD COLUMN `dedupKey` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Notification_dedupKey_key` ON `Notification`(`dedupKey`);
