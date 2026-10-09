-- CreateIndex: "cosa ho toccato in questo mese" — la domanda del timesheet
-- (compila dalle attività). Senza, ogni pressione è una scansione completa.
CREATE INDEX "ActivityLog_userId_createdAt_idx" ON "ActivityLog"("userId", "createdAt");
