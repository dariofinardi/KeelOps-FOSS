-- AlterTable
ALTER TABLE "Task" ADD COLUMN "lostReason" TEXT;

-- CreateTable
CREATE TABLE "TimesheetLock" (
    "month" TEXT NOT NULL PRIMARY KEY,
    "lockedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedById" TEXT NOT NULL,
    CONSTRAINT "TimesheetLock_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
