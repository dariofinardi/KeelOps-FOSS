-- AlterTable: password provvisoria. La mette un amministratore dal reset e la
-- spedisce per email; finché l'utente non ne sceglie una sua, la sessione serve
-- soltanto a cambiarla. Gli utenti esistenti non sono toccati (default false).
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
