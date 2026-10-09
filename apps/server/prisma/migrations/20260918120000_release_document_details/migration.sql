-- Titolo, descrizione, data di pubblicazione e visibilità delle note di
-- rilascio del portale. SQLite non aggiunge una colonna NOT NULL senza
-- valore predefinito: la tabella si riscrive, come fa Prisma.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProjectReleaseDocument" (
    "projectId" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "publishedAt" DATETIME NOT NULL,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("projectId", "attachmentId"),
    CONSTRAINT "ProjectReleaseDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectReleaseDocument_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- Le righe già caricate (se ce ne sono) prendono il nome del file e la data di caricamento.
INSERT INTO "new_ProjectReleaseDocument" ("projectId", "attachmentId", "title", "publishedAt", "createdAt")
SELECT d."projectId", d."attachmentId", a."name", d."createdAt", d."createdAt"
FROM "ProjectReleaseDocument" d JOIN "Attachment" a ON a."id" = d."attachmentId";
DROP TABLE "ProjectReleaseDocument";
ALTER TABLE "new_ProjectReleaseDocument" RENAME TO "ProjectReleaseDocument";
CREATE INDEX "ProjectReleaseDocument_attachmentId_idx" ON "ProjectReleaseDocument"("attachmentId");
CREATE INDEX "ProjectReleaseDocument_projectId_isVisible_publishedAt_idx" ON "ProjectReleaseDocument"("projectId", "isVisible", "publishedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
