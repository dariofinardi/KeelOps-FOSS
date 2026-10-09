-- Ordine manuale dei progetti nella vista dell'utente (JSON array di projectId).
ALTER TABLE "User" ADD COLUMN "projectOrder" TEXT;
