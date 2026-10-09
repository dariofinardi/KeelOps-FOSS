-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RecurrenceTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "rrule" TEXT NOT NULL,
    "dtstart" DATETIME NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "activityTypeId" TEXT,
    "creatorId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "supervisorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RecurrenceTemplate_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "ActivityType" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RecurrenceTemplate_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecurrenceTemplate_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RecurrenceTemplate_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_RecurrenceTemplate" ("assigneeId", "createdAt", "creatorId", "description", "dtstart", "id", "isActive", "rrule", "supervisorId", "title", "updatedAt") SELECT "assigneeId", "createdAt", "creatorId", "description", "dtstart", "id", "isActive", "rrule", "supervisorId", "title", "updatedAt" FROM "RecurrenceTemplate";
DROP TABLE "RecurrenceTemplate";
ALTER TABLE "new_RecurrenceTemplate" RENAME TO "RecurrenceTemplate";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

