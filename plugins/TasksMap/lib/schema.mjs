/**
 * The plugin's tables and how they got there.
 *
 * One table, `plugin_tasksmap_vettore`: the embedding of a task's text, one
 * row per task, with the fingerprint of the text it was computed from and
 * the model that produced it. Nothing else is cached: themes, edges and
 * suggestions are cheap and are recomputed on every request from the vectors
 * of the tasks the *asking user* can see — a computed graph stored whole
 * would carry the shape of one person's perimeter to the next (the flaw of
 * the file cache this replaces, 06/09/2026).
 *
 * The foreign key points from here to the core, never the other way: a task
 * that goes takes its vector along, a disabled plugin breaks nothing.
 */
import { applyMigrations } from "../../keelops-sdk/database.mjs";

export const NICK = "tasksmap";
export const SCHEMA_VERSION = 1;

export function ddlV1(sql) {
  const suffix = sql.createTableSuffix();
  return [
    `CREATE TABLE IF NOT EXISTS plugin_tasksmap_vettore (
      taskId VARCHAR(191) NOT NULL PRIMARY KEY,
      impronta VARCHAR(64) NOT NULL,
      modello VARCHAR(40) NOT NULL,
      vettore ${sql.longText()} NOT NULL,
      calcolatoIl VARCHAR(32) NOT NULL,
      FOREIGN KEY (taskId) REFERENCES Task(id) ON DELETE CASCADE
    )${suffix}`,
  ];
}

export const MIGRATIONS = [
  {
    version: 1,
    async up(db) {
      for (const statement of ddlV1(db.sql)) await db.run(statement);
    },
  },
];

export function migrate(db, from) {
  return applyMigrations(db, NICK, MIGRATIONS, from);
}
