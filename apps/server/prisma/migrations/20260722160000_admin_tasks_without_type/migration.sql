-- I task dello scadenzario senza tipo di attività tornano agli stati amministrativi.
--
-- La migrazione che ha introdotto gli stati per categoria assegnava a tutti i task
-- senza tipo la lista GENERAL. Ma un task dello scadenzario (kind = ADMIN), comprese
-- le occorrenze delle ricorrenze, deve nascere in "Da assegnare" e comparire nella
-- bacheca Amministrative: senza tipo di attività ora conta il modulo, non GENERAL.
--
-- Lo stato corrispondente si cerca per nome; se l'admin ha rinominato la lista si
-- ripiega sul primo stato amministrativo con lo stesso aperto/chiuso, così un task
-- chiuso resta chiuso.
UPDATE "Task"
SET "statusId" = COALESCE(
  (
    SELECT a."id" FROM "TaskStatus" a
    WHERE a."category" = 'ADMIN'
      AND a."name" = CASE (SELECT g."name" FROM "TaskStatus" g WHERE g."id" = "Task"."statusId")
        WHEN 'Da fare'    THEN 'Da assegnare'
        WHEN 'In corso'   THEN 'In esecuzione'
        WHEN 'In attesa'  THEN 'In attesa di terzi'
        WHEN 'Completato' THEN 'Completato'
        WHEN 'Annullato'  THEN 'Annullato'
      END
  ),
  (
    SELECT a."id" FROM "TaskStatus" a
    WHERE a."category" = 'ADMIN'
      AND a."isClosed" = (SELECT g."isClosed" FROM "TaskStatus" g WHERE g."id" = "Task"."statusId")
    ORDER BY a."order" LIMIT 1
  )
)
WHERE "kind" = 'ADMIN'
  AND "activityTypeId" IS NULL
  AND "statusId" IN (SELECT "id" FROM "TaskStatus" WHERE "category" = 'GENERAL')
  AND EXISTS (SELECT 1 FROM "TaskStatus" WHERE "category" = 'ADMIN');
