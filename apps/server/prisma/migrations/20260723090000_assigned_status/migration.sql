-- "Da assegnare" su task già assegnati: incoerenza da sanare.
--
-- Le occorrenze delle ricorrenze ereditano l'assegnatario dal template ma
-- nascevano nel primo stato, che nella lista amministrativa si chiama
-- "Da assegnare". Ora ogni categoria può indicare quale sia lo stato dei task
-- assegnati, e chi riceve un assegnatario mentre è nel primo stato ci passa.

ALTER TABLE "TaskStatus" ADD COLUMN "isAssignedTarget" BOOLEAN NOT NULL DEFAULT false;

-- Default sensato sulla lista amministrativa: lo stato "Assegnato", se esiste.
UPDATE "TaskStatus" SET "isAssignedTarget" = true
WHERE "category" = 'ADMIN' AND "name" = 'Assegnato';

-- Task già assegnati e fermi nel primo stato aperto della loro categoria:
-- passano allo stato dei task assegnati.
UPDATE "Task"
SET "statusId" = (
  SELECT a."id" FROM "TaskStatus" a
  WHERE a."isAssignedTarget" = true
    AND a."category" = (SELECT c."category" FROM "TaskStatus" c WHERE c."id" = "Task"."statusId")
)
WHERE "assigneeId" IS NOT NULL
  AND "statusId" IN (
    -- primo stato aperto di ogni categoria
    SELECT f."id" FROM "TaskStatus" f
    WHERE f."isClosed" = false
      AND f."order" = (
        SELECT MIN(g."order") FROM "TaskStatus" g
        WHERE g."category" = f."category" AND g."isClosed" = false
      )
  )
  AND EXISTS (
    SELECT 1 FROM "TaskStatus" a
    WHERE a."isAssignedTarget" = true
      AND a."category" = (SELECT c."category" FROM "TaskStatus" c WHERE c."id" = "Task"."statusId")
  );
