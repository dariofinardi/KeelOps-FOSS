-- CreateTable
CREATE TABLE `ProjectReleaseDocument` (
    `projectId` VARCHAR(191) NOT NULL,
    `attachmentId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProjectReleaseDocument_attachmentId_idx`(`attachmentId`),
    PRIMARY KEY (`projectId`, `attachmentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ProjectReleaseDocument` ADD CONSTRAINT `ProjectReleaseDocument_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectReleaseDocument` ADD CONSTRAINT `ProjectReleaseDocument_attachmentId_fkey` FOREIGN KEY (`attachmentId`) REFERENCES `Attachment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
