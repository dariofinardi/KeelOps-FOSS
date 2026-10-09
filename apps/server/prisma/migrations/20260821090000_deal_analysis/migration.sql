-- La lettura degli allegati di un'offerta vinta: una riga per offerta, con
-- dentro tutta la struttura estratta (documenti, voci, citazioni) in JSON.
CREATE TABLE "DealAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'queue',
    "model" TEXT,
    "projectName" TEXT,
    "payload" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "appliedAt" DATETIME,
    CONSTRAINT "DealAnalysis_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DealAnalysis_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DealAnalysis_dealId_key" ON "DealAnalysis"("dealId");
