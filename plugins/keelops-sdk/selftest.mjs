// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Self-test of the SDK database abstraction: the SQLite driver behaves, a
 * borrowed connection behaves the same way from the outside, the scheme
 * registry answers clearly for what does not exist, and the layer stays
 * read-only. `node selftest.mjs <copy-of-db>`
 */
import { applyMigrations, borrowedDriver, openDatabase, openWritableSqlite, pluginConfig, prepareOwnedTables } from "./database.mjs";
import { chat, dot, embed, normalize } from "./ollama.mjs";
import { openExtensionStore } from "./extension.mjs";
import { pathToFileURL } from "node:url";

const DB_PATH = process.argv[2];
if (!DB_PATH) { console.error("usage: node selftest.mjs <copy-of-db>"); process.exit(1); }

let failures = 0;
const check = (name, cond) => { console.log(`  ${cond ? "✓" : "✗"} ${name}`); if (!cond) failures += 1; };

const db = openDatabase(DB_PATH);
check("bare path opens the sqlite driver", db.dialect === "sqlite");
check("all() returns rows", (await db.all("SELECT id FROM Project LIMIT 3")).length > 0);
check("get() returns one row with params",
      typeof (await db.get("SELECT COUNT(*) AS c FROM Task WHERE kind = ?", "DEAL")).c === "number");
check("sql.now() works in a query",
      (await db.get(`SELECT ${db.sql.now()} AS t`)).t.startsWith("20"));
check("sql.dayOf() cuts the day",
      /^\d{4}-\d{2}-\d{2}$/.test((await db.get(`SELECT ${db.sql.dayOf("createdAt")} AS d FROM Task LIMIT 1`)).d));
check("sql.todayPlusDays() validates and computes",
      /^\d{4}-\d{2}-\d{2}$/.test((await db.get(`SELECT ${db.sql.todayPlusDays(14)} AS d`)).d));
check("sql.concat() joins strings, and does not turn into a boolean",
      (await db.get(`SELECT ${db.sql.concat("'a'", "'/'", "'b'")} AS j`)).j === "a/b");
let threw = "";
try { db.sql.todayPlusDays("14; DROP TABLE Task"); } catch (err) { threw = err.message; }
check("todayPlusDays refuses non-integers", threw.includes("integer"));
try { await db.all("DELETE FROM Task"); threw = ""; } catch (err) { threw = err.message; }
check("the layer is read-only: writes are refused", threw.length > 0);
const url = openDatabase(`sqlite:${DB_PATH}`);
check("sqlite: URL scheme works too", (await url.get("SELECT 1 AS x")).x === 1);
await url.close();
try { openDatabase("postgres://db.example/keelops"); threw = ""; } catch (err) { threw = err.message; }
check("unknown scheme fails with the available list", threw.includes("sqlite"));
await db.close();

/* ---- the borrowed driver: someone else's connection, same promises ---- */
const asked = [];
const lent = borrowedDriver({
  dialect: "mariadb",
  query: async (sql, params) => {
    asked.push({ sql, params });
    return [{ giorno: new Date("2026-09-02T06:38:07.301Z"), quanti: 42n, media: { toNumber: () => 3.5 } }];
  },
});
check("a borrowed driver declares its own dialect", lent.dialect === "mariadb");
check("its corner speaks that dialect", lent.sql.dayOf("t.closedAt").startsWith("DATE_FORMAT"));
check("|| would be a logical OR there, so concat is CONCAT", lent.sql.concat("a", "b") === "CONCAT(a, b)");
const row = await lent.get("SELECT 1", "x");
check("params reach the connection", asked[0].params[0] === "x");
// The point of the normalisation: a plugin written against SQLite keeps working.
check("timestamps come back as ISO strings, not Date objects", row.giorno.slice(0, 10) === "2026-09-02");
check("counts come back as numbers, not BigInt", row.quanti === 42);
check("decimals come back as numbers", row.media === 3.5);
check("and the row survives JSON, which BigInt would not", JSON.stringify(row).includes("42"));
for (const [what, sql] of [["a write", "DELETE FROM Task"],
                           ["a write behind a comment", "/* read? */ UPDATE Task SET a = 1"],
                           ["a write behind whitespace", "\n\n  insert into Task values (1)"]]) {
  try { await lent.all(sql); threw = ""; } catch (err) { threw = err.message; }
  check(`a borrowed connection refuses ${what}`, threw.includes("read-only"));
}
check("but WITH … SELECT goes through", (await lent.all("WITH x AS (SELECT 1) SELECT * FROM x")).length === 1);

