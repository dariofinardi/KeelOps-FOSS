-- AlterTable
ALTER TABLE `User` ADD COLUMN `emailDigest` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `Notification` ADD COLUMN `emailPending` BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX `Notification_userId_emailPending_idx` ON `Notification`(`userId`, `emailPending`);
