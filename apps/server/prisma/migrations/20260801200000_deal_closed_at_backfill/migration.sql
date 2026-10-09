-- Data di chiusura effettiva delle offerte già concluse.
--
-- La colonna "closedAt" esiste da sempre sui task, ma per le offerte non veniva
-- riempita: la chiusura di una trattativa è un cambio di fase, non un cambio di
-- stato. Da ora la scrive il passaggio in una fase vinta o persa; qui si recupera
-- lo storico, prendendo l'ultimo cambio di fase registrato nel diario attività.
--
-- Le offerte concluse prima che il diario esistesse restano senza data: chi legge
-- ricade sulla chiusura prevista, che è il comportamento di prima.
UPDATE "Task"
SET "closedAt" = (
  SELECT MAX("ActivityLog"."createdAt")
  FROM "ActivityLog"
  WHERE "ActivityLog"."taskId" = "Task"."id"
    AND "ActivityLog"."action" = 'stage_changed'
)
WHERE "kind" = 'DEAL'
  AND "closedAt" IS NULL
  AND "dealStageId" IN (SELECT "id" FROM "DealStage" WHERE "isWon" = 1 OR "isLost" = 1);
