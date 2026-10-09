-- AlterTable
ALTER TABLE `ProjectReleaseDocument` ADD COLUMN `description` TEXT NULL,
    ADD COLUMN `isVisible` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `publishedAt` DATETIME(3) NOT NULL,
    ADD COLUMN `title` VARCHAR(255) NOT NULL;

-- CreateIndex
CREATE INDEX `ProjectReleaseDocument_projectId_isVisible_publishedAt_idx` ON `ProjectReleaseDocument`(`projectId`, `isVisible`, `publishedAt`);
