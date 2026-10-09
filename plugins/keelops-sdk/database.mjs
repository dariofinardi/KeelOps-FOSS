/**
 * The database abstraction of the plugin SDK.
 *
 * Plugins never talk to a database engine directly: they receive a DRIVER with
 * a small, stable surface. Two drivers exist: SQLite, which opens the file
 * read-only on its own, and one built on a query function someone else owns —
 * that is how the KeelOps host hands over its own connection when the
 * installation runs on a server engine.
 *
 * What a driver provides:
 *   dialect                    - "sqlite" | "mariadb"
 *   await all(sql, ...params)  - every row (positional `?` placeholders)
 *   await get(sql, ...params)  - first row or undefined
 *   await close()
 *   sql                        - the dialect corner, kept deliberately tiny:
 *                                ONLY the expressions our queries actually
 *                                need, so SQL in plugins stays ANSI elsewhere.
 *
 * **The interface is asynchronous**, and it is worth saying why, because it
 * used to be synchronous and reads still return in a fraction of a millisecond.
 * `node:sqlite` answers on the spot; every MariaDB client for Node answers with
 * a promise, and no amount of abstraction turns one into the other. Making the
 * fast case await costs nothing and is the only shape both engines fit.
 *
 * Reads are free. Writes exist since 05/09/2026 and are fenced: a plugin that
 * declares a `nick` in its manifest OWNS the tables named `plugin_<nick>_…` —
 * it creates them, migrates them, keeps them — and `run()` lets a statement
 * through only when every table it writes carries that prefix (see
 * sql-targets.mjs, which reads the statement instead of trusting its first
 * word). The file-opened SQLite driver stays read-only: it has no `execute`
 * to hand over, and a plugin that owns tables gets the borrowed driver on
 * every engine. The DuckDB extension store (extension.mjs) remains for
 * throwaway data — caches, computed graphs — not for what matters.
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { assertWritesOnlyOwnTables } from "./sql-targets.mjs";

const integer = (n, what) => {
  const value = Number(n);
  if (!Number.isInteger(value)) throw new Error(`${what} wants an integer`);
  return value;
};

/**
 * The dialect corner, one entry per engine.
 *
 * Timestamps are the whole difficulty. SQLite keeps them as ISO strings and
 * cuts days out of them with substr; MariaDB keeps real DATETIME values, so the
 * same day has to be *formatted* back into a string — otherwise a plugin that
 * prints what it selected would show a Date where it used to show "2026-09-02".
 * And the clock must be UTC on both: `NOW()` follows the server's timezone,
 * which is nobody's idea of a stable answer.
 */
