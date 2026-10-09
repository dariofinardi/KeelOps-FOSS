-- Segna quando è stata preparata la bacheca personale di benvenuto, così la si crea
-- una volta sola: prima, eliminando tutte le proprie board, la lettura successiva
-- dell'elenco ne ricreava una e la board sembrava non eliminabile.
ALTER TABLE "User" ADD COLUMN "boardsInitializedAt" DATETIME;

-- Chi ha già delle board personali è già stato inizializzato: senza questo, al primo
-- accesso dopo l'aggiornamento verrebbero considerati "nuovi".
UPDATE "User"
SET "boardsInitializedAt" = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "Board" WHERE "Board"."ownerId" = "User"."id");
