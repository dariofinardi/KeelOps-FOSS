-- CreateTable
CREATE TABLE `CommentAttachment` (
    `commentId` VARCHAR(191) NOT NULL,
    `attachmentId` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`commentId`, `attachmentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CommentAttachment` ADD CONSTRAINT `CommentAttachment_commentId_fkey` FOREIGN KEY (`commentId`) REFERENCES `Comment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CommentAttachment` ADD CONSTRAINT `CommentAttachment_attachmentId_fkey` FOREIGN KEY (`attachmentId`) REFERENCES `Attachment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