const CORNERS = {
  sqlite: {
    now: () => "datetime('now')",
    dayOf: (expr) => `substr(${expr}, 1, 10)`,
    monthOf: (expr) => `substr(${expr}, 1, 7)`,
    today: () => "date('now')",
    daysBetween: (a, b) => `(julianday(${b}) - julianday(${a}))`,
    todayPlusDays: (n) => {
      const days = integer(n, "todayPlusDays");
      return `date('now', '${days >= 0 ? "+" : ""}${days} days')`;
    },
    concat: (...parts) => `(${parts.join(" || ")})`,
    ident: (nome) => `"${nome.replace(/"/g, '""')}"`,
    // `INSERT … <upsert(key, cols)>`: update the listed columns on a key clash.
    upsert: (key, columns) =>
      `ON CONFLICT(${key}) DO UPDATE SET ${columns.map((c) => `${c} = excluded.${c}`).join(", ")}`,
    // What goes after the closing parenthesis of CREATE TABLE: nothing here,
    // the charset and collation the core's tables use on MariaDB.
    createTableSuffix: () => "",
    // A column for text with no practical bound (extracted documents, JSON
    // vectors): TEXT is unbounded on SQLite, 64 KB on MariaDB — the same DDL
    // would silently fit here and fail there.
    longText: () => "TEXT",
  },
  mariadb: {
    now: () => "UTC_TIMESTAMP(3)",
    dayOf: (expr) => `DATE_FORMAT(${expr}, '%Y-%m-%d')`,
    monthOf: (expr) => `DATE_FORMAT(${expr}, '%Y-%m')`,
    today: () => "DATE_FORMAT(UTC_DATE(), '%Y-%m-%d')",
    daysBetween: (a, b) => `(TIMESTAMPDIFF(SECOND, ${a}, ${b}) / 86400)`,
    todayPlusDays: (n) => {
      const days = integer(n, "todayPlusDays");
      return `DATE_FORMAT(DATE_ADD(UTC_DATE(), INTERVAL ${days} DAY), '%Y-%m-%d')`;
    },
    // `||` is string concatenation in SQLite and a logical OR in MySQL: the
    // same query would silently return 1 or 0 instead of "user/day".
    concat: (...parts) => `CONCAT(${parts.join(", ")})`,
    ident: (nome) => `\`${nome.replace(/`/g, '``')}\``,
    upsert: (key, columns) =>
      `ON DUPLICATE KEY UPDATE ${columns.map((c) => `${c} = VALUES(${c})`).join(", ")}`,
    // A foreign key to a core table needs the same charset and collation on
    // both sides; this is what 0_init gave every core table.
    createTableSuffix: () => " DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
    longText: () => "LONGTEXT",
  },
};

class SqliteDriver {
  dialect = "sqlite";
  sql = CORNERS.sqlite;

  constructor(path) {
    if (!existsSync(path)) throw new Error(`database not found: ${path}`);
    this.db = new DatabaseSync(path, { readOnly: true });
    /**
     * Under WAL, readers and the writer coexist - but during a checkpoint the
     * core briefly holds an exclusive lock. Without a timeout, a read landing
     * right there throws SQLITE_BUSY instead of waiting a few milliseconds.
     * (The reverse risk does not exist: a readOnly connection cannot take a
     * write lock.)
     */
    this.db.exec("PRAGMA busy_timeout = 5000");
  }

  // Synchronous underneath, promised on the surface: see the note on top.
  async all(sql, ...params) { return this.db.prepare(sql).all(...params); }
  async get(sql, ...params) { return this.db.prepare(sql).get(...params); }
  async run() { throw new Error("this driver opened the file read-only: a plugin that owns tables gets the borrowed driver"); }
  async close() { this.db.close(); }
}

/**
 * A plain `query(sql, params)` over the SQLite file opened read-only: what the
 * core hands to `borrowedDriver` for the reads of a plugin that owns tables,
 * so that even a statement the text gate misjudged cannot write — the
 * connection itself refuses (SQLITE_READONLY). Writes take the core's
 * connection, gated by the table prefix.
 */
export function readOnlyQuery(path) {
  const driver = new SqliteDriver(path);
  return (sql, params = []) => driver.db.prepare(sql).all(...params);
}

/**
 * A borrowed connection hands back the engine's own types, and they are not the
 * ones SQLite hands back: a timestamp arrives as a Date where it used to be an
 * ISO string, a COUNT() as a BigInt (which `JSON.stringify` refuses outright),
 * a rounded average as a Decimal object. A plugin doing `row.closedAt.slice(0, 10)`
 * would break on the first one and never on the others — so the rows are put
 * back into the shape the layer has always promised, here, once.
 */
const plain = (value) => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return Number(value);
  // Prisma's Decimal, and anything else that knows how to be a number.
  if (value && typeof value === "object" && typeof value.toNumber === "function")
    return value.toNumber();
  return value;
};

const plainRows = (rows) =>
  Array.isArray(rows)
    ? rows.map((row) => {
        const out = {};
        for (const key of Object.keys(row)) out[key] = plain(row[key]);
        return out;
      })
    : rows;

