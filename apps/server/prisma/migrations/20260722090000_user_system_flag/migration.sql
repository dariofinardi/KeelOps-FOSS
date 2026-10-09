-- Utente di sistema "Archivio": intesta le ore dei collaboratori eliminati.
ALTER TABLE "User" ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false;
