-- Tema UI per-utente: auto | light | dark | company. Default "light" = tema storico.
ALTER TABLE "User" ADD COLUMN "theme" TEXT NOT NULL DEFAULT 'light';
