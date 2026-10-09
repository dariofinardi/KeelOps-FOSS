-- Offerte esposte ai finanziatori (ruolo FINANCIER, area riservata in sola
-- lettura): la spunta la mette il commerciale sull'offerta. Senza questa, un
-- finanziatore non vede nulla — il valore di partenza è "non visibile".
ALTER TABLE "Task" ADD COLUMN "visibleToFinanciers" BOOLEAN NOT NULL DEFAULT false;
