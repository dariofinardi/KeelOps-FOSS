-- AlterTable
-- Messaggio riservato agli interni (@reserved): i clienti del portale e i
-- monitor vendite non lo vedono (16/09/2026). Una colonna in coda, come per
-- `secret`: la tabella dei messaggi non si ricostruisce per un booleano.
ALTER TABLE "Comment" ADD COLUMN "reserved" BOOLEAN NOT NULL DEFAULT false;
