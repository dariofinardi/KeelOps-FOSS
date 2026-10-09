-- AlterTable: privilegi di amministratore a richiesta (stile sudo). Nullo o
-- passato = l'admin lavora come un utente normale; una data futura = elevato.
ALTER TABLE "User" ADD COLUMN "adminUntil" DATETIME;
