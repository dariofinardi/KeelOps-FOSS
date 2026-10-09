-- Offerte ancora sugli stati Generali: passano a quelli commerciali del loro modulo.
-- (Le offerte create dopo il passaggio agli stati per categoria nascevano ancora
-- nella lista Generali: il difetto è corretto nel codice, qui si sanano i dati.)
UPDATE "Task"
SET "statusId" = COALESCE(
  (SELECT m."id" FROM "TaskStatus" m WHERE m."category" = 'SALES'
     AND m."name" = (SELECT g."name" FROM "TaskStatus" g WHERE g."id" = "Task"."statusId")),
  (SELECT m."id" FROM "TaskStatus" m WHERE m."category" = 'SALES'
     AND m."isClosed" = (SELECT g."isClosed" FROM "TaskStatus" g WHERE g."id" = "Task"."statusId")
   ORDER BY m."order" LIMIT 1),
  "statusId"
)
WHERE "kind" = 'DEAL'
  AND "statusId" IN (SELECT "id" FROM "TaskStatus" WHERE "category" = 'GENERAL');
