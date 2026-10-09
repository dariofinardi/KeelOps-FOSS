-- Chi sta gestendo una richiesta, adesso: una riga per task, quindi «uno solo»
-- è una garanzia del database e non una speranza. Una riga scaduta vale come
-- assente, perciò non serve nessuna pulizia perché il lavoro riprenda.
CREATE TABLE "TicketLock" (
    "taskId" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "acquiredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "TicketLock_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TicketLock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TicketLock_expiresAt_idx" ON "TicketLock"("expiresAt");
