-- AlterTable
ALTER TABLE `NotificationPreference` ADD COLUMN `email` BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE `Notification` ADD COLUMN `inApp` BOOLEAN NOT NULL DEFAULT true;
