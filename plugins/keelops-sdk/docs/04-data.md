# Data: reading and owning tables

A plugin has three places for data, from the most to the least important:

1. **The KeelOps database, read-only**: tasks, projects, deals, people. The
   truth the plugin works on.
2. **Its own tables** in the same database, `plugin_<nick>_…`: what people
   typed into the plugin, its settings, what must survive a backup and a move
   to another engine.
3. **An extension store**, a DuckDB file in `ctx.dataDir`: data the plugin
   can rebuild — caches, computed graphs, analytical volumes.

## The driver

`ctx.db` is a **driver** with a small, stable surface. Every call is
asynchronous.

```js
const rows = await ctx.db.all("SELECT id, name FROM Project WHERE deletedAt IS NULL ORDER BY name");
const one  = await ctx.db.get("SELECT COUNT(*) AS n FROM Task WHERE projectId = ?", projectId);
const { changes } = await ctx.db.run("UPDATE plugin_hello_note SET body = ? WHERE id = ?", body, id);
ctx.db.dialect;   // "sqlite" | "mariadb"
```

- Parameters are positional `?`, passed after the SQL.
- Rows come back **plain**, the same on both engines: timestamps as ISO
  strings, `COUNT()` as numbers (not BigInt), decimals as numbers. What you
  print from SQLite prints the same on MariaDB.
- `all` and `get` are for reading, `run` for writing. A write passed to `all`
  is refused.

### Two engines, one SQL

KeelOps runs on **SQLite** (development, tests, small installations) and
**MariaDB** (production). Write **ANSI SQL**, and put the few expressions that
differ behind `db.sql.*`:

| helper | SQLite | MariaDB | use it for |
|---|---|---|---|
| `db.sql.now()` | `datetime('now')` | `UTC_TIMESTAMP(3)` | the current instant, UTC |
| `db.sql.today()` | `date('now')` | `DATE_FORMAT(UTC_DATE(), '%Y-%m-%d')` | today as `YYYY-MM-DD` |
| `db.sql.dayOf(expr)` | `substr(expr, 1, 10)` | `DATE_FORMAT(expr, '%Y-%m-%d')` | the day of a timestamp |
| `db.sql.monthOf(expr)` | `substr(expr, 1, 7)` | `DATE_FORMAT(expr, '%Y-%m')` | the month of a timestamp |
| `db.sql.daysBetween(a, b)` | julianday difference | `TIMESTAMPDIFF(SECOND…)/86400` | days from `a` to `b`, fractional |
| `db.sql.todayPlusDays(n)` | `date('now', '+n days')` | `DATE_ADD(UTC_DATE(), …)` | a date `n` days away (`n` must be an integer) |
| `db.sql.concat(...parts)` | `a \|\| b` | `CONCAT(a, b)` | string concatenation |
| `db.sql.ident(name)` | `"name"` | `` `name` `` | a column named like a keyword (`order`) |
| `db.sql.upsert(key, cols)` | `ON CONFLICT(key) DO UPDATE …` | `ON DUPLICATE KEY UPDATE …` | insert or update |
| `db.sql.createTableSuffix()` | — | `DEFAULT CHARACTER SET utf8mb4 …` | after `CREATE TABLE (…)` |
| `db.sql.longText()` | `TEXT` | `LONGTEXT` | text with no practical bound |

These are not theoretical. Each one is a bug that shipped once because the
query worked on SQLite:

- `||` concatenates on SQLite and is a **logical OR** on MariaDB: the query
  returned `1` instead of `"anna/2026-09-01"`, without an error.
- `"order"` in double quotes is an identifier on SQLite and a **string** on
  MariaDB.
- A subquery in `FROM` needs an alias on MariaDB.
- `TEXT` is unbounded on SQLite and **64 KB** on MariaDB: a JSON vector fitted
  here and was cut there.
- `date('now')` does not exist on MariaDB.

