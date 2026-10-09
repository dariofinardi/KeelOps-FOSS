-- Ultimo accesso riuscito, per sapere chi usa davvero l'applicazione.
--
-- Non si ricava dalle sessioni: quelle si cancellano all'uscita e scadono, così
-- un utente che esce sempre risulterebbe senza accessi. Qui resta una data che
-- non sparisce.
ALTER TABLE "User" ADD COLUMN "lastLoginAt" DATETIME;

-- Prima riempitura, con quello che si sa: la sessione aperta più di recente.
UPDATE "User"
SET "lastLoginAt" = (
  SELECT MAX("Session"."createdAt") FROM "Session" WHERE "Session"."userId" = "User"."id"
)
WHERE "lastLoginAt" IS NULL;
