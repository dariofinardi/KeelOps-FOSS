-- Come una persona è nominata sul calendario delle assenze, oltre al suo nome:
-- «Manu», «Franci». Nome e cognome si riconoscono da soli.
ALTER TABLE "User" ADD COLUMN "calendarAliases" TEXT;
