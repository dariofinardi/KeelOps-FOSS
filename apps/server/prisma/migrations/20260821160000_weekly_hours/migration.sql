-- Ore settimanali da contratto: il denominatore dei riepiloghi di produttività.
-- Quaranta per difetto (tempo pieno); un part-time si scrive sull'utente.
ALTER TABLE "User" ADD COLUMN "weeklyHours" INTEGER NOT NULL DEFAULT 40;
