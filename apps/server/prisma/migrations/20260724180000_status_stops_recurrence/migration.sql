-- Flag "interrompe la ricorrenza" sugli stati chiusi (es. "Annullato"): un'occorrenza
-- ricorrente che vi entra non avanza e resta ferma finché non la si sposta a mano.
ALTER TABLE "TaskStatus" ADD COLUMN "stopsRecurrence" BOOLEAN NOT NULL DEFAULT false;

-- Marca gli stati di annullamento seed esistenti (chiusi e chiamati "Annullato/Annullata"):
-- così il comportamento è quello atteso senza doverli riconfigurare a mano.
UPDATE "TaskStatus"
SET "stopsRecurrence" = true
WHERE "isClosed" = true AND "name" IN ('Annullato', 'Annullata');
