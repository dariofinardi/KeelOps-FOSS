# Testing and shipping

## Test the plugin on its own

The dispatcher is the same in both modes, so most of a plugin can be tested
without a KeelOps server: build the routes with a fake `ctx`, call them with a
fake request, read the answer.

```js
// test/routes.test.mjs — run with: node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createDispatcher } from "../../keelops-sdk/http.mjs";
import { buildRoutes } from "../lib/routes.mjs";

function call(dispatch, method, path, body) {
  return new Promise((resolve) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.method = method;
    req.headers = {};
    const res = {
      headersSent: false,
      writeHead(status) { this.status = status; this.headersSent = true; },
      end(text) { resolve({ status: this.status, body: text ? JSON.parse(text) : null }); },
    };
    dispatch(req, res, path);
  });
}

test("a person outside the group reads nothing", async () => {
  const ctx = { db, sessionUser: async () => ({ id: "u1", name: "Anna", role: "MEMBER" }) };
  const dispatch = createDispatcher({ routes: buildRoutes(ctx), name: "Hello" });
  const r = await call(dispatch, "GET", "/api/items");
  assert.equal(r.status, 403);
});
```

For the database, use a real SQLite file (the `node:sqlite` module is fine
**in tests**) with the core's tables your plugin reads, and the writable
driver of the SDK over it:

```js
import { openWritableSqlite, prepareOwnedTables } from "../../keelops-sdk/database.mjs";

const db = openWritableSqlite("/tmp/copy-of-keelops.db", "hello");
await prepareOwnedTables(db, { nick: "hello", schemaVersion: 2, migrate, version: "0.1.0" });
```

`prepareOwnedTables` does what the core does before mounting: config table,
version check, migrations. Always on a **copy**.

## Standalone mode

A plugin can also run as its own process, handy while developing its pages:

```js
// server.mjs
import { startServer } from "../keelops-sdk/http.mjs";
import { openWritableSqlite } from "../keelops-sdk/database.mjs";
import { sessionUser } from "../keelops-sdk/session.mjs";

const db = openWritableSqlite(process.argv[2], "hello");      // a COPY of the database
const ctx = { db, dataDir: "./data", sessionUser: (req) => sessionUser(req, db, "kancrm_session_dev") };
startServer({ port: 4100, routes: buildRoutes(ctx), staticDir: "./ui", name: "Hello" });
```

`session.mjs` recognises the KeelOps session cookie of the same copy —
`kancrm_session_dev` in development, `kancrm_session` in production — so you
sign in to a development KeelOps and the plugin knows who you are.

## The other engine

A query that works on SQLite may fail — or worse, return something else —
on MariaDB (see [the dialects](04-data.md#two-engines-one-sql)). KeelOps has a
script that runs a plugin's DDL and queries on a MariaDB **test database**:

```bash
cd apps/server
pnpm exec tsx --env-file=<.env with the MariaDB credentials> \
  scripts/mariadb/prova-plugin.ts --database keelops_prova
```

Add a block for your plugin to it: the migrations from zero, a write and a
read of each kind your plugin does. Never point it at production.

## The core's checks

`pnpm check` in the KeelOps repository runs, among the rest, three tests that
look at every plugin in `plugins/`:

- `plugins-through-sdk.test.ts` — no forbidden import;
- `plugins-translations.test.ts` — every phrase of the pages translated in
  English, French, German and Spanish;
- `plugin-host.test.ts` — a real server loads fixture plugins and checks the
  contract: routes, the session guard, public paths, own tables, migrations,
  tools, the bar button, switching a plugin off.

## Installing

A plugin is installed on a server in three steps:

1. **Copy it** outside the application folder — the deploy of KeelOps
   rewrites `app/`, and would delete it — for example
   `/srv/keelops/plugins/Hello`, and **link** it into `app/plugins/Hello`.
2. **Add it to `PLUGINS`** in the server's `.env`.
3. **Restart** the service. The log says whether it loaded, and why not.

The bundled plugins ship an `installa.sh` that does exactly this, with
`--dry-run` (say what it would do), `--aggiorna` (update: refresh the copy
after a `git pull`, nothing else) and `--ripristina` (take it out of
`PLUGINS`; the copy and the tables stay). Copy it for yours.

## Updating

- Bump `versione` in the manifest; bump `schemaVersion` and add a migration
  step if the tables change.
- Refresh the copy and restart. The core migrates the tables before mounting
  the plugin, and refuses it if the tables are ahead of the code.
- A plugin can be **switched off without a restart** from the System page
  (super administrator): its pages and API answer 404, it disappears from the
  menu, from the anchors and from the morning digest; its tables and data
  stay. Switched on again, it is back as it was.

## The System page

The super administrator sees every plugin in the folder — installed or
not — with its title, version, table schema, copyright, licence and the
`sommario` in their language. Write those fields for the person who decides
whether to switch your plugin on.
