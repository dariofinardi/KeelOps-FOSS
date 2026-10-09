-- CreateTable
CREATE TABLE `Absence` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `day` DATETIME(3) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `hours` DOUBLE NULL,
    `source` VARCHAR(191) NOT NULL,
    `calendarKey` VARCHAR(191) NOT NULL DEFAULT '',
    `title` VARCHAR(191) NULL,
    `note` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Absence_day_idx`(`day`),
    INDEX `Absence_userId_day_idx`(`userId`, `day`),
    UNIQUE INDEX `Absence_userId_day_source_calendarKey_key`(`userId`, `day`, `source`, `calendarKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Absence` ADD CONSTRAINT `Absence_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Absence` ADD CONSTRAINT `Absence_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
