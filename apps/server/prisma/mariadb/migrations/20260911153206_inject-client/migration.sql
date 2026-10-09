-- CreateTable
CREATE TABLE `InjectClient` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `publicKey` VARCHAR(191) NOT NULL,
    `origins` TEXT NOT NULL,
    `serviceUserId` VARCHAR(191) NOT NULL,
    `replyTo` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `hourlyLimit` INTEGER NOT NULL DEFAULT 20,
    `lastUsedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `InjectClient_publicKey_key`(`publicKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InjectRequestType` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `icon` VARCHAR(191) NOT NULL DEFAULT 'help',
    `projectId` VARCHAR(191) NOT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `InjectRequestType_clientId_key_key`(`clientId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `InjectClient` ADD CONSTRAINT `InjectClient_serviceUserId_fkey` FOREIGN KEY (`serviceUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InjectClient` ADD CONSTRAINT `InjectClient_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InjectRequestType` ADD CONSTRAINT `InjectRequestType_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `InjectClient`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InjectRequestType` ADD CONSTRAINT `InjectRequestType_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
