-- CreateTable
CREATE TABLE `TicketRead` (
    `userId` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `seenAt` DATETIME(3) NOT NULL,

    INDEX `TicketRead_taskId_idx`(`taskId`),
    PRIMARY KEY (`userId`, `taskId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TicketRead` ADD CONSTRAINT `TicketRead_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TicketRead` ADD CONSTRAINT `TicketRead_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
