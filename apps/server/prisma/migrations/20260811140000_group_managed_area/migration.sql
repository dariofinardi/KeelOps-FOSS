-- AlterTable: l'area di lavoro che un gruppo governa. Chi ne è manager legge i
-- task di quell'area (di chiunque) e ne configura stati e tipi.
ALTER TABLE "Group" ADD COLUMN "managedArea" TEXT;

-- Riempimento: si conserva ciò che valeva finora, cioè l'area dedotta dagli
-- scope in accesso completo (era la regola di `manageableCategories`). Da qui
-- in poi il campo è esplicito e non dipende più dai permessi di visibilità —
-- così revocare uno scope non fa perdere il governo dell'area.
UPDATE "Group" SET "managedArea" = 'ADMIN'
 WHERE "id" IN (SELECT "groupId" FROM "VisibilitySetting" WHERE "scope" = 'ADMIN_TASKS' AND "access" = 'FULL');
UPDATE "Group" SET "managedArea" = 'SALES'
 WHERE "managedArea" IS NULL
   AND "id" IN (SELECT "groupId" FROM "VisibilitySetting" WHERE "scope" = 'DEALS' AND "access" = 'FULL');
UPDATE "Group" SET "managedArea" = 'DEV'
 WHERE "managedArea" IS NULL
   AND "id" IN (SELECT "groupId" FROM "VisibilitySetting" WHERE "scope" = 'PROJECTS' AND "access" = 'FULL');
UPDATE "Group" SET "managedArea" = 'GENERAL'
 WHERE "managedArea" IS NULL
   AND "id" IN (SELECT "groupId" FROM "VisibilitySetting" WHERE "scope" = 'TICKETS' AND "access" = 'FULL');
