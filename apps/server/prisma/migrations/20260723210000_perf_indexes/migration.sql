-- Indici mancanti sui campi usati in ogni query (PLAN_IMPROVE C1). Additivo.
CREATE INDEX "Task_deletedAt_idx" ON "Task"("deletedAt");
CREATE INDEX "Task_projectId_idx" ON "Task"("projectId");
CREATE INDEX "Task_parentTaskId_idx" ON "Task"("parentTaskId");
CREATE INDEX "Task_supervisorId_idx" ON "Task"("supervisorId");
CREATE INDEX "Task_creatorId_idx" ON "Task"("creatorId");
CREATE INDEX "Task_predecessorId_idx" ON "Task"("predecessorId");
CREATE INDEX "Task_boardId_idx" ON "Task"("boardId");
CREATE INDEX "Task_boardStatusId_idx" ON "Task"("boardStatusId");
CREATE INDEX "Task_contactId_idx" ON "Task"("contactId");
CREATE INDEX "Task_dealStageId_idx" ON "Task"("dealStageId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE INDEX "TimeEntry_taskId_idx" ON "TimeEntry"("taskId");
CREATE INDEX "Contact_companyId_idx" ON "Contact"("companyId");
