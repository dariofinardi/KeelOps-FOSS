-- CreateTable
CREATE TABLE "TicketRead" (
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "seenAt" DATETIME NOT NULL,

    PRIMARY KEY ("userId", "taskId"),
    CONSTRAINT "TicketRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TicketRead_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TicketRead_taskId_idx" ON "TicketRead"("taskId");

