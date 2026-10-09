-- AlterTable
ALTER TABLE `User` ADD COLUMN `failedPasswordAttempts` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `lockoutAlertedAt` DATETIME(3) NULL,
    ADD COLUMN `passwordLockedUntil` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `Task_updatedAt_idx` ON `Task`(`updatedAt`);

-- CreateIndex
-- (su MariaDB l'indice implicito della chiave esterna, `<tabella>_<colonna>_fkey`,
-- sparisce da sé appena ne esiste uno esplicito che la copre: non si DROPpa)
CREATE INDEX `Comment_authorId_idx` ON `Comment`(`authorId`);

-- CreateIndex
CREATE INDEX `Task_companyId_idx` ON `Task`(`companyId`);

-- CreateIndex
CREATE INDEX `TaskAttachment_attachmentId_idx` ON `TaskAttachment`(`attachmentId`);
