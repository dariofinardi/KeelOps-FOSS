-- Figure incollate in una descrizione non ancora salvata (14/08/2026): vivono
-- in <uploads>/_pending/ finché il record non esiste, poi traslocano accanto a
-- lui. Quelle rimaste (descrizione mai salvata) le spazza il cron notturno.
CREATE TABLE "PendingInlineImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ext" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PendingInlineImage_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PendingInlineImage_uploadedById_idx" ON "PendingInlineImage"("uploadedById");
CREATE INDEX "PendingInlineImage_createdAt_idx" ON "PendingInlineImage"("createdAt");
