-- Lista Amministrative sulle installazioni nuove.
--
-- La migrazione precedente trasforma gli stati preesistenti in stati di categoria
-- ADMIN: su un database vuoto (installazione nuova, database di test) non c'è nulla
-- da trasformare e la categoria resterebbe senza stati. Qui la si crea, ma solo se
-- manca: su un database già popolato questa insert non fa nulla.
INSERT INTO "TaskStatus" ("id", "name", "category", "color", "order", "isClosed")
SELECT * FROM (
  SELECT 'sts_adm_da_assegnare' AS id, 'Da assegnare'       AS name, 'ADMIN' AS category, '#94a3b8' AS color, 0 AS "order", 0 AS "isClosed"
  UNION ALL SELECT 'sts_adm_assegnato',    'Assegnato',          'ADMIN', '#60a5fa', 1, 0
  UNION ALL SELECT 'sts_adm_in_esecuzione','In esecuzione',      'ADMIN', '#2563eb', 2, 0
  UNION ALL SELECT 'sts_adm_attesa_terzi', 'In attesa di terzi', 'ADMIN', '#f59e0b', 3, 0
  UNION ALL SELECT 'sts_adm_standby',      'Stand-by',           'ADMIN', '#a78bfa', 4, 0
  UNION ALL SELECT 'sts_adm_in_revisione', 'In revisione',       'ADMIN', '#f97316', 5, 0
  UNION ALL SELECT 'sts_adm_completato',   'Completato',         'ADMIN', '#22c55e', 6, 1
  UNION ALL SELECT 'sts_adm_annullato',    'Annullato',          'ADMIN', '#6b7280', 7, 1
)
WHERE NOT EXISTS (SELECT 1 FROM "TaskStatus" WHERE "category" = 'ADMIN');
