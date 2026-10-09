-- CreateTable
CREATE TABLE "Absence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "day" DATETIME NOT NULL,
    "kind" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "hours" REAL,
    "source" TEXT NOT NULL,
    "calendarKey" TEXT NOT NULL DEFAULT '',
    "title" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Absence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Absence_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Absence_day_idx" ON "Absence"("day");

-- CreateIndex
CREATE INDEX "Absence_userId_day_idx" ON "Absence"("userId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "Absence_userId_day_source_calendarKey_key" ON "Absence"("userId", "day", "source", "calendarKey");
