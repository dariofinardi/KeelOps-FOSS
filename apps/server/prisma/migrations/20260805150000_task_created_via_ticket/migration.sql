-- Origine "ticket": il record è nato dall'area ticket, anche se oggi è un task
-- di progetto a tutti gli effetti.
--
-- Serve a due cose: dire la provenienza (progetto vs ticket) e tenere la
-- finestra di visibilità per chi lo ha aperto — il cliente del portale continua
-- a vedere e commentare il SUO task anche senza alcun accesso al progetto.
ALTER TABLE "Task" ADD COLUMN "createdViaTicket" BOOLEAN NOT NULL DEFAULT 0;

-- Lo storico: i ticket esistenti sono nati tutti dall'area ticket.
UPDATE "Task" SET "createdViaTicket" = 1 WHERE "kind" = 'TICKET';
