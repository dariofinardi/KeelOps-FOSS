-- Ogni modulo lavora con la propria lista di stati: progetti → sviluppo,
-- offerte → commerciali, scadenzario → amministrativi, ticket → generali.
--
-- I task di progetto e le offerte senza tipo di attività erano rimasti sugli stati
-- GENERAL: qui passano alla lista del loro modulo, mantenendo aperto/chiuso e, dove
-- esiste, lo stato con lo stesso nome ("Da fare" resta "Da fare").
UPDATE "Task"
SET "statusId" = COALESCE(
  (
    SELECT m."id" FROM "TaskStatus" m
    WHERE m."category" = CASE "Task"."kind" WHEN 'PROJECT' THEN 'DEV' ELSE 'SALES' END
      AND m."name" = (SELECT g."name" FROM "TaskStatus" g WHERE g."id" = "Task"."statusId")
  ),
  (
    SELECT m."id" FROM "TaskStatus" m
    WHERE m."category" = CASE "Task"."kind" WHEN 'PROJECT' THEN 'DEV' ELSE 'SALES' END
      AND m."isClosed" = (SELECT g."isClosed" FROM "TaskStatus" g WHERE g."id" = "Task"."statusId")
    ORDER BY m."order" LIMIT 1
  ),
  "statusId"
)
WHERE "kind" IN ('PROJECT', 'DEAL')
  AND "activityTypeId" IS NULL
  AND "statusId" IN (SELECT "id" FROM "TaskStatus" WHERE "category" = 'GENERAL');