/**
 * A driver over a connection someone else owns — in practice the KeelOps
 * core's, which is already speaking to whatever engine the installation runs
 * on. `query(sql, params)` returns rows; `execute(sql, params)` returns the
 * number of affected rows and is optional — without it, or without a `nick`,
 * the driver cannot write at all. `close` is optional too: closing a
 * connection we borrowed is not ours to do.
 *
 * Reads go through the same gate as writes: `assertWritesOnlyOwnTables` lets
 * a SELECT pass untouched and refuses a `WITH … DELETE` dressed as one, which
 * the old first-word regex did not.
 */
export function borrowedDriver({ dialect, query, execute, close, nick }) {
  const sql = CORNERS[dialect];
  if (!sql) throw new Error(`no dialect corner for "${dialect}"`);
  const read = async (text, params) => {
    let tables;
    try {
      ({ tables } = assertWritesOnlyOwnTables(text, nick ?? ""));
    } catch (err) {
      if (!nick) throw new Error(`the plugin database layer is read-only: ${err.message}`);
      throw err;
    }
    if (tables.length > 0) throw new Error("use run() to write; all()/get() are for reading");
    return plainRows(await query(text, params));
  };
  return {
    dialect,
    sql,
    nick: nick ?? null,
    async all(text, ...params) { return read(text, params); },
    async get(text, ...params) { return (await read(text, params))[0]; },
    /**
     * A write, on the plugin's own tables only. Returns the affected rows.
     * The gate throws with the offending name in the message: the reader is
     * the plugin's developer, and a bare «denied» would send them guessing.
     */
    async run(text, ...params) {
      if (!nick || !execute) throw new Error("this plugin has no nick: it owns no tables and cannot write");
      assertWritesOnlyOwnTables(text, nick);
      const affected = await execute(text, params);
      return { changes: typeof affected === "bigint" ? Number(affected) : Number(affected ?? 0) };
    },
    async close() { await close?.(); },
  };
}

/**
 * A WRITABLE SQLite handle for a plugin that owns tables, wrapped the way the
 * core wraps its own connection — same gate, same row shapes. It is what the
 * standalone mode (`server.mjs`, the self-tests) uses instead of the core's
 * borrowed connection, and it is meant for a COPY of the database: even with
 * the prefix gate in place, a development server has no business on the real
 * file.
 */
export function openWritableSqlite(path, nick) {
  if (!nick) throw new Error("a writable driver wants the plugin's nick: it fences the tables it may write");
  if (!existsSync(path)) throw new Error(`database not found: ${path}`);
  const handle = new DatabaseSync(path);
  handle.exec("PRAGMA busy_timeout = 5000");
  handle.exec("PRAGMA foreign_keys = ON");
  return borrowedDriver({
    dialect: "sqlite",
    nick,
    query: (sql, params) => handle.prepare(sql).all(...params),
    execute: (sql, params) => handle.prepare(sql).run(...params).changes,
    close: () => handle.close(),
  });
}

/**
 * What the core does before mounting a plugin with a nick (plugin-host.ts,
 * `preparaTabelle`), for the standalone mode: the config table exists, the
 * tables are not ahead of the code, the missing steps run, and the two
 * versions are written. The core keeps its own copy on purpose — it is the
 * one that refuses to mount; this is the one that lets a plugin start alone.
 */
export async function prepareOwnedTables(db, { nick, schemaVersion, migrate, version }) {
  const cfg = pluginConfig(db, nick);
  await cfg.ensure();
  const from = Number((await cfg.get("schema_version")) ?? 0);
  const expected = Number(schemaVersion ?? 0);
  if (from > expected) throw new Error(`tables of "${nick}" are at schema ${from}, the code expects ${expected}`);
  if (from < expected) {
    if (!migrate) throw new Error(`tables of "${nick}" are at schema ${from}, expected ${expected}, and there is no migrate()`);
    await migrate(db, from);
    const reached = Number((await cfg.get("schema_version")) ?? 0);
    if (reached !== expected) throw new Error(`migration of "${nick}" incomplete: tables say ${reached}, the code expects ${expected}`);
  }
  await cfg.set("plugin_version", String(version ?? "0.0.0"));
  return expected;
}

