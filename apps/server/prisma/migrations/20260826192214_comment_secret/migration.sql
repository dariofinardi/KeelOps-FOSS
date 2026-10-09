-- Messaggi riservati (@secret): il corpo è cifrato e va sbloccato
-- riautenticandosi. Il flag distingue il cifrato dal testo in chiaro.
ALTER TABLE "Comment" ADD COLUMN "secret" BOOLEAN NOT NULL DEFAULT false;
