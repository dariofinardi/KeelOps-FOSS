-- Task PERSONAL/di board: statusId reso opzionale, aggiunti boardId e boardStatusId.
-- Rebuild generato con prisma migrate diff (dati preservati, indici ricreati).

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL DEFAULT 'ADMIN',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "statusId" TEXT,
    "boardId" TEXT,
    "boardStatusId" TEXT,
    "activityTypeId" TEXT,
    "creatorId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "supervisorId" TEXT,
    "dueDate" DATETIME,
    "dueTime" TEXT,
    "closedAt" DATETIME,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "projectId" TEXT,
    "parentTaskId" TEXT,
    "predecessorId" TEXT,
    "recurrenceTemplateId" TEXT,
    "occurrenceDate" DATETIME,
    "dealStageId" TEXT,
    "dealValue" REAL,
    "probability" INTEGER,
    "expectedCloseDate" DATETIME,
    "contactId" TEXT,
    "companyId" TEXT,
    "lostReason" TEXT,
    "ticketPriority" TEXT,
    "ticketRef" TEXT,
    "sourceDealId" TEXT,
    "relatedDealId" TEXT,
    "relatedProjectId" TEXT,
    "meetingId" TEXT,
    "participants" TEXT,
    CONSTRAINT "Task_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "TaskStatus" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_boardStatusId_fkey" FOREIGN KEY ("boardStatusId") REFERENCES "BoardStatus" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "ActivityType" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_recurrenceTemplateId_fkey" FOREIGN KEY ("recurrenceTemplateId") REFERENCES "RecurrenceTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_dealStageId_fkey" FOREIGN KEY ("dealStageId") REFERENCES "DealStage" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_sourceDealId_fkey" FOREIGN KEY ("sourceDealId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_relatedDealId_fkey" FOREIGN KEY ("relatedDealId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_relatedProjectId_fkey" FOREIGN KEY ("relatedProjectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("activityTypeId", "assigneeId", "closedAt", "companyId", "contactId", "createdAt", "creatorId", "dealStageId", "dealValue", "deletedAt", "description", "dueDate", "dueTime", "expectedCloseDate", "id", "kind", "lostReason", "meetingId", "occurrenceDate", "parentTaskId", "participants", "predecessorId", "probability", "projectId", "recurrenceTemplateId", "relatedDealId", "relatedProjectId", "sourceDealId", "statusId", "supervisorId", "ticketPriority", "ticketRef", "title", "updatedAt") SELECT "activityTypeId", "assigneeId", "closedAt", "companyId", "contactId", "createdAt", "creatorId", "dealStageId", "dealValue", "deletedAt", "description", "dueDate", "dueTime", "expectedCloseDate", "id", "kind", "lostReason", "meetingId", "occurrenceDate", "parentTaskId", "participants", "predecessorId", "probability", "projectId", "recurrenceTemplateId", "relatedDealId", "relatedProjectId", "sourceDealId", "statusId", "supervisorId", "ticketPriority", "ticketRef", "title", "updatedAt" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE UNIQUE INDEX "Task_sourceDealId_key" ON "Task"("sourceDealId");
CREATE INDEX "Task_kind_statusId_idx" ON "Task"("kind", "statusId");
CREATE INDEX "Task_assigneeId_idx" ON "Task"("assigneeId");
CREATE INDEX "Task_dueDate_idx" ON "Task"("dueDate");
CREATE UNIQUE INDEX "Task_recurrenceTemplateId_occurrenceDate_key" ON "Task"("recurrenceTemplateId", "occurrenceDate");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

