/**
 * The plugins' EXTENSION store: a DuckDB file of the plugin's own, inside its
 * data dir, for what does not belong in the KeelOps database — analytical
 * volumes, aggregates, histories, throwaway caches. The tables that matter
 * (settings, what the user typed) go in `plugin_<nick>_*` on the core's
 * engine, where the backup and the switch to MariaDB see them; this store is
 * for data the plugin can rebuild, or that only it will ever read.
 *
 * DuckDB is a native module and not every plugin needs it: it is loaded ONLY
 * when a plugin asks, and it must be installed inside the plugin folder
 * (`npm i @duckdb/node-api` in there). The SDK sits in its own folder, so it
 * cannot see the plugin's node_modules by itself: the plugin says where to
 * look with `from: import.meta.url`. If it is missing, the error says what
 * to do instead of failing cryptically.
 *
 * The surface mirrors the database driver (all/get/run, async, positional
 * `?` parameters) plus `exec` for DDL and `migrate` for a versioned schema,
 * so a plugin author learns one shape. Rows come back plain: BIGINT as a
 * number, timestamps and decimals as strings — the same rule the borrowed
 * driver follows (database.mjs), for the same reason: JSON.stringify.
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const plain = (value) => {
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    // DuckDBTimestampValue, DuckDBDateValue, DuckDBDecimalValue…: they all know how to be a string
    if (typeof value.toString === "function" && value.toString !== Object.prototype.toString) return value.toString();
    const out = {};
    for (const k of Object.keys(value)) out[k] = plain(value[k]);
    return out;
  }
  if (Array.isArray(value)) return value.map(plain);
  return value;
};

async function loadDuckDb(from) {
  const require = createRequire(from ?? import.meta.url);
  let resolved;
  try {
    resolved = require.resolve("@duckdb/node-api");
  } catch {
    throw new Error(
      "this plugin wants a DuckDB extension store but the module is missing: " +
      "run `npm i @duckdb/node-api` inside the plugin folder, and pass `from: import.meta.url` to openExtensionStore");
  }
  return import(pathToFileURL(resolved).href);
}

/**
 * Opens (or creates) `<dataDir>/<fileName>` and returns the store:
 *
 *   dialect                    "duckdb"
 *   await exec(sql)            DDL and statements without parameters
 *   await all(sql, ...params)  every row
 *   await get(sql, ...params)  first row or undefined
 *   await run(sql, ...params)  → { changes }
 *   await migrate(steps, from?) versioned schema: `[{ version, up(store) }]`,
 *                              the version kept in `keelops_schema`; returns
 *                              the version reached
 *   await version()            the schema version in the file (0 = none)
 *   await close()
 *
 * `fileName: ":memory:"` gives a store that lives as long as the process
 * (tests, scratch work).
 */
export async function openExtensionStore(dataDir, options = {}) {
  const { fileName = "extension.duckdb", from } = typeof options === "string" ? { fileName: options } : options;
  const duckdb = await loadDuckDb(from);
  let target = ":memory:";
  if (fileName !== ":memory:") {
    mkdirSync(dataDir, { recursive: true });
    target = join(dataDir, fileName);
  }
  const instance = await duckdb.DuckDBInstance.create(target);
  const connection = await instance.connect();

  const read = async (sql, params) => {
    const reader = await connection.runAndReadAll(sql, params.length ? params : undefined);
    return reader.getRowObjects().map((row) => {
      const out = {};
      for (const k of Object.keys(row)) out[k] = plain(row[k]);
      return out;
    });
  };

  const store = {
    dialect: "duckdb",
    /** kept for the plugins written against the first shape of this module */
    connection,
    async exec(sql) { await connection.run(sql); },
    async all(sql, ...params) { return read(sql, params); },
    async get(sql, ...params) { return (await read(sql, params))[0]; },
    async run(sql, ...params) {
      const result = await connection.run(sql, params.length ? params : undefined);
      return { changes: Number(result.rowsChanged ?? 0) };
    },
    async version() {
      await connection.run("CREATE TABLE IF NOT EXISTS keelops_schema (version INTEGER NOT NULL)");
      const row = (await read("SELECT MAX(version) AS v FROM keelops_schema", []))[0];
      return Number(row?.v ?? 0);
    },
    async migrate(steps, from) {
      let reached = from ?? (await store.version());
      for (const step of [...steps].sort((a, b) => a.version - b.version)) {
        if (!Number.isInteger(step.version) || step.version <= reached) continue;
        await step.up(store);
        await connection.run("INSERT INTO keelops_schema (version) VALUES (?)", [step.version]);
        reached = step.version;
      }
      return reached;
    },
    async close() { connection.closeSync?.(); instance.closeSync?.(); },
  };
  return store;
}
