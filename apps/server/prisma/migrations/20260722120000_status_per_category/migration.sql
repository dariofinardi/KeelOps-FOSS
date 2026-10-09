-- Stati task distinti per categoria di attività (ADMIN | SALES | DEV | GENERAL).
--
-- Gli stati esistenti diventano la lista Amministrative, con gli stessi id: i task
-- di categoria ADMIN non si spostano di una virgola. Le altre liste vengono create
-- qui e i task delle rispettive categorie rimappati sullo stato corrispondente,
-- mantenendo sempre "aperto resta aperto, chiuso resta chiuso".

-- 1. Colonna categoria: il preesistente è tutto amministrativo.
ALTER TABLE "TaskStatus" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'GENERAL';
UPDATE "TaskStatus" SET "category" = 'ADMIN';

-- 2. Il nome è unico dentro la categoria, non più globalmente.
DROP INDEX IF EXISTS "TaskStatus_name_key";
CREATE UNIQUE INDEX "TaskStatus_category_name_key" ON "TaskStatus"("category", "name");

-- 3. Liste per le altre categorie (id leggibili: sono dati di sistema, non generati).
INSERT INTO "TaskStatus" ("id", "name", "category", "color", "order", "isClosed") VALUES
  ('sts_sales_da_contattare',  'Da contattare',         'SALES', '#94a3b8', 0, 0),
  ('sts_sales_contattato',     'Contattato',            'SALES', '#60a5fa', 1, 0),
  ('sts_sales_in_attesa',      'In attesa di risposta', 'SALES', '#f59e0b', 2, 0),
  ('sts_sales_da_richiamare',  'Da richiamare',         'SALES', '#a78bfa', 3, 0),
  ('sts_sales_completata',     'Completata',            'SALES', '#22c55e', 4, 1),
  ('sts_sales_annullata',      'Annullata',             'SALES', '#6b7280', 5, 1),

  ('sts_dev_da_fare',          'Da fare',               'DEV',   '#94a3b8', 0, 0),
  ('sts_dev_in_sviluppo',      'In sviluppo',           'DEV',   '#2563eb', 1, 0),
  ('sts_dev_in_review',        'In review',             'DEV',   '#f97316', 2, 0),
  ('sts_dev_da_testare',       'Da testare',            'DEV',   '#a78bfa', 3, 0),
  ('sts_dev_bloccato',         'Bloccato',              'DEV',   '#f59e0b', 4, 0),
  ('sts_dev_rilasciato',       'Rilasciato',            'DEV',   '#22c55e', 5, 1),
  ('sts_dev_annullato',        'Annullato',             'DEV',   '#6b7280', 6, 1),

  ('sts_gen_da_fare',          'Da fare',               'GENERAL', '#94a3b8', 0, 0),
  ('sts_gen_in_corso',         'In corso',              'GENERAL', '#2563eb', 1, 0),
  ('sts_gen_in_attesa',        'In attesa',             'GENERAL', '#f59e0b', 2, 0),
  ('sts_gen_completato',       'Completato',            'GENERAL', '#22c55e', 3, 1),
  ('sts_gen_annullato',        'Annullato',             'GENERAL', '#6b7280', 4, 1);

-- 4. Rimappatura dei task già esistenti che NON sono di categoria amministrativa.
--    La categoria del task è quella del suo tipo di attività; senza tipo è GENERAL.
UPDATE "Task" SET "statusId" = (
  SELECT CASE (SELECT "name" FROM "TaskStatus" WHERE "id" = "Task"."statusId")
    WHEN 'Da assegnare'       THEN 'sts_sales_da_contattare'
    WHEN 'Assegnato'          THEN 'sts_sales_da_contattare'
    WHEN 'In esecuzione'      THEN 'sts_sales_contattato'
    WHEN 'In revisione'       THEN 'sts_sales_contattato'
    WHEN 'In attesa di terzi' THEN 'sts_sales_in_attesa'
    WHEN 'Stand-by'           THEN 'sts_sales_in_attesa'
    WHEN 'Completato'         THEN 'sts_sales_completata'
    WHEN 'Annullato'          THEN 'sts_sales_annullata'
    ELSE 'sts_sales_da_contattare'
  END
)
WHERE "activityTypeId" IN (SELECT "id" FROM "ActivityType" WHERE "category" = 'SALES');

UPDATE "Task" SET "statusId" = (
  SELECT CASE (SELECT "name" FROM "TaskStatus" WHERE "id" = "Task"."statusId")
    WHEN 'Da assegnare'       THEN 'sts_dev_da_fare'
    WHEN 'Assegnato'          THEN 'sts_dev_da_fare'
    WHEN 'In esecuzione'      THEN 'sts_dev_in_sviluppo'
    WHEN 'In revisione'       THEN 'sts_dev_in_review'
    WHEN 'In attesa di terzi' THEN 'sts_dev_bloccato'
    WHEN 'Stand-by'           THEN 'sts_dev_bloccato'
    WHEN 'Completato'         THEN 'sts_dev_rilasciato'
    WHEN 'Annullato'          THEN 'sts_dev_annullato'
    ELSE 'sts_dev_da_fare'
  END
)
WHERE "activityTypeId" IN (SELECT "id" FROM "ActivityType" WHERE "category" = 'DEV');

UPDATE "Task" SET "statusId" = (
  SELECT CASE (SELECT "name" FROM "TaskStatus" WHERE "id" = "Task"."statusId")
    WHEN 'Da assegnare'       THEN 'sts_gen_da_fare'
    WHEN 'Assegnato'          THEN 'sts_gen_da_fare'
    WHEN 'In esecuzione'      THEN 'sts_gen_in_corso'
    WHEN 'In revisione'       THEN 'sts_gen_in_corso'
    WHEN 'In attesa di terzi' THEN 'sts_gen_in_attesa'
    WHEN 'Stand-by'           THEN 'sts_gen_in_attesa'
    WHEN 'Completato'         THEN 'sts_gen_completato'
    WHEN 'Annullato'          THEN 'sts_gen_annullato'
    ELSE 'sts_gen_da_fare'
  END
)
WHERE "activityTypeId" IS NULL
   OR "activityTypeId" IN (SELECT "id" FROM "ActivityType" WHERE "category" = 'GENERAL');