/**
 * The plugin's configuration table, `plugin_<nick>_config`: key/value rows for
 * its settings plus two the core relies on — `plugin_version` (the code that
 * wrote last) and `schema_version` (the shape of its tables). It exists before
 * any other table of the plugin, because it is where the core reads «who are
 * you and how far along are you» without knowing the rest.
 *
 * `updatedAt` is an ISO string on both engines: a plain column, no engine
 * clock, so the value reads the same wherever it was written.
 */
export function pluginConfig(db, nick) {
  if (!/^[a-z][a-z0-9_]*$/.test(nick ?? "")) throw new Error(`a plugin nick is lowercase letters, digits and underscores: "${nick}"`);
  const table = `plugin_${nick}_config`;
  return {
    table,
    async ensure() {
      await db.run(
        `CREATE TABLE IF NOT EXISTS ${table} (` +
          `name VARCHAR(191) NOT NULL PRIMARY KEY, value TEXT NOT NULL, updatedAt VARCHAR(32) NOT NULL)`,
      );
    },
    async get(name) {
      const row = await db.get(`SELECT value FROM ${table} WHERE name = ?`, name);
      return row ? String(row.value) : null;
    },
    async set(name, value) {
      await db.run(
        `INSERT INTO ${table} (name, value, updatedAt) VALUES (?, ?, ?) ${db.sql.upsert("name", ["value", "updatedAt"])}`,
        name, String(value), new Date().toISOString(),
      );
    },
    async all() {
      const rows = await db.all(`SELECT name, value, updatedAt FROM ${table} ORDER BY name`);
      return Object.fromEntries(rows.map((r) => [r.name, r.value]));
    },
  };
}

/**
 * Applies the migration steps a plugin still lacks, in order, writing
 * `schema_version` after each one: a failure half-way leaves the version at
 * the last step that completed, which is the truth — not a version that lies.
 * (On MariaDB a DDL statement commits on its own, so "one transaction for the
 * whole step" is not a promise any engine-neutral layer can keep; one
 * version per completed step is.)
 *
 * `steps`: `[{ version: 1, up: async (db) => { … } }, …]`, versions strictly
 * increasing. Returns the version reached.
 */
export async function applyMigrations(db, nick, steps, from = 0) {
  const config = pluginConfig(db, nick);
  await config.ensure();
  const ordered = [...steps].sort((a, b) => a.version - b.version);
  let reached = Number(from) || 0;
  for (const step of ordered) {
    if (!Number.isInteger(step.version) || step.version <= reached) continue;
    await step.up(db);
    await config.set("schema_version", String(step.version));
    reached = step.version;
  }
  return reached;
}

/** scheme -> factory; adding a backend is one entry here plus its driver class */
const DRIVERS = {
  sqlite: (path) => new SqliteDriver(path),
};

/**
 * `target` is a path ("/data/app.db"), or a URL whose scheme picks the driver
 * ("sqlite:/data/app.db"). Unknown schemes fail with the list of what exists -
 * not a cryptic stack. An engine that has no file to open does not come from
 * here at all: the host builds a borrowed driver and passes it in.
 */
export function openDatabase(target) {
  if (!target) throw new Error("no database target configured (KEELOPS_DB)");
  const match = /^([a-z][a-z0-9+]*):(.*)$/i.exec(target);
  const [scheme, rest] = match && match[1].length > 1
    ? [match[1].toLowerCase(), match[2].replace(/^\/\//, "")]
    : ["sqlite", target];   // a bare path (even C:\... on Windows) means SQLite
  const factory = DRIVERS[scheme];
  if (!factory)
    throw new Error(
      `no driver for "${scheme}" (available: ${Object.keys(DRIVERS).join(", ")})`);
  return factory(rest);
}
