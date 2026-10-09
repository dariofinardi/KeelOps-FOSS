-- CreateTable
CREATE TABLE `TicketLock` (
    `taskId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `acquiredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `TicketLock_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`taskId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TicketLock` ADD CONSTRAINT `TicketLock_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TicketLock` ADD CONSTRAINT `TicketLock_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
