-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'MEMBER',
    `authProvider` VARCHAR(191) NOT NULL DEFAULT 'LOCAL',
    `googleId` VARCHAR(191) NULL,
    `companyId` VARCHAR(191) NULL,
    `passwordHash` VARCHAR(191) NULL,
    `mustChangePassword` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `lastLoginAt` DATETIME(3) NULL,
    `adminUntil` DATETIME(3) NULL,
    `lastSeenAt` DATETIME(3) NULL,
    `isSystem` BOOLEAN NOT NULL DEFAULT false,
    `avatarUrl` VARCHAR(1000) NULL,
    `nickName` VARCHAR(191) NULL,
    `accentColor` VARCHAR(191) NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'EUR',
    `locale` VARCHAR(191) NOT NULL DEFAULT 'auto',
    `theme` VARCHAR(191) NOT NULL DEFAULT 'light',
    `canViewAllTimesheets` BOOLEAN NOT NULL DEFAULT false,
    `boardsInitializedAt` DATETIME(3) NULL,
    `projectOrder` TEXT NULL,
    `columnOrder` TEXT NULL,
    `weeklyHours` INTEGER NOT NULL DEFAULT 40,
    `calendarAliases` TEXT NULL,
    `billingAssigneeId` VARCHAR(191) NULL,
    `calendarToken` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    UNIQUE INDEX `User_googleId_key`(`googleId`),
    UNIQUE INDEX `User_calendarToken_key`(`calendarToken`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PendingInlineImage` (
    `id` VARCHAR(191) NOT NULL,
    `ext` VARCHAR(191) NOT NULL,
    `uploadedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PendingInlineImage_uploadedById_idx`(`uploadedById`),
    INDEX `PendingInlineImage_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PushSubscription` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `endpoint` VARCHAR(512) NOT NULL,
    `p256dh` VARCHAR(191) NOT NULL,
    `auth` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PushSubscription_endpoint_key`(`endpoint`),
    INDEX `PushSubscription_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppSetting` (
    `key` VARCHAR(191) NOT NULL,
    `value` TEXT NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TimesheetLock` (
    `month` VARCHAR(191) NOT NULL,
    `lockedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lockedById` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`month`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Group` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `managedArea` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Group_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VisibilitySetting` (
    `scope` VARCHAR(191) NOT NULL,
    `groupId` VARCHAR(191) NOT NULL,
    `access` VARCHAR(191) NOT NULL DEFAULT 'FULL',

    PRIMARY KEY (`scope`, `groupId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GroupMember` (
    `groupId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `isManager` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`groupId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuthChallenge` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuthChallenge_userId_type_idx`(`userId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Session_userId_idx`(`userId`),
    INDEX `Session_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TaskStatus` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL DEFAULT 'GENERAL',
    `color` VARCHAR(191) NOT NULL,
    `order` INTEGER NOT NULL,
    `isClosed` BOOLEAN NOT NULL DEFAULT false,
    `isWonTarget` BOOLEAN NOT NULL DEFAULT false,
    `isAssignedTarget` BOOLEAN NOT NULL DEFAULT false,
    `stopsRecurrence` BOOLEAN NOT NULL DEFAULT false,
    `isBillingMilestone` BOOLEAN NOT NULL DEFAULT false,
    `wipLimit` INTEGER NULL,

    UNIQUE INDEX `TaskStatus_category_name_key`(`category`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ActivityType` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `color` VARCHAR(191) NOT NULL,
    `order` INTEGER NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isMeeting` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `ActivityType_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Task` (
    `id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL DEFAULT 'ADMIN',
    `title` VARCHAR(500) NOT NULL,
    `description` LONGTEXT NULL,
    `statusId` VARCHAR(191) NULL,
    `boardId` VARCHAR(191) NULL,
    `boardStatusId` VARCHAR(191) NULL,
    `activityTypeId` VARCHAR(191) NULL,
    `creatorId` VARCHAR(191) NOT NULL,
    `assigneeId` VARCHAR(191) NULL,
    `supervisorId` VARCHAR(191) NULL,
    `dueDate` DATETIME(3) NULL,
    `dueTime` VARCHAR(191) NULL,
    `closedAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `archivedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `projectId` VARCHAR(191) NULL,
    `parentTaskId` VARCHAR(191) NULL,
    `predecessorId` VARCHAR(191) NULL,
    `recurrenceTemplateId` VARCHAR(191) NULL,
    `occurrenceDate` DATETIME(3) NULL,
    `dealStageId` VARCHAR(191) NULL,
    `dealValue` DOUBLE NULL,
    `probability` INTEGER NULL,
    `expectedCloseDate` DATETIME(3) NULL,
    `contactId` VARCHAR(191) NULL,
    `companyId` VARCHAR(191) NULL,
    `visibleToSalesMonitors` BOOLEAN NOT NULL DEFAULT false,
    `lostReason` TEXT NULL,
    `ticketPriority` VARCHAR(191) NULL,
    `ticketRef` VARCHAR(191) NULL,
    `createdViaTicket` BOOLEAN NOT NULL DEFAULT false,
    `sourceDealId` VARCHAR(191) NULL,
    `relatedDealId` VARCHAR(191) NULL,
    `relatedProjectId` VARCHAR(191) NULL,
    `meetingId` VARCHAR(191) NULL,
    `participants` TEXT NULL,

    UNIQUE INDEX `Task_sourceDealId_key`(`sourceDealId`),
    INDEX `Task_kind_statusId_idx`(`kind`, `statusId`),
    INDEX `Task_assigneeId_idx`(`assigneeId`),
    INDEX `Task_dueDate_idx`(`dueDate`),
    INDEX `Task_deletedAt_idx`(`deletedAt`),
    INDEX `Task_projectId_idx`(`projectId`),
    INDEX `Task_parentTaskId_idx`(`parentTaskId`),
    INDEX `Task_supervisorId_idx`(`supervisorId`),
    INDEX `Task_creatorId_idx`(`creatorId`),
    INDEX `Task_predecessorId_idx`(`predecessorId`),
    INDEX `Task_boardId_idx`(`boardId`),
    INDEX `Task_boardStatusId_idx`(`boardStatusId`),
    INDEX `Task_contactId_idx`(`contactId`),
    INDEX `Task_dealStageId_idx`(`dealStageId`),
    UNIQUE INDEX `Task_recurrenceTemplateId_occurrenceDate_key`(`recurrenceTemplateId`, `occurrenceDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Project` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `color` VARCHAR(191) NULL,
    `icon` VARCHAR(191) NULL,
    `isArchived` BOOLEAN NOT NULL DEFAULT false,
    `companyId` VARCHAR(191) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PortalProjectAccess` (
    `userId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PortalProjectAccess_projectId_idx`(`projectId`),
    PRIMARY KEY (`userId`, `projectId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProjectMember` (
    `projectId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`projectId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `payload` TEXT NOT NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Notification_userId_readAt_idx`(`userId`, `readAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NotificationPreference` (
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`userId`, `type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TimeEntry` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `hours` DOUBLE NOT NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TimeEntry_userId_date_idx`(`userId`, `date`),
    INDEX `TimeEntry_taskId_idx`(`taskId`),
    UNIQUE INDEX `TimeEntry_userId_taskId_date_key`(`userId`, `taskId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TimesheetPin` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `month` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TimesheetPin_userId_month_idx`(`userId`, `month`),
    INDEX `TimesheetPin_taskId_idx`(`taskId`),
    UNIQUE INDEX `TimesheetPin_userId_taskId_month_key`(`userId`, `taskId`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DealAnalysis` (
    `id` VARCHAR(191) NOT NULL,
    `dealId` VARCHAR(191) NOT NULL,
    `requestedById` VARCHAR(191) NOT NULL,
    `state` VARCHAR(191) NOT NULL DEFAULT 'queue',
    `model` VARCHAR(191) NULL,
    `projectName` VARCHAR(191) NULL,
    `payload` LONGTEXT NULL,
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,
    `appliedAt` DATETIME(3) NULL,

    UNIQUE INDEX `DealAnalysis_dealId_key`(`dealId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DealStage` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `color` VARCHAR(191) NOT NULL,
    `order` INTEGER NOT NULL,
    `isWon` BOOLEAN NOT NULL DEFAULT false,
    `isLost` BOOLEAN NOT NULL DEFAULT false,
    `wonTaskStatusId` VARCHAR(191) NULL,
    `wonTaskAssigneeId` VARCHAR(191) NULL,

    UNIQUE INDEX `DealStage_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Company` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `vatNumber` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Company_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Contact` (
    `id` VARCHAR(191) NOT NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `roleTitle` VARCHAR(191) NULL,
    `companyId` VARCHAR(191) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Contact_companyId_idx`(`companyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CrmNote` (
    `id` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NULL,
    `companyId` VARCHAR(191) NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RecurrenceTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(500) NOT NULL,
    `description` TEXT NULL,
    `rrule` VARCHAR(500) NOT NULL,
    `dtstart` DATETIME(3) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `projectId` VARCHAR(191) NULL,
    `relatedDealId` VARCHAR(191) NULL,
    `initialStatusId` VARCHAR(191) NULL,
    `activityTypeId` VARCHAR(191) NULL,
    `creatorId` VARCHAR(191) NOT NULL,
    `assigneeId` VARCHAR(191) NULL,
    `supervisorId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RecurrenceTemplateAttachment` (
    `templateId` VARCHAR(191) NOT NULL,
    `attachmentId` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`templateId`, `attachmentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Attachment` (
    `id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `name` VARCHAR(500) NOT NULL,
    `path` VARCHAR(768) NULL,
    `url` VARCHAR(1000) NULL,
    `mimeType` VARCHAR(191) NULL,
    `size` INTEGER NULL,
    `uploadedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TaskAttachment` (
    `taskId` VARCHAR(191) NOT NULL,
    `attachmentId` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`taskId`, `attachmentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Comment` (
    `id` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `secret` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `meetingId` VARCHAR(191) NULL,

    INDEX `Comment_taskId_idx`(`taskId`),
    INDEX `Comment_meetingId_idx`(`meetingId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Tag` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `color` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Tag_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TaskTag` (
    `taskId` VARCHAR(191) NOT NULL,
    `tagId` VARCHAR(191) NOT NULL,

    INDEX `TaskTag_tagId_idx`(`tagId`),
    PRIMARY KEY (`taskId`, `tagId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ActivityLog` (
    `id` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `payload` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ActivityLog_taskId_idx`(`taskId`),
    INDEX `ActivityLog_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CalendarFeed` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `scope` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NULL,
    `label` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `lastReadAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CalendarFeed_token_key`(`token`),
    INDEX `CalendarFeed_userId_idx`(`userId`),
    UNIQUE INDEX `CalendarFeed_userId_scope_targetId_key`(`userId`, `scope`, `targetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Board` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Board_ownerId_idx`(`ownerId`),
    UNIQUE INDEX `Board_ownerId_name_key`(`ownerId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BoardStatus` (
    `id` VARCHAR(191) NOT NULL,
    `boardId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `color` VARCHAR(191) NOT NULL,
    `order` INTEGER NOT NULL,
    `isInitial` BOOLEAN NOT NULL DEFAULT false,
    `isClosed` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `BoardStatus_boardId_name_key`(`boardId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ApiClient` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `secretHash` VARCHAR(191) NOT NULL,
    `secretHint` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `lastUsedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ApiClient_clientId_key`(`clientId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TaskIndex` (
    `taskId` VARCHAR(191) NOT NULL,
    `text` LONGTEXT NOT NULL,
    `summary` TEXT NULL,
    `summaryKind` VARCHAR(191) NULL,
    `summaryModel` VARCHAR(191) NULL,
    `hours` DOUBLE NOT NULL DEFAULT 0,
    `workers` INTEGER NOT NULL DEFAULT 0,
    `projectId` VARCHAR(191) NULL,
    `activityTypeId` VARCHAR(191) NULL,
    `embedding` LONGBLOB NULL,
    `embeddingModel` VARCHAR(191) NULL,
    `isReference` BOOLEAN NOT NULL DEFAULT false,
    `sourceUpdatedAt` DATETIME(3) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TaskIndex_isReference_idx`(`isReference`),
    PRIMARY KEY (`taskId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_billingAssigneeId_fkey` FOREIGN KEY (`billingAssigneeId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PendingInlineImage` ADD CONSTRAINT `PendingInlineImage_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PushSubscription` ADD CONSTRAINT `PushSubscription_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TimesheetLock` ADD CONSTRAINT `TimesheetLock_lockedById_fkey` FOREIGN KEY (`lockedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VisibilitySetting` ADD CONSTRAINT `VisibilitySetting_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `Group`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GroupMember` ADD CONSTRAINT `GroupMember_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `Group`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GroupMember` ADD CONSTRAINT `GroupMember_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuthChallenge` ADD CONSTRAINT `AuthChallenge_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_statusId_fkey` FOREIGN KEY (`statusId`) REFERENCES `TaskStatus`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_boardId_fkey` FOREIGN KEY (`boardId`) REFERENCES `Board`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_boardStatusId_fkey` FOREIGN KEY (`boardStatusId`) REFERENCES `BoardStatus`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_activityTypeId_fkey` FOREIGN KEY (`activityTypeId`) REFERENCES `ActivityType`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_creatorId_fkey` FOREIGN KEY (`creatorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_assigneeId_fkey` FOREIGN KEY (`assigneeId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_supervisorId_fkey` FOREIGN KEY (`supervisorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_parentTaskId_fkey` FOREIGN KEY (`parentTaskId`) REFERENCES `Task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_predecessorId_fkey` FOREIGN KEY (`predecessorId`) REFERENCES `Task`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_recurrenceTemplateId_fkey` FOREIGN KEY (`recurrenceTemplateId`) REFERENCES `RecurrenceTemplate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_dealStageId_fkey` FOREIGN KEY (`dealStageId`) REFERENCES `DealStage`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_sourceDealId_fkey` FOREIGN KEY (`sourceDealId`) REFERENCES `Task`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_relatedDealId_fkey` FOREIGN KEY (`relatedDealId`) REFERENCES `Task`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_relatedProjectId_fkey` FOREIGN KEY (`relatedProjectId`) REFERENCES `Project`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_meetingId_fkey` FOREIGN KEY (`meetingId`) REFERENCES `Task`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Project` ADD CONSTRAINT `Project_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PortalProjectAccess` ADD CONSTRAINT `PortalProjectAccess_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PortalProjectAccess` ADD CONSTRAINT `PortalProjectAccess_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectMember` ADD CONSTRAINT `ProjectMember_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectMember` ADD CONSTRAINT `ProjectMember_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NotificationPreference` ADD CONSTRAINT `NotificationPreference_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TimeEntry` ADD CONSTRAINT `TimeEntry_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TimeEntry` ADD CONSTRAINT `TimeEntry_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TimesheetPin` ADD CONSTRAINT `TimesheetPin_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TimesheetPin` ADD CONSTRAINT `TimesheetPin_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DealAnalysis` ADD CONSTRAINT `DealAnalysis_dealId_fkey` FOREIGN KEY (`dealId`) REFERENCES `Task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DealAnalysis` ADD CONSTRAINT `DealAnalysis_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DealStage` ADD CONSTRAINT `DealStage_wonTaskStatusId_fkey` FOREIGN KEY (`wonTaskStatusId`) REFERENCES `TaskStatus`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DealStage` ADD CONSTRAINT `DealStage_wonTaskAssigneeId_fkey` FOREIGN KEY (`wonTaskAssigneeId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Contact` ADD CONSTRAINT `Contact_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CrmNote` ADD CONSTRAINT `CrmNote_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CrmNote` ADD CONSTRAINT `CrmNote_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CrmNote` ADD CONSTRAINT `CrmNote_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecurrenceTemplate` ADD CONSTRAINT `RecurrenceTemplate_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecurrenceTemplate` ADD CONSTRAINT `RecurrenceTemplate_relatedDealId_fkey` FOREIGN KEY (`relatedDealId`) REFERENCES `Task`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecurrenceTemplate` ADD CONSTRAINT `RecurrenceTemplate_initialStatusId_fkey` FOREIGN KEY (`initialStatusId`) REFERENCES `TaskStatus`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecurrenceTemplate` ADD CONSTRAINT `RecurrenceTemplate_activityTypeId_fkey` FOREIGN KEY (`activityTypeId`) REFERENCES `ActivityType`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecurrenceTemplate` ADD CONSTRAINT `RecurrenceTemplate_creatorId_fkey` FOREIGN KEY (`creatorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecurrenceTemplate` ADD CONSTRAINT `RecurrenceTemplate_assigneeId_fkey` FOREIGN KEY (`assigneeId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecurrenceTemplate` ADD CONSTRAINT `RecurrenceTemplate_supervisorId_fkey` FOREIGN KEY (`supervisorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecurrenceTemplateAttachment` ADD CONSTRAINT `RecurrenceTemplateAttachment_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `RecurrenceTemplate`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecurrenceTemplateAttachment` ADD CONSTRAINT `RecurrenceTemplateAttachment_attachmentId_fkey` FOREIGN KEY (`attachmentId`) REFERENCES `Attachment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Attachment` ADD CONSTRAINT `Attachment_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TaskAttachment` ADD CONSTRAINT `TaskAttachment_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TaskAttachment` ADD CONSTRAINT `TaskAttachment_attachmentId_fkey` FOREIGN KEY (`attachmentId`) REFERENCES `Attachment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Comment` ADD CONSTRAINT `Comment_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Comment` ADD CONSTRAINT `Comment_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Comment` ADD CONSTRAINT `Comment_meetingId_fkey` FOREIGN KEY (`meetingId`) REFERENCES `Task`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TaskTag` ADD CONSTRAINT `TaskTag_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TaskTag` ADD CONSTRAINT `TaskTag_tagId_fkey` FOREIGN KEY (`tagId`) REFERENCES `Tag`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityLog` ADD CONSTRAINT `ActivityLog_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityLog` ADD CONSTRAINT `ActivityLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CalendarFeed` ADD CONSTRAINT `CalendarFeed_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Board` ADD CONSTRAINT `Board_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BoardStatus` ADD CONSTRAINT `BoardStatus_boardId_fkey` FOREIGN KEY (`boardId`) REFERENCES `Board`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApiClient` ADD CONSTRAINT `ApiClient_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TaskIndex` ADD CONSTRAINT `TaskIndex_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