The only way to know a query is portable is to run it on the other engine —
see [Testing](09-testing-and-shipping.md#the-other-engine).

## Reading the core

The KeelOps tables are the plugin's to read. The ones plugins use most:

| table | what |
|---|---|
| `Task` | everything that is work: `kind` is `ADMIN` (deadlines), `DEAL`, `PROJECT`, `TICKET`, `PERSONAL`; `statusId`, `assigneeId`, `supervisorId`, `creatorId`, `projectId`, `companyId`, `dueDate`, `deletedAt` |
| `TaskStatus` | `name`, `color`, `isClosed` |
| `Project`, `ProjectMember` | projects and who is in them |
| `User` | people: `name`, `nickName`, `role`, `isActive`, `locale` |
| `Company`, `Contact` | the directory |
| `TimeEntry` | hours: `userId`, `taskId`, `date` (midnight UTC), `hours` (quarters: 0.25) |
| `Attachment` | files and links of a task |

**Visibility is the plugin's responsibility** when it reads directly. Two
ways to get it right:

- for **one task or a list of known tasks**, ask the core:
  `ctx.tasks.read(userId, taskId)` returns `null` for what that person may not
  see — the core's own rule, with all its nuances
  ([core doors](07-core-doors.md#tasks));
- for a **query over many tasks**, use `taskPerimeter(user)` from
  `perimeter.mjs`: a conservative `WHERE` fragment that, when in doubt, hides.
  A plugin may show less than the core would, never more.

```js
const { where, params } = taskPerimeter(user);
const late = await ctx.db.all(
  `SELECT t.id, t.title, t.dueDate FROM Task t
    WHERE ${where} AND t.dueDate < ${ctx.db.sql.today()}
    ORDER BY t.dueDate`,
  ...params,
);
```

Soft-deleted rows carry `deletedAt`: filter them out (`taskPerimeter` does).

## Owning tables

Declare a `nick` in the manifest and the plugin **owns** the tables named
`plugin_<nick>_…`: it creates them, migrates them, keeps them. Nothing else
is writable.

```json
{ "nome": "Hello", "nick": "hello", "schemaVersion": 1 }
```

The gate is not a convention. Before a write runs, the driver **reads the
statement** (`sql-targets.mjs`) and lists every table it writes — `INSERT`,
`UPDATE`, `DELETE`, `REPLACE`, `CREATE`/`ALTER`/`DROP TABLE`, indexes — and
refuses the statement if one of them lacks the prefix. **Index names need
the prefix too** (`plugin_hello_note_user`), and `run()` takes **one statement
per call**. It does not trust the
first word: `WITH x AS (…) DELETE FROM Task` begins with `WITH` and is
refused. The error names the table that stopped it. Reads go through a
connection that **cannot write** at all: on SQLite a second, read-only handle
on the file, on MariaDB a `READ ONLY` session.

### Migrations

```js
// lib/schema.mjs
export function migrate(sdk, db, from) {
  const suffix = db.sql.createTableSuffix();
  return sdk.applyMigrations(db, "hello", [
    {
      version: 1,
      up: async (d) => {
        await d.run(
          `CREATE TABLE IF NOT EXISTS plugin_hello_note (` +
            `id VARCHAR(191) NOT NULL PRIMARY KEY, ` +
            `userId VARCHAR(191) NOT NULL, ` +
            `body ${d.sql.longText()} NOT NULL, ` +
            `createdAt VARCHAR(32) NOT NULL, ` +
            `FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE)${suffix}`,
        );
        await d.run(`CREATE INDEX plugin_hello_note_user ON plugin_hello_note (userId)`);
      },
    },
    {
      version: 2,
      up: async (d) => d.run(`ALTER TABLE plugin_hello_note ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`),
    },
  ], from);
}

// plugin.mjs, in create():
return { routes, migrate: (db, from) => migrate(database, db, from) };
```

Before mounting a plugin with a nick, the core:

1. creates `plugin_<nick>_config` if it is missing — key/value settings, plus
   `plugin_version` and `schema_version`;
2. **refuses to mount** it if the tables are *ahead* of the code (a rollback):
   better a plugin that is off than one running on tables it does not know;
3. calls `migrate(db, from)` if the tables are behind, and checks that
   `schema_version` now says `manifest.schemaVersion`.

`applyMigrations` runs the missing steps in order and writes `schema_version`
**after each one**. A step that fails half-way leaves the version of the last
step that completed — the truth. (On MariaDB a DDL statement commits on its
own: "the whole migration in one transaction" is a promise no engine-neutral
layer can keep.)

Rules for the DDL:

- **Types that exist on both engines**: `VARCHAR(n)` (191 for keys and
  indexed columns), `INTEGER`, `REAL`, `TEXT` or `db.sql.longText()`.
- **Dates as ISO strings** in `VARCHAR(32)`, written by the plugin
  (`new Date().toISOString()`): the same value reads the same everywhere.
- **Foreign keys go one way: from the plugin to the core**
  (`userId → User.id ON DELETE CASCADE`), never from the core to a plugin — a
  plugin that is off must not break a deletion in the core. On MariaDB they
  need `createTableSuffix()` so charset and collation match the core's.
- **Never touch a core table**: not a column, not an index. The gate refuses
  it anyway.

### When the tables exist

`create()` runs **before** the migrations. Anything that reads or writes the
plugin's tables at start-up — seeding a default, reading a setting — goes in
the first request, once:

```js
let ready = null;
const whenReady = () => (ready ??= seedDefaults(ctx.db).catch((e) => { ready = null; throw e; }));
```

### The config table

`pluginConfig(db, nick)` from `database.mjs` gives the key/value table the
core created:

```js
const config = database.pluginConfig(ctx.db, "hello");
await config.set("greeting", "Ciao");
const greeting = (await config.get("greeting")) ?? "Hello";   // strings, or null
const all = await config.all();                                  // { name: value }
```

Keep settings here rather than in a table of their own; the System page shows
the two versions the core writes here.

## The extension store

For what the plugin can rebuild — a vector index, a computed graph, an
analytical history — a DuckDB file in `ctx.dataDir` keeps the KeelOps
database lean and the backups fast:

```js
import { openExtensionStore } from "…/keelops-sdk/extension.mjs";

const store = await openExtensionStore(ctx.dataDir, { from: import.meta.url });
await store.migrate([
  { version: 1, up: (s) => s.exec("CREATE TABLE vectors (taskId VARCHAR, v FLOAT[1024])") },
]);
await store.run("INSERT INTO vectors VALUES (?, ?)", id, vector);
const rows = await store.all("SELECT taskId FROM vectors LIMIT 10");
```

The same shape as the driver (`all`, `get`, `run`, async, positional `?`),
plus `exec` for DDL and `migrate` with the version kept inside the file.
DuckDB is a native module: install it **in the plugin's folder**
(`npm i @duckdb/node-api`) and pass `from: import.meta.url` so the SDK finds
it. **Nothing that matters goes here**: the backup of KeelOps does not see
it, and moving to another engine does not carry it.
