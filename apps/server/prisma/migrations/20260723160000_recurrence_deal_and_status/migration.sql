-- Ricorrenze amministrative: riferimento a un'offerta (invece del progetto) e
-- stato iniziale configurabile delle occorrenze generate.
ALTER TABLE "RecurrenceTemplate" ADD COLUMN "relatedDealId" TEXT;
ALTER TABLE "RecurrenceTemplate" ADD COLUMN "initialStatusId" TEXT;
