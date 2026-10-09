-- Righe tenute nella griglia del timesheet anche senza ore registrate.
CREATE TABLE "TimesheetPin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TimesheetPin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TimesheetPin_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TimesheetPin_userId_taskId_month_key" ON "TimesheetPin"("userId", "taskId", "month");
CREATE INDEX "TimesheetPin_userId_month_idx" ON "TimesheetPin"("userId", "month");
CREATE INDEX "TimesheetPin_taskId_idx" ON "TimesheetPin"("taskId");
