-- Ultima attività: diverso dall'ultimo accesso.
--
-- `lastLoginAt` dice quando si è autenticato; la sessione però dura giorni, e
-- chi non esce mai risulterebbe fermo pur usando l'applicazione ogni mattina.
-- `lastSeenAt` si aggiorna a ogni richiesta (con parsimonia, vedi plugins/auth)
-- e risponde alla domanda vera: "questa persona lo sta usando?".
ALTER TABLE "User" ADD COLUMN "lastSeenAt" DATETIME;

-- Punto di partenza: quello che si sa già.
UPDATE "User" SET "lastSeenAt" = "lastLoginAt" WHERE "lastSeenAt" IS NULL;
