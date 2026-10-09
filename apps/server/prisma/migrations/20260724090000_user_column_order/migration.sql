-- Ordine colonne kanban per-utente (JSON: chiave -> array di id colonna).
ALTER TABLE "User" ADD COLUMN "columnOrder" TEXT;
