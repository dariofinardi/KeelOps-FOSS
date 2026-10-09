-- DealStage: configurazione del task amministrativo per le fasi vinte
-- (wonTaskStatusId = stato iniziale, wonTaskAssigneeId = assegnatario). Entrambi
-- nullable con ON DELETE SET NULL. SQLite non permette ALTER ADD COLUMN con FK,
-- quindi si ricostruisce la tabella.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DealStage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "isWon" BOOLEAN NOT NULL DEFAULT false,
    "isLost" BOOLEAN NOT NULL DEFAULT false,
    "wonTaskStatusId" TEXT,
    "wonTaskAssigneeId" TEXT,
    CONSTRAINT "DealStage_wonTaskStatusId_fkey" FOREIGN KEY ("wonTaskStatusId") REFERENCES "TaskStatus" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DealStage_wonTaskAssigneeId_fkey" FOREIGN KEY ("wonTaskAssigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_DealStage" ("color", "id", "isLost", "isWon", "name", "order") SELECT "color", "id", "isLost", "isWon", "name", "order" FROM "DealStage";
DROP TABLE "DealStage";
ALTER TABLE "new_DealStage" RENAME TO "DealStage";
CREATE UNIQUE INDEX "DealStage_name_key" ON "DealStage"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
