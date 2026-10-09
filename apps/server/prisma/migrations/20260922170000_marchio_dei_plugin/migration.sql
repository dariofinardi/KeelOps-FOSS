-- Il marchio del plugin sulle righe del core che un plugin può creare
-- passando dalle porte dell'SDK: gruppi, task, allegati. Serve a sapere,
-- il giorno della disinstallazione, cosa ha lasciato dietro di sé.
-- AlterTable
ALTER TABLE "Group" ADD COLUMN "pluginNick" TEXT;
ALTER TABLE "Group" ADD COLUMN "pluginRef" TEXT;
ALTER TABLE "Task" ADD COLUMN "pluginNick" TEXT;
ALTER TABLE "Task" ADD COLUMN "pluginRef" TEXT;
ALTER TABLE "Attachment" ADD COLUMN "pluginNick" TEXT;
ALTER TABLE "Attachment" ADD COLUMN "pluginRef" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Group_pluginNick_pluginRef_key" ON "Group"("pluginNick", "pluginRef");
CREATE INDEX "Task_pluginNick_idx" ON "Task"("pluginNick");
CREATE INDEX "Attachment_pluginNick_idx" ON "Attachment"("pluginNick");
