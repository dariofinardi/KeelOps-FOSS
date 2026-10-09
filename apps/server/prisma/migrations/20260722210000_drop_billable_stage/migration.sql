-- Via la fase "Da fatturare" e il flag isBillable.
--
-- Il task per l'amministrazione ora nasce dalle fasi vinte, quindi una fase
-- dedicata alla fatturazione non serve più: le offerte che ci si trovano
-- passano a "Vinta" (anch'essa una fase vinta, quindi nessun cambio di senso).
UPDATE "Task"
SET "dealStageId" = (SELECT "id" FROM "DealStage" WHERE "isWon" = true AND "name" = 'Vinta')
WHERE "dealStageId" IN (SELECT "id" FROM "DealStage" WHERE "name" = 'Da fatturare')
  AND EXISTS (SELECT 1 FROM "DealStage" WHERE "isWon" = true AND "name" = 'Vinta');

DELETE FROM "DealStage"
WHERE "name" = 'Da fatturare'
  AND NOT EXISTS (SELECT 1 FROM "Task" WHERE "dealStageId" = "DealStage"."id");

ALTER TABLE "DealStage" DROP COLUMN "isBillable";