/* ---- what a plugin with tables gets in standalone mode ---- */
{
  const own = openWritableSqlite(DB_PATH, "prova");
  const reached = await prepareOwnedTables(own, {
    nick: "prova", schemaVersion: 1, version: "9.9.9",
    migrate: (d, from) => applyMigrations(d, "prova", [{ version: 1, up: (x) => x.run(`CREATE TABLE plugin_prova_nota (id INTEGER PRIMARY KEY, testo ${x.sql.longText()})`) }], from),
  });
  check("prepareOwnedTables runs the missing steps and reaches the expected version", reached === 1);
  const cfg = await pluginConfig(own, "prova").all();
  check("and writes the two versions", cfg.schema_version === "1" && cfg.plugin_version === "9.9.9");
  check("longText is TEXT on SQLite and LONGTEXT on MariaDB", own.sql.longText() === "TEXT" && lent.sql.longText() === "LONGTEXT");
  const w = await own.run("INSERT INTO plugin_prova_nota (testo) VALUES (?)", "x".repeat(100_000));
  check("a writable driver writes its own tables", w.changes === 1);
  try { await own.run("DELETE FROM Task"); threw = ""; } catch (err) { threw = err.message; }
  check("and refuses the core's, by name", threw.includes('"Task"'));
  try { await prepareOwnedTables(own, { nick: "prova", schemaVersion: 0, version: "1.0.0" }); threw = ""; } catch (err) { threw = err.message; }
  check("tables ahead of the code are refused", threw.includes("expects 0"));
  await own.run("DROP TABLE plugin_prova_nota");
  await own.run("DROP TABLE plugin_prova_config");
  await own.close();
}

/* ---- the Ollama door: a failure is null, never an exception ---- */
check("embed without a URL is null", (await embed({ url: "", input: ["a"] })) === null);
check("embed of nothing is an empty list", JSON.stringify(await embed({ url: "http://127.0.0.1:9", input: [] })) === "[]");
check("embed on a dead host is null, not a throw", (await embed({ url: "http://127.0.0.1:9", input: ["a"], timeoutMs: 2000 })) === null);
check("chat on a dead host is null too", (await chat({ url: "http://127.0.0.1:9", model: "x", user: "ciao", timeoutMs: 2000 })) === null);
check("normalize gives unit vectors and dot is the cosine", Math.abs(dot(normalize([3, 4]), normalize([3, 4])) - 1) < 1e-9);

/* ---- the DuckDB extension store, when the module is around (KEELOPS_DUCKDB_FROM points at a package that has it) ---- */
{
  let threw = "";
  try { await openExtensionStore("/nonexistent", { from: import.meta.url }); } catch (err) { threw = err.message; }
  check("without the module the store says what to install, and where", threw.includes("npm i @duckdb/node-api") || threw === "");
  const from = process.env.KEELOPS_DUCKDB_FROM;
  if (!from) console.log("  - DuckDB store: skipped (set KEELOPS_DUCKDB_FROM=<file inside a package that has @duckdb/node-api>)");
  else {
    const store = await openExtensionStore("", { fileName: ":memory:", from: pathToFileURL(from).href });
    check("the store opens in memory", store.dialect === "duckdb");
    const reached = await store.migrate([
      { version: 1, up: (s) => s.exec("CREATE TABLE misure (id INTEGER, quanti BIGINT, quando TIMESTAMP, nota VARCHAR)") },
      { version: 2, up: (s) => s.exec("ALTER TABLE misure ADD COLUMN peso DECIMAL(10,2)") },
    ]);
    check("migrate runs the steps in order and keeps the version in the file", reached === 2 && (await store.version()) === 2);
    check("a second migrate is a no-op", (await store.migrate([{ version: 2, up: () => { throw new Error("must not run"); } }])) === 2);
    const w = await store.run("INSERT INTO misure VALUES (?, ?, ?, ?, ?)", 1, 7, "2026-09-06 10:00:00", "ciao", 3.5);
    check("run returns the rows changed", w.changes === 1);
    const row = await store.get("SELECT * FROM misure WHERE id = ?", 1);
    check("rows come back plain: BIGINT as a number, timestamp and decimal as strings",
          row.quanti === 7 && row.quando === "2026-09-06 10:00:00" && row.peso === "3.50" && JSON.stringify(row).includes("ciao"));
    check("all() lists", (await store.all("SELECT id FROM misure")).length === 1);
    await store.close();
  }
}

console.log(failures ? `\n${failures} CHECKS FAILED` : "\nall checks pass");
process.exit(failures ? 1 : 0);
