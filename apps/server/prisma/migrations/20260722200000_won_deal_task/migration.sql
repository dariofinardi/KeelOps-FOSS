-- Offerta vinta → task per l'amministrazione.
--
-- Due ingredienti: lo stato in cui il task nasce (contrassegnato dall'admin) e
-- l'amministrativo di riferimento di ogni commerciale, a cui il task viene assegnato.

ALTER TABLE "TaskStatus" ADD COLUMN "isWonTarget" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "billingAssigneeId" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "User_billingAssigneeId_idx" ON "User"("billingAssigneeId");

-- Stati di destinazione richiesti: fatture una tantum e canoni ricorrenti.
-- Creati in coda alla lista amministrativa (riordinabili dalla pagina Stati).
INSERT INTO "TaskStatus" ("id", "name", "category", "color", "order", "isClosed", "isWonTarget")
SELECT * FROM (
  SELECT 'sts_adm_fatture_da_emettere' AS id, 'Fatture da emettere' AS name, 'ADMIN' AS category,
         '#0ea5e9' AS color,
         (SELECT COALESCE(MAX("order"), -1) + 1 FROM "TaskStatus" WHERE "category" = 'ADMIN') AS "order",
         0 AS "isClosed", 1 AS "isWonTarget"
  UNION ALL
  SELECT 'sts_adm_canoni_ricorrenti', 'Canoni e fatture ricorrenti', 'ADMIN', '#8b5cf6',
         (SELECT COALESCE(MAX("order"), -1) + 2 FROM "TaskStatus" WHERE "category" = 'ADMIN'),
         0, 0
)
WHERE NOT EXISTS (
  SELECT 1 FROM "TaskStatus" WHERE "category" = 'ADMIN' AND "name" = 'Fatture da emettere'
);
