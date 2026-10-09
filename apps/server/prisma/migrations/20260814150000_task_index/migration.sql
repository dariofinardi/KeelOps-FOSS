-- Indice di riferimento per la stima della durata (14/08/2026): una riga per
-- task, con il testo normalizzato e le ore che quel lavoro è costato davvero.
CREATE TABLE "TaskIndex" (
    "taskId" TEXT NOT NULL PRIMARY KEY,
    "text" TEXT NOT NULL,
    "hours" REAL NOT NULL DEFAULT 0,
    "workers" INTEGER NOT NULL DEFAULT 0,
    "projectId" TEXT,
    "activityTypeId" TEXT,
    "embedding" BLOB,
    "embeddingModel" TEXT,
    "isReference" BOOLEAN NOT NULL DEFAULT false,
    "sourceUpdatedAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskIndex_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TaskIndex_isReference_idx" ON "TaskIndex"("isReference");
