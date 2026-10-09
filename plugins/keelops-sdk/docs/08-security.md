# Security and rules

A plugin runs **inside** the KeelOps process, next to data people work on
every day. The rules below are what makes that safe. Most of them are
enforced by code — the database gate, the session guard, a test that reads
every plugin's source — and the rest are checked in review.

## Everything goes through the SDK

A plugin does not reach the core on its own:

| never | instead |
|---|---|
| open the database (`node:sqlite`, `better-sqlite3`, Prisma, a MariaDB client) | `ctx.db` |
| read the server's environment (`DATABASE_URL`, `OLLAMA_URL`, secrets) | what `ctx` lends |
| call Ollama with its own `fetch` (`/api/chat`, `/api/embed`, `/api/generate`) | `ollama.mjs` with `ctx.ollamaUrl` |
| write into a core table | the [core doors](07-core-doors.md) |
| put an inline `<script>` in a page, or build one with `createElement("script")` | a script file; `sdk/tema.js`, `sdk/riquadro.js`, `sdk/traduzioni.js` |

A test in the core (`plugins-through-sdk.test.ts`) reads the sources of every
plugin it finds and **fails on each of these**, naming the file. Self-tests
and standalone servers are the exception: they run against a copy of the
database, on purpose.

The allowed exceptions are the plugin's own data (`ctx.dataDir`) and
integrations that belong to the plugin (Google Drive for the MCP connector
pro, with the credentials the core lends).

## The database is fenced

- Reads go through a connection **that cannot write**: on SQLite a read-only
  handle on the file, on MariaDB a `READ ONLY` session.
- Writes go only to tables named `plugin_<nick>_…`. The gate
  (`sql-targets.mjs`) reads every statement and lists the tables it writes;
  one without the prefix stops the statement. It does not trust the first
  word (`WITH … DELETE` is refused), it refuses views and triggers outright,
  and anything it cannot classify with confidence is a refusal.
- Foreign keys go **from the plugin to the core**, never the other way.

## Every route is behind the session guard

Without a session, the core answers 401 before the request reaches the
plugin. The guard says **whether** someone may enter; the plugin still asks
**who** with `ctx.sessionUser(req)`, and decides **what** they may do.

- Customers of the portal and sales monitors never reach a plugin.
- `pubblici` in the manifest opens paths without a session. **A public path
  authenticates by itself** — a bearer token, a signature — or it is open to
  the internet.
- `health` is public: never put anything in it but `{ ok, version }`.

## Visibility is yours to respect

The core decides who sees which task. A plugin that reads the database
directly must not show more than that:

- `ctx.tasks.read` / `readMany` apply the core's exact rule;
- `taskPerimeter(user)` is a conservative SQL filter for queries over many
  tasks: when in doubt it hides;
- a plugin's own records follow its own rules (QABox has sectors with
  readers, operators and managers) — check them **on the server**, in every
  route and every tool, never only by hiding a button.

The pages should not offer what the person cannot do — but the server
refuses it anyway.

## Secrets

- Never log request bodies, tokens or secrets. The dispatcher logs the
  method, the path and the error message only; do the same.
- Tokens a plugin keeps (OAuth refresh tokens) are **encrypted at rest** in
  its own tables, with a key in its data folder.
- Nothing secret goes to the browser: the Google client secret stays on the
  server.

## Data protection with AI

A plugin that sends KeelOps data to a language model sends it to the **local**
models (`ollama.mjs`, your own server). A plugin that talks to an external
service — an AI assistant through MCP, a cloud API — must say so to the
person, and should offer pseudonymisation of names, customers, emails and VAT
numbers before the text leaves (the MCP connector pro does this, and tells
the assistant when the person switches it off).

## Dependencies and licences

Plugins may be sold: their dependencies must carry **permissive licences**
(MIT, Apache-2.0, BSD, ISC, OFL for fonts). No GPL, AGPL or SSPL in a
plugin's `node_modules`. Prefer the standard library: the SDK itself has no
dependencies. A native module (DuckDB, a Rust binary) is installed in the
plugin's folder, never globally.

## Checklist before shipping

- [ ] No forbidden import (run the core's tests).
- [ ] Every route checks the user, and every write checks the permission, on
      the server.
- [ ] Public paths authenticate by themselves.
- [ ] Queries run on SQLite **and** MariaDB.
- [ ] No inline script in any page; theme and frame scripts loaded from
      `sdk/`.
- [ ] Translations complete in the four languages.
- [ ] Timers `unref()`'d.
- [ ] Dependencies with permissive licences only.
- [ ] `manifest.json`: version bumped, `schemaVersion` matching the
      migrations, `sommario` in six languages.
