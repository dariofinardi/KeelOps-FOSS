-- AlterTable
ALTER TABLE `Attachment` ADD COLUMN `pluginNick` VARCHAR(191) NULL,
    ADD COLUMN `pluginRef` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Group` ADD COLUMN `pluginNick` VARCHAR(191) NULL,
    ADD COLUMN `pluginRef` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Task` ADD COLUMN `pluginNick` VARCHAR(191) NULL,
    ADD COLUMN `pluginRef` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `Attachment_pluginNick_idx` ON `Attachment`(`pluginNick`);

-- CreateIndex
CREATE UNIQUE INDEX `Group_pluginNick_pluginRef_key` ON `Group`(`pluginNick`, `pluginRef`);

-- CreateIndex
CREATE INDEX `Task_pluginNick_idx` ON `Task`(`pluginNick`);
