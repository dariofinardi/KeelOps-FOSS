-- Forma canonica dei task scritta dal modello locale (14/08/2026): titoli,
-- descrizioni e chat sono eterogenei, e confrontarli per parole trova poco.
ALTER TABLE "TaskIndex" ADD COLUMN "summary" TEXT;
ALTER TABLE "TaskIndex" ADD COLUMN "summaryKind" TEXT;
ALTER TABLE "TaskIndex" ADD COLUMN "summaryModel" TEXT;
