import { describe, expect, it } from "vitest";
// Il modulo è JavaScript puro dell'SDK: le firme stanno in support/keelops-sdk.d.ts.
import {
  assertWritesOnlyOwnTables,
  writeTargets,
} from "../../../plugins/keelops-sdk/sql-targets.mjs";

/**
 * **Un plugin scrive solo nelle sue tabelle**, e il modo in cui lo si sa è
 * leggere lo statement — non fidarsi della prima parola. La vecchia regola
 * (`SELECT` o `WITH` in testa) lasciava passare `WITH x AS (…) DELETE FROM
 * Task`, che su SQLite è sintassi valida. Qui si prova che le forme che
 * scrivono vengano riconosciute tutte, che le trappole facili non passino, e
 * che ciò che non si capisce si rifiuti invece di indovinare.
 */
describe("le tabelle che uno statement scrive", () => {
  const scrive = (sql: string) => (writeTargets(sql) as { tables: string[] }).tables;

  it("riconosce le forme ordinarie", () => {
    expect(scrive("INSERT INTO plugin_x_board (id) VALUES (?)")).toEqual(["plugin_x_board"]);
    expect(scrive("insert or ignore into plugin_x_board values (1)")).toEqual(["plugin_x_board"]);
    expect(scrive("REPLACE INTO plugin_x_config (name, value) VALUES (?, ?)")).toEqual([
      "plugin_x_config",
    ]);
    expect(scrive("UPDATE plugin_x_task SET title = ? WHERE id = ?")).toEqual(["plugin_x_task"]);
    expect(scrive("DELETE FROM plugin_x_task WHERE id = ?")).toEqual(["plugin_x_task"]);
    expect(scrive("CREATE TABLE IF NOT EXISTS plugin_x_status (id TEXT)")).toEqual([
      "plugin_x_status",
    ]);
    expect(scrive("ALTER TABLE plugin_x_task ADD COLUMN archivedAt TEXT")).toEqual([
      "plugin_x_task",
    ]);
    expect(scrive("DROP TABLE IF EXISTS plugin_x_old")).toEqual(["plugin_x_old"]);
    expect(scrive("TRUNCATE TABLE plugin_x_cache")).toEqual(["plugin_x_cache"]);
  });

  it("l'UPDATE di un upsert non è un secondo bersaglio, in nessuno dei due dialetti", () => {
    expect(
      scrive(
        "INSERT INTO plugin_x_config (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value",
      ),
    ).toEqual(["plugin_x_config"]);
    expect(
      scrive(
        "INSERT INTO plugin_x_config (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
      ),
    ).toEqual(["plugin_x_config"]);
  });

  it("le azioni referenziali di una chiave esterna non sono DELETE né UPDATE", () => {
    expect(
      scrive(
        "CREATE TABLE plugin_x_task (id TEXT PRIMARY KEY, boardId TEXT, " +
          "FOREIGN KEY (boardId) REFERENCES plugin_x_board(id) ON DELETE CASCADE ON UPDATE CASCADE, " +
          "FOREIGN KEY (ownerId) REFERENCES User(id) ON DELETE SET NULL)",
      ),
    ).toEqual(["plugin_x_task"]);
  });

  it("legge i nomi fra apici, backtick e con lo schema davanti", () => {
    expect(scrive('UPDATE "plugin_x_task" SET a = 1')).toEqual(["plugin_x_task"]);
    expect(scrive("DELETE FROM `plugin_x_task`")).toEqual(["plugin_x_task"]);
    expect(scrive("INSERT INTO main.plugin_x_task (id) VALUES (1)")).toEqual(["plugin_x_task"]);
  });

  it("una SELECT non scrive niente, anche se nomina tabelle del core", () => {
    expect(scrive("SELECT * FROM Task WHERE assigneeId = ?")).toEqual([]);
    expect(scrive("WITH aperti AS (SELECT id FROM Task) SELECT count(*) FROM aperti")).toEqual([]);
  });

  it("la trappola del WITH: scrive lo stesso, e lo si vede", () => {
    expect(scrive("WITH x AS (SELECT 1) DELETE FROM Task")).toEqual(["Task"]);
    expect(scrive("WITH x AS (SELECT 1) INSERT INTO Session (id) SELECT 1")).toEqual(["Session"]);
  });

  it("i nomi dentro le stringhe e i commenti sono dati, non bersagli", () => {
    expect(scrive("INSERT INTO plugin_x_task (title) VALUES ('DELETE FROM Task')")).toEqual([
      "plugin_x_task",
    ]);
    expect(scrive("-- DROP TABLE Task\nUPDATE plugin_x_task SET a = 1")).toEqual(["plugin_x_task"]);
    expect(scrive("/* DELETE FROM Task */ UPDATE plugin_x_task SET a = 1")).toEqual([
      "plugin_x_task",
    ]);
  });

  it("gli indici contano, e la tabella su cui stanno pure", () => {
    const esito = writeTargets("CREATE INDEX plugin_x_task_owner ON plugin_x_task (ownerId)") as {
      tables: string[];
      indexes: string[];
    };
    expect(esito.tables).toEqual(["plugin_x_task"]);
    expect(esito.indexes).toEqual(["plugin_x_task_owner"]);
  });

  it("viste, trigger e stringhe non chiuse si rifiutano invece di indovinare", () => {
    expect(() => writeTargets("CREATE VIEW plugin_x_v AS SELECT 1")).toThrow(/not allowed/);
    expect(() => writeTargets("CREATE TRIGGER plugin_x_t AFTER INSERT ON Task BEGIN END")).toThrow(
      /not allowed/,
    );
    expect(() => writeTargets("INSERT INTO plugin_x_task VALUES ('aperta")).toThrow(/unterminated/);
  });
});

describe("il cancello del prefisso", () => {
  it("lascia passare ciò che porta il prefisso del plugin, in qualunque maiuscola", () => {
    expect(() =>
      assertWritesOnlyOwnTables("INSERT INTO plugin_personale_board (id) VALUES (1)", "personale"),
    ).not.toThrow();
    expect(() =>
      assertWritesOnlyOwnTables("UPDATE PLUGIN_PERSONALE_TASK SET a = 1", "personale"),
    ).not.toThrow();
  });

  it("rifiuta una tabella del core, e dice quale", () => {
    expect(() => assertWritesOnlyOwnTables("DELETE FROM Task", "personale")).toThrow(/"Task"/);
    expect(() =>
      assertWritesOnlyOwnTables("WITH x AS (SELECT 1) DELETE FROM Task", "personale"),
    ).toThrow(/"Task"/);
  });

  it("rifiuta le tabelle di un altro plugin", () => {
    expect(() => assertWritesOnlyOwnTables("DROP TABLE plugin_mcp_config", "personale")).toThrow(
      /plugin_mcp_config/,
    );
  });

  it("uno statement per chiamata: il punto e virgola non aggiunge un secondo", () => {
    expect(() =>
      assertWritesOnlyOwnTables(
        "UPDATE plugin_personale_task SET a = 1; DELETE FROM Task",
        "personale",
      ),
    ).toThrow(/one statement/);
    // il punto e virgola finale, da solo, non è un secondo statement
    expect(() =>
      assertWritesOnlyOwnTables("UPDATE plugin_personale_task SET a = 1;", "personale"),
    ).not.toThrow();
  });

  it("le letture passano sempre", () => {
    expect(() => assertWritesOnlyOwnTables("SELECT * FROM Task", "personale")).not.toThrow();
  });
});
