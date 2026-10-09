-- Ricorrenza collegata a un progetto (es. canone trimestrale a contratto).
-- Le occorrenze restano task dello scadenzario: portano il riferimento al progetto
-- in Task.relatedProjectId, senza cambiarne la visibilità.
ALTER TABLE "RecurrenceTemplate" ADD COLUMN "projectId" TEXT REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "RecurrenceTemplate_projectId_idx" ON "RecurrenceTemplate"("projectId");
