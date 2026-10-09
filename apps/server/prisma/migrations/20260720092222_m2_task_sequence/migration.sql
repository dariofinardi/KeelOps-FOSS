-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL DEFAULT 'ADMIN',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "statusId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "supervisorId" TEXT,
    "dueDate" DATETIME,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "predecessorId" TEXT,
    CONSTRAINT "Task_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "TaskStatus" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Task_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("assigneeId", "closedAt", "createdAt", "creatorId", "description", "dueDate", "id", "kind", "statusId", "supervisorId", "title", "updatedAt") SELECT "assigneeId", "closedAt", "createdAt", "creatorId", "description", "dueDate", "id", "kind", "statusId", "supervisorId", "title", "updatedAt" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_kind_statusId_idx" ON "Task"("kind", "statusId");
CREATE INDEX "Task_assigneeId_idx" ON "Task"("assigneeId");
CREATE INDEX "Task_dueDate_idx" ON "Task"("dueDate");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
